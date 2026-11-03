import {
  AcesToneMapping,
  addTask,
  addTaskBefore,
  buildFrameGraphTask,
  createEffectRenderTask,
  createEffectWrapper,
  createRenderTarget,
  createRenderTask,
  createSurfaceRenderTargetTexture,
  enableMaterialPlugins,
  getFrameGraph,
  getPbrUnlit,
  isPbrMaterial,
  isStandardMaterial,
  NeutralToneMapping,
  onRenderTargetTextureResize,
  reconcileMaterialPlugins,
  setEffectTexture,
  setEffectUniforms,
  setEnvironmentRotation,
  setFog,
  StandardToneMapping,
} from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import { DEPTH_STENCIL_FORMAT, markHdrScene } from "./render-path.js";
import type { AutoExposurePass } from "./auto-exposure.js";
import type { HdrOutputHandle, ScenePresenter } from "./render-path.js";
import type {
  EffectWrapper,
  EngineContext,
  FogConfig,
  ImageProcessingConfig,
  MaterialPlugin,
  RenderTarget,
  SceneContext,
  Task,
  Texture2D,
} from "@babylonjs/lite";

/**
 * The HDR render path (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G2): the frame graph
 * a scene gets when the project declares `rendering.hdr`. Its own chunk: `../engine.ts` imports it
 * only when the setting is on, so a project without HDR loads none of it (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * [shadow] → scene ──→ hdr (rgba16float) ─ [custom effects, linear] ─→ output ──→ swapchain
 *                                                                        └──→ sceneColor ─ (built-in effects)
 * ```
 *
 * - **Linear colour.** Lite's PBR shader ends every fragment with fog, exposure, the curve, a
 *   `pow(1/2.2)` encode, a clamp and contrast (`lib/material/pbr/pbr-template.js` line 171), so an
 *   `rgba16float` target alone still holds values ≤ 1. {@link createLinearOutputPlugin} saves the
 *   colour before that block and restores it before the fragment is written (spike S1).
 * - **The output pass** applies the scene's `imageProcessing` — exposure, contrast and the curve
 *   the `Environment` set, or `loadEnvironment` set — then the same encode, clamp and contrast,
 *   so a PBR-only scene presents the same bytes as without HDR, within half-float rounding.
 * - **Two output tasks.** A task cannot change its target once recorded, so there is one that
 *   writes the swapchain and one that writes `sceneColor`, an ordinary colour target a
 *   `PostProcessStack` chain reads. {@link ScenePresenter.setPresentEnabled} switches between them,
 *   so the frame runs exactly one.
 *
 * - **Every other colour writer (step G3).** The restore re-applies the PBR fog, so a fogged scene
 *   keeps its fog. A Standard material (and a surface shader on one) gets
 *   {@link createStandardLinearPlugin}, which decodes its display colour; a surface shader on a PBR
 *   host is caught by the PBR plugin, because its composite runs before the save. Lite's environment
 *   skyboxes (`.env`, `.dds`) are patched to return the cube map's linear colour
 *   ({@link linearSkyboxFragment}). Custom `.wgsl` materials (particles, foliage) are wrapped by
 *   `./shader-material.ts`, which asks {@link markHdrScene}'s record. Sprites need nothing: a
 *   `SpriteRenderer` draws its own pass onto the swapchain after the scene, so it never passes
 *   through the output pass. Under HDR, Standard and custom-shader colour now gets the scene's
 *   exposure, curve and contrast like everything else; with Lite's defaults (exposure 1, contrast 1,
 *   no curve) that is the identity and the image matches the plain path.
 * - **Fog colour.** The scene's fog colour is stored decoded here, so the Standard fog block blends
 *   in linear space and the PBR restore can use it as is.
 * - **Custom effects first.** A `PostProcessStack`'s custom effects ordered before any built-in one
 *   are inserted before the output pass ({@link HdrOutputHandle.insertLinearTask}) and the output
 *   pass reads the last one's result ({@link HdrOutputHandle.setOutputSource}). Bloom, SMAA and
 *   Lite's image-processing task stay after it: they expect display colour and 8-bit targets.
 *
 * Not covered: Lite's six-face `loadSkybox` cube and its solid-colour and ground backgrounds, which
 * have fixed shaders with no patch point; they still encode twice under HDR.
 */

/**
 * The colour format of the HDR scene target.
 *
 * @internal
 */
export const HDR_SCENE_FORMAT: GPUTextureFormat = "rgba16float";

/**
 * The name the linear-output plugin carries; part of Lite's pipeline cache key.
 *
 * @internal
 */
export const LINEAR_OUTPUT_PLUGIN_NAME = "ignifx-hdr-linear-output";

/**
 * The name the Standard material's decode plugin carries.
 *
 * @internal
 */
export const STANDARD_LINEAR_PLUGIN_NAME = "ignifx-hdr-linear-standard";

/**
 * The name the unlit PBR material's plugin carries.
 *
 * @internal
 */
export const UNLIT_LINEAR_PLUGIN_NAME = "ignifx-hdr-linear-unlit";

/**
 * Where the skybox patch sits in Lite's skybox patch list: after rotation (0) and blur (1)
 * (`lib/scene/set-environment-rotation.js`, `lib/scene/set-environment-blur.js`).
 */
const SKYBOX_PATCH_ORDER = 8;

/**
 * Lite's fog factor (`lib/shader/wgsl-fog.js`) under an ignifx name: the PBR shader declares
 * `calcFogFactor` only when the scene has fog, and the plugin code must compile either way.
 */
const FOG_FACTOR_WGSL =
  "fn ignifxFogFactor(d:vec3<f32>)->f32{var k:f32=1.0;let mode=scene.vFogInfos.x;let dist=length(d);" +
  "if(mode==3.0){k=(scene.vFogInfos.z-dist)/(scene.vFogInfos.z-scene.vFogInfos.y);}" +
  "else if(mode==1.0){k=1.0/pow(2.71828,dist*scene.vFogInfos.w);}" +
  "else if(mode==2.0){k=1.0/pow(2.71828,dist*dist*scene.vFogInfos.w*scene.vFogInfos.w);}" +
  "return clamp(k,0.0,1.0);}";

/**
 * The PBR fog block (`lib/material/pbr/pbr-fog-wgsl.js`) on the restored colour, except that the
 * fog colour is already linear: the HDR path stores it decoded.
 */
const FOG_RESTORE_WGSL =
  "if(scene.vFogInfos.x>0.0){color=mix(scene.vFogColor.rgb,color," +
  "pow(ignifxFogFactor((scene.view*vec4<f32>(input.worldPos,1.0)).xyz),2.2));}";

/**
 * The frame-graph task names, in the order they run after `"scene"`.
 *
 * @internal
 */
export const HDR_OUTPUT_TASK_NAMES = { toChain: "ignifx:hdr-output-chain", toSwapchain: "ignifx:hdr-output" } as const;

/**
 * The curve numbers the output shader branches on.
 *
 * @internal
 */
export const HDR_CURVE = { none: 0, standard: 1, aces: 2, neutral: 3 } as const;

/** The output pass's uniform block: exposure, contrast, curve, padding. */
const UNIFORM_FLOATS = 4;

/**
 * Builds the material plugin that keeps a PBR fragment's colour linear.
 *
 * @remarks
 * `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` is injected at two slots (`AI`, `NI`;
 * `lib/material/plugin/plugin-bridge-shared.js` line 13), so the save is an assignment, never a
 * `let`; the second one, after indirect light, wins. Priority 0 puts the restore ahead of any other
 * plugin's `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` code, which then works on linear colour.
 *
 * @returns The plugin. Plain data, so one object can be shared by every material.
 *
 * @internal
 */
export function createLinearOutputPlugin(): MaterialPlugin {
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: `var<private> ignifxLinearColor: vec3<f32>;${FOG_FACTOR_WGSL}`,
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "ignifxLinearColor = color;",
    CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `color = ignifxLinearColor;${FOG_RESTORE_WGSL}`,
  };
  return {
    name: LINEAR_OUTPUT_PLUGIN_NAME,
    priority: 0,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Builds the plugin that keeps an unlit PBR material's colour linear.
 *
 * @remarks
 * With no environment, Lite's unlit fragment assigns its colour at the `NI` slot
 * (`lib/material/pbr/fragments/unlit-fragment.js`), after the linear-output plugin's save there, so
 * the save would hold the lit colour. This plugin recomputes the unlit colour instead
 * (`baseColor * material.unlitColor`, both in scope before the fragment is written), then applies
 * the fog the restore would.
 *
 * @returns The plugin, shared by every unlit PBR material.
 *
 * @internal
 */
export function createUnlitLinearPlugin(): MaterialPlugin {
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: FOG_FACTOR_WGSL,
    CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `color = baseColor*material.unlitColor;${FOG_RESTORE_WGSL}`,
  };
  return {
    name: UNLIT_LINEAR_PLUGIN_NAME,
    priority: 0,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Builds the plugin that turns a Standard material's colour linear.
 *
 * @remarks
 * Lite's Standard shader does no image processing and no encode: what it writes is the colour that
 * is displayed. The plugin decodes it with the exact inverse of the output pass's encode
 * (`pow(c, 2.2)`), so the output pass gives it back. It runs at the `BC` slot, before Lite's Standard fog
 * block (the `BA` slot), which then mixes in the decoded fog colour. Priority 1000 puts it after any
 * surface shader's own `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` code.
 *
 * @returns The plugin, shared by every Standard material.
 *
 * @internal
 */
export function createStandardLinearPlugin(): MaterialPlugin {
  const fragment = {
    CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color=vec4<f32>(pow(max(color.rgb,vec3<f32>(0.0)),vec3<f32>(2.2)),color.a);",
  };
  return {
    name: STANDARD_LINEAR_PLUGIN_NAME,
    priority: 1000,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Makes one of Lite's environment skybox shaders return the cube map's linear colour.
 *
 * @remarks
 * The `.env` (`"hdr"`) and `.dds` skyboxes multiply by `mesh.exposureLinear`, then encode, clamp
 * and apply contrast themselves (`lib/material/pbr/background-hdr-skybox.js`,
 * `lib/_chunks/background-dds-skybox-*.js`), and Lite gives them no material plugin point. The patch
 * returns the colour just before that multiply, so the output pass applies exposure, the curve and
 * the encode once. Code after the inserted `return` is unreachable, which WGSL accepts. A shader the
 * pattern does not match is returned unchanged.
 *
 * @param fragment - The skybox fragment WGSL, after Lite's own rotation and blur patches.
 * @returns The patched WGSL.
 *
 * @internal
 */
export function linearSkyboxFragment(fragment: string): string {
  const match = /\b([A-Za-z_]\w*)\*=mesh\.exposureLinear;/u.exec(fragment);
  if (match === null) {
    return fragment;
  }
  return `${fragment.slice(0, match.index)}return vec4<f32>(${match[1] ?? ""},1.0);${fragment.slice(match.index)}`;
}

/**
 * A fog configuration with its colour decoded the way Lite's PBR fog block decodes it.
 *
 * @param fog - The configuration the `Environment` installed, colour in sRGB.
 * @returns A fresh configuration, colour linear.
 *
 * @internal
 */
export function linearFogConfig(fog: FogConfig): FogConfig {
  return {
    mode: fog.mode,
    density: fog.density,
    start: fog.start,
    end: fog.end,
    color: [fog.color[0] ** 2.2, fog.color[1] ** 2.2, fog.color[2] ** 2.2],
  };
}

/**
 * Builds the output pass's fragment shader.
 *
 * @remarks
 * The curves are Lite's own WGSL (`ToneMapping.helpersWGSL`/`callWGSL`), which read the exposure
 * from `scene.vImageInfos.x`; naming the uniform block `scene` lets them drop in unchanged. One
 * shader holds all of them and branches on a uniform, so a curve change uploads 16 bytes instead
 * of compiling a pipeline. The encode, clamp and contrast copy the PBR template's tail.
 *
 * @param autoExposure - Whether binding 2 holds the auto exposure texel (`./auto-exposure.ts`),
 * `log2` of a multiplier applied before the curve.
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function hdrOutputFragmentWgsl(autoExposure = false): string {
  return [
    AcesToneMapping.helpersWGSL,
    NeutralToneMapping.helpersWGSL,
    "struct HdrOutputUniforms{vImageInfos:vec4<f32>};",
    "@group(0)@binding(0)var<uniform>scene:HdrOutputUniforms;",
    "@group(0)@binding(1)var hdrColor:texture_2d<f32>;",
    autoExposure ? "@group(0)@binding(2)var autoExposure:texture_2d<f32>;" : "",
    "@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{",
    "let texel=textureLoad(hdrColor,vec2<i32>(fragment.position.xy),0);",
    "var color=max(texel.rgb,vec3<f32>(0.0));",
    autoExposure ? "color*=exp2(textureLoad(autoExposure,vec2<i32>(0,0),0).r);" : "",
    "let curve=i32(scene.vImageInfos.z+0.5);",
    `if(curve==${String(HDR_CURVE.standard)}){${StandardToneMapping.callWGSL}}`,
    `else if(curve==${String(HDR_CURVE.aces)}){${AcesToneMapping.callWGSL}}`,
    `else if(curve==${String(HDR_CURVE.neutral)}){${NeutralToneMapping.callWGSL}}`,
    "else{color*=scene.vImageInfos.x;}",
    "color=pow(color,vec3<f32>(1.0/2.2));",
    "color=clamp(color,vec3<f32>(0.0),vec3<f32>(1.0));",
    "let highContrast=color*color*(3.0-2.0*color);",
    "if(scene.vImageInfos.y<1.0){color=mix(vec3<f32>(0.5),color,scene.vImageInfos.y);}",
    "else{color=mix(color,highContrast,scene.vImageInfos.y-1.0);}",
    "color=max(color,vec3<f32>(0.0));",
    "return vec4<f32>(color,texel.a);",
    "}",
  ].join("\n");
}

/**
 * The curve number for a scene's image processing.
 *
 * @remarks
 * Tone mapping switched on with no curve named is Lite's standard curve (`pbr-renderable.js`). A
 * custom Lite curve the output pass does not know falls back to the standard one.
 *
 * @param processing - The scene's image processing.
 * @returns One of {@link HDR_CURVE}.
 *
 * @internal
 */
export function hdrCurveOf(processing: Pick<ImageProcessingConfig, "toneMappingEnabled" | "toneMapping">): number {
  if (!processing.toneMappingEnabled) {
    return HDR_CURVE.none;
  }
  const id = processing.toneMapping?.id;
  if (id === AcesToneMapping.id) {
    return HDR_CURVE.aces;
  }
  return id === NeutralToneMapping.id ? HDR_CURVE.neutral : HDR_CURVE.standard;
}

/**
 * Writes the output pass's uniforms and says whether they changed.
 *
 * @param processing - The scene's image processing.
 * @param out - The four floats: exposure, contrast, curve, padding.
 * @returns `true` when `out` now differs from what it held.
 *
 * @internal
 */
export function writeHdrOutputUniforms(processing: ImageProcessingConfig, out: Float32Array): boolean {
  const curve = hdrCurveOf(processing);
  if (out[0] === processing.exposure && out[1] === processing.contrast && out[2] === curve) {
    return false;
  }
  out[0] = processing.exposure;
  out[1] = processing.contrast;
  out[2] = curve;
  return true;
}

/**
 * Builds the HDR render path and appends it to the scene's frame graph.
 *
 * @remarks
 * The same contract as `installOffscreenRenderPath` in `./render-path.ts`: call it right after
 * `createSceneContext(engine, { defaultRenderTask: false })` and before `registerScene`. It also
 * installs Lite's material-plugin bridges, which the linear-output plugin needs before the scene is
 * registered. With MSAA on, the scene draws into a multisampled `rgba16float` target that resolves
 * into the sampled one.
 *
 * @param engine - The engine, which is also the primary surface.
 * @param scene - The scene created with no default render task.
 * @param installAutoExposure - Builds the auto exposure passes over the HDR texture, between the
 * scene task and the output tasks (`./auto-exposure.ts`); omitted when auto exposure is off.
 * @returns The presenter, with its {@link ScenePresenter.hdr} handle set.
 *
 * @internal
 */
export function installHdrRenderPath(
  engine: EngineContext,
  scene: SceneContext,
  installAutoExposure?: (hdrTexture: Texture2D) => AutoExposurePass,
): ScenePresenter {
  enableMaterialPlugins(scene);
  markHdrScene(scene);
  installLinearSkybox(scene);
  const hdr = createSurfaceRenderTargetTexture(engine, {
    lbl: "ignifx:scene-hdr",
    format: HDR_SCENE_FORMAT,
    samples: 1,
    size: engine,
  });
  const isMultisampled = engine.msaaSamples > 1;
  const config: { name: string; rt: RenderTarget; rst?: RenderTarget; depth?: RenderTarget } = {
    name: "scene",
    rt: hdr.rt,
  };
  if (isMultisampled) {
    config.rt = createRenderTarget({
      lbl: "ignifx:scene-hdr-msaa",
      format: HDR_SCENE_FORMAT,
      dFormat: DEPTH_STENCIL_FORMAT,
      samples: engine.msaaSamples,
      size: engine,
    });
    config.rst = hdr.rt;
  } else {
    config.depth = createRenderTarget({
      lbl: "ignifx:scene-depth",
      dFormat: DEPTH_STENCIL_FORMAT,
      samples: 1,
      size: engine,
    });
  }
  addTask(scene, createRenderTask(config, engine, scene));
  const autoExposure = installAutoExposure?.(hdr.texture) ?? null;

  const effect: EffectWrapper = createEffectWrapper(engine, {
    name: "ignifx:hdr-output",
    fragmentWGSL: hdrOutputFragmentWgsl(autoExposure !== null),
    bindings: [
      { name: "hdrOutput", binding: 0, kind: "uniform", uniformByteLength: UNIFORM_FLOATS * 4 },
      { name: "hdrColor", binding: 1, kind: "texture" },
      ...(autoExposure === null
        ? []
        : [
            {
              name: "autoExposure",
              binding: 2,
              kind: "texture" as const,
              textureSampleType: "unfilterable-float" as const,
            },
          ]),
    ],
  });
  setEffectTexture(effect, 1, hdr.texture);
  if (autoExposure !== null) {
    setEffectTexture(effect, 2, autoExposure.exposureTexture);
  }
  // What the output pass reads: the scene, or the last linear effect a PostProcessStack put first.
  let outputSource: Texture2D | null = null;
  // A resize swaps the texture behind the facade; the wrapper's cached bind group still holds the
  // old view until a texture write marks it dirty.
  onRenderTargetTextureResize(hdr, () => {
    setEffectTexture(effect, 1, outputSource ?? hdr.texture);
  });
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  uniforms[0] = Number.NaN;
  writeHdrOutputUniforms(scene.imageProcessing, uniforms);
  setEffectUniforms(effect, uniforms);

  const sceneColor = createRenderTarget({ lbl: "ignifx:scene-color", format: engine.format, samples: 1, size: engine });
  const toChain: Task = createEffectRenderTask(
    { name: HDR_OUTPUT_TASK_NAMES.toChain, effect, target: sceneColor, clear: true },
    engine,
    scene,
  );
  const toSwapchain: Task = createEffectRenderTask(
    { name: HDR_OUTPUT_TASK_NAMES.toSwapchain, effect, target: engine.scRT, clear: true },
    engine,
    scene,
  );
  addTask(scene, toChain);
  addTask(scene, toSwapchain);
  toChain.executionEnabled = false;

  const plugins: LinearPlugins = {
    pbr: createLinearOutputPlugin(),
    unlit: createUnlitLinearPlugin(),
    standard: createStandardLinearPlugin(),
  };
  let linearFog: FogConfig | null = null;
  const handle: HdrOutputHandle = {
    sceneTexture: hdr.texture,
    exposureTexture: autoExposure?.exposureTexture ?? null,
    update(isSceneRegistered: boolean): void {
      autoExposure?.update();
      if (writeHdrOutputUniforms(scene.imageProcessing, uniforms)) {
        setEffectUniforms(effect, uniforms);
      }
      // The `Environment` installs a fresh sRGB config on every change; it is swapped for a decoded
      // copy once, before the frame reads it (`setFog` re-registers nothing it already has).
      const fog = scene.fog;
      if (fog !== null && fog !== linearFog) {
        linearFog = linearFogConfig(fog);
        setFog(scene, linearFog);
      }
      attachLinearOutput(scene, plugins, isSceneRegistered);
    },
    insertLinearTask(task: Task, isFrameGraphBuilt: boolean): void {
      addTaskBefore(scene, task, toChain);
      if (isFrameGraphBuilt) {
        buildFrameGraphTask(getFrameGraph(scene), task);
      }
    },
    setOutputSource(texture: Texture2D | null): void {
      if (texture === outputSource) {
        return;
      }
      outputSource = texture;
      setEffectTexture(effect, 1, texture ?? hdr.texture);
    },
  };
  let isPresentEnabled = true;
  return {
    sceneColor,
    swapchain: engine.scRT,
    setPresentEnabled(enabled: boolean): void {
      isPresentEnabled = enabled;
      toSwapchain.executionEnabled = enabled;
      toChain.executionEnabled = !enabled;
    },
    get isPresentEnabled(): boolean {
      return isPresentEnabled;
    },
    hdr: handle,
  };
}

/** The two shared plugins the per-frame walk hands out. */
interface LinearPlugins {
  /** The save, restore and fog for PBR materials, PBR skyboxes included. */
  readonly pbr: MaterialPlugin;
  /** The recompute and fog for unlit PBR materials. */
  readonly unlit: MaterialPlugin;
  /** The decode for Standard materials. */
  readonly standard: MaterialPlugin;
}

/**
 * Makes Lite's environment skyboxes write linear colour (see {@link linearSkyboxFragment}).
 *
 * @remarks
 * Lite composes a skybox's fragment through `scene._environmentSkyboxShaderComposer`, which runs the
 * loaders in `scene._environmentSkyboxShaderPatchLoaders` in order
 * (`lib/material/pbr/environment-skybox-shader-composer.js`). Neither field is declared in
 * `index.d.ts`, and the composer is created only by Lite's own registration, which also prepends
 * the scene uniforms the `.env` skybox needs. `setEnvironmentRotation(scene, 0)` is that
 * registration with no visible effect (rotation 0 is what the scene has); the `Environment`
 * overwrites it with its own rotation later. The patch is installed before any environment loads,
 * and pinned by `test/render/hdr-coverage.browser.test.ts`.
 *
 * @param scene - The HDR scene.
 */
function installLinearSkybox(scene: SceneContext): void {
  setEnvironmentRotation(scene, 0);
  // Boundary assertion (coding standards §5.2): the loader list is a plain array Lite keeps on the
  // scene object it created; see the remarks for the `lib/` file that reads it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const slots = scene as SceneContext & SkyboxPatchSlots;
  // oxlint-disable-next-line no-underscore-dangle
  const loaders = (slots._environmentSkyboxShaderPatchLoaders ??= []);
  loaders[SKYBOX_PATCH_ORDER] = () => Promise.resolve({ _apply: linearSkyboxFragment });
}

/** The undeclared Lite scene field the skybox patch writes (adapter-internal mirror, standards §5.1). */
interface SkyboxPatchSlots {
  /** Lite's skybox shader patches, by order; each resolves to an object whose `_apply` edits the WGSL. */
  _environmentSkyboxShaderPatchLoaders?: (SkyboxPatchLoader | undefined)[];
}

/** One entry of Lite's skybox patch list. */
type SkyboxPatchLoader = () => Promise<{ readonly _apply: (fragment: string, kind: string) => string }>;

/**
 * Gives every PBR and Standard material in the scene its linear-output plugin, once.
 *
 * @remarks
 * A walk rather than a hook at material creation, because materials come from several places
 * (material assets, glTF models, `.lite` code) and a surface shader replaces a material's whole
 * plugin list; a material that lost the plugin gets it back on the next frame. A PBR skybox
 * (`setPbrSkybox`) is a PBR material and gets the PBR plugin. Lite's mesh factories leave
 * `material` `null` until one is assigned.
 *
 * @param scene - The scene to walk.
 * @param shared - The shared plugins.
 * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
 */
function attachLinearOutput(scene: SceneContext, shared: LinearPlugins, isSceneRegistered: boolean): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`
    // (`lib/mesh/mesh-factories.js`), and `isPbrMaterial(null)` throws.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null) {
      continue;
    }
    let plugin: MaterialPlugin;
    if (isPbrMaterial(material)) {
      plugin = getPbrUnlit(material) === undefined ? shared.pbr : shared.unlit;
    } else if (isStandardMaterial(material)) {
      plugin = shared.standard;
    } else {
      continue;
    }
    const current = material.plugins ?? [];
    // A PBR material that became unlit, or stopped being so, swaps one plugin for the other.
    let stale: MaterialPlugin | null = null;
    if (plugin === shared.pbr) {
      stale = shared.unlit;
    } else if (plugin === shared.unlit) {
      stale = shared.pbr;
    }
    const hasStale = stale !== null && current.includes(stale);
    if (current.includes(plugin) && !hasStale) {
      continue;
    }
    const kept = hasStale ? current.filter((other) => other !== stale) : current;
    material.plugins = kept.includes(plugin) ? kept : [...kept, plugin];
    if (plugin === shared.standard) {
      // The Standard bridge bakes a plugin signature per material, which only happens for meshes it
      // saw at `enableMaterialPlugins` or at a material change; this bakes and rebuilds it now.
      void reconcileMaterialPlugins(scene, material);
      continue;
    }
    if (isSceneRegistered) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}
