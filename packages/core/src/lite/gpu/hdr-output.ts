import {
  AcesToneMapping,
  addTask,
  createEffectRenderTask,
  createEffectWrapper,
  createRenderTarget,
  createRenderTask,
  createSurfaceRenderTargetTexture,
  enableMaterialPlugins,
  isPbrMaterial,
  isPbrSkybox,
  NeutralToneMapping,
  onRenderTargetTextureResize,
  setEffectTexture,
  setEffectUniforms,
  StandardToneMapping,
} from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import { DEPTH_STENCIL_FORMAT } from "./render-path.js";
import type { AutoExposurePass } from "./auto-exposure.js";
import type { HdrOutputHandle, ScenePresenter } from "./render-path.js";
import type {
  EffectWrapper,
  EngineContext,
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
 * [shadow] → scene ──→ hdr (rgba16float) ──→ output ──→ swapchain
 *                                              └──→ sceneColor ─ (a PostProcessStack's chain)
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
 * Not yet covered (step G3): fog is dropped with the restore; Standard materials, surface shaders,
 * sprites, particles and the skybox still write encoded colour, which the output pass encodes again.
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
    CUSTOM_FRAGMENT_DEFINITIONS: "var<private> ignifxLinearColor: vec3<f32>;",
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "ignifxLinearColor = color;",
    CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color = ignifxLinearColor;",
  };
  return {
    name: LINEAR_OUTPUT_PLUGIN_NAME,
    priority: 0,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
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
  // A resize swaps the texture behind the facade; the wrapper's cached bind group still holds the
  // old view until a texture write marks it dirty.
  onRenderTargetTextureResize(hdr, () => {
    setEffectTexture(effect, 1, hdr.texture);
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

  const plugin = createLinearOutputPlugin();
  const handle: HdrOutputHandle = {
    sceneTexture: hdr.texture,
    exposureTexture: autoExposure?.exposureTexture ?? null,
    update(isSceneRegistered: boolean): void {
      autoExposure?.update();
      if (writeHdrOutputUniforms(scene.imageProcessing, uniforms)) {
        setEffectUniforms(effect, uniforms);
      }
      attachLinearOutput(scene, plugin, isSceneRegistered);
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

/**
 * Gives every PBR material in the scene the linear-output plugin, once.
 *
 * @remarks
 * A walk rather than a hook at material creation, because PBR materials come from several places
 * (material assets, glTF models, `.lite` code) and a surface shader replaces a material's whole
 * plugin list; a material that lost the plugin gets it back on the next frame. The skybox is left
 * alone: it is not lit and G3 handles it.
 *
 * @param scene - The scene to walk.
 * @param plugin - The shared plugin.
 * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
 */
function attachLinearOutput(scene: SceneContext, plugin: MaterialPlugin, isSceneRegistered: boolean): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    if (material === undefined || !isPbrMaterial(material) || isPbrSkybox(material)) {
      continue;
    }
    const plugins = material.plugins ?? [];
    if (plugins.includes(plugin)) {
      continue;
    }
    material.plugins = [...plugins, plugin];
    if (isSceneRegistered) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}
