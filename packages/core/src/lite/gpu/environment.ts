import {
  AcesToneMapping,
  loadEnvironment,
  loadSkybox,
  NeutralToneMapping,
  setEnvironmentBlur,
  setEnvironmentRotation,
  setSceneImageProcessing,
  StandardToneMapping,
} from "@babylonjs/lite";
import { assertNever } from "../../errors/ignifx-error.js";
import { degToRad } from "../../math/math-utils.js";
import type { EnvironmentTextures, SceneContext, ToneMapping } from "@babylonjs/lite";

/**
 * Environment half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.5): image
 * based lighting, the skybox, fog, image processing, and the clear colour.
 *
 * Everything here is `@internal`. Loading uploads cube maps, so the module is GPU-only.
 *
 * ## The BRDF LUT is mandatory (verified against `@babylonjs/lite@1.27.0`)
 *
 * `loadEnvironment(scene, url, options)` (`index.d.ts` 6779) takes a **required** `brdfUrl`: Lite
 * decodes the split-sum BRDF lookup table from a pre-baked RGBD PNG rather than computing it, "for
 * pixel-perfect parity" with Babylon.js (`lib/_chunks/env-helpers-*.js`, `loadBrdfImage`, which
 * `fetch`es the URL and decodes it with `createImageBitmap`). ignifx ships that PNG as
 * `tests/fixtures/assets/brdf-lut.png`, decoded from Babylon.js's own
 * `_environmentBRDFBase64Texture` (`packages/dev/core/src/Misc/brdfTextureTools.ts`, Apache-2.0).
 * It is 256×256 RGBA8 and 23 KB.
 *
 * ## Fog
 *
 * `SceneContext.fog` is `FogConfig | null` (`index.d.ts` 5350) with a numeric `mode`; Lite exports
 * no named constants for it, so {@link FOG_MODES} maps ignifx's names onto the numbers.
 *
 * ## Image processing
 *
 * `setSceneImageProcessing` is **async** (`index.d.ts` 10917) because tone mapping is baked into
 * the PBR shaders at `registerScene` time; changing it recompiles the affected pipelines
 * (`rebuildScenePbrPipelines`). Setting exposure or contrast alone still goes through the same
 * call. Note that `loadEnvironment` **overwrites** all three (`toneMappingEnabled = true`,
 * `exposure = 0.8`, `contrast = 1.2`) as a side effect of installing an environment, which is why
 * the `Environment` component re-applies its own image processing after every install.
 *
 * ## Swapping the installed environment: `scene._envTextures`
 *
 * Lite 1.27.0 declares **no** public way to replace, clear, or read back a registered scene's
 * environment. `index.d.ts` has no `scene.environmentTexture`, no `unloadEnvironment`, and no
 * setter of any kind; `loadEnvironment` is the only installer and it fetches, decodes, and uploads
 * a fresh cube map every call. What it actually installs is one field —
 * `scene._envTextures = textures` (`lib/_chunks/env-helpers-CRI1i-A3.js` 24, and the same line in
 * `lib/loader-hdr/load-hdr.js` 23, `lib/loader-env/load-dds-env.js` 177 and
 * `lib/loader-gltf/gltf-ext-lights-image-based.js` 65) — and every consumer reads that field:
 *
 * - the PBR group builder, which bakes the cube view and sampler into each material's bind group
 *   (`lib/material/pbr/pbr-material.js` 12 → `lib/material/pbr/pbr-renderable.js`);
 * - the scene-uniform packer, for `lodGenerationScale` (`lib/frame-graph/scene-uniforms-pack.js` 21);
 * - the env UBO contributor, for the diffuse spherical harmonics (`lib/scene/scene-ubo-extras.js` 24);
 * - the blur contributor, for `lodGenerationOffset` (`lib/scene/set-environment-blur.js` 8);
 * - the render task's scene-UBO cache key, which is keyed on the **object identity** of the field
 *   (`lib/frame-graph/render-task.js` 358), so a new object re-uploads the harmonics by itself.
 *
 * Lite's own device-lost recovery replaces the field exactly this way
 * (`lib/loader-env/environment-recovery.js` 16 and 38), so {@link installSceneEnvironment} writes it
 * too. Bind groups are the one consumer that does *not* re-read it: they hold the `GPUTextureView`,
 * so a swap only reaches the specular reflection once the material groups have been rebuilt, which
 * `rebuildSceneRenderables` does (`lib/scene/scene-rebuild.js`, `rebuildEachGroup`). The
 * `Environment` component therefore reports an install as a topology change and lets the render-sync
 * system fire its one coalesced rebuild. This is the only place in ignifx that touches a Lite field
 * `index.d.ts` does not declare, which is what the adapter boundary exists for
 * (`CONSTITUTION.md` §3.4, ADR-0002); it is pinned by
 * `packages/core/test/lite/render/environment.browser.test.ts`, which fails loudly if the field is
 * renamed.
 */

/**
 * The GPU-resident image-based-lighting textures `loadEnvironment` resolves to, re-exported under an
 * ignifx name (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteEnvironmentTextures = EnvironmentTextures;

/**
 * ignifx fog mode names mapped to the numbers `FogConfig.mode` uses.
 *
 * @internal
 */
export const FOG_MODES = {
  /** No fog. */
  none: 0,
  /** Exponential fog. */
  exp: 1,
  /** Squared-exponential fog. */
  exp2: 2,
  /** Linear fog between `start` and `end`. */
  linear: 3,
} as const;

/**
 * The union of the fog mode names.
 *
 * @internal
 */
export type FogMode = keyof typeof FOG_MODES;

/**
 * The tone-mapping curves `docs/architecture/07-rendering.md` §2.5 exposes.
 *
 * @public
 */
export const TONE_MAPPING_NAMES = ["none", "standard", "aces", "neutral"] as const;

/**
 * The union of the tone-mapping curve names.
 *
 * @internal
 */
export type ToneMappingName = (typeof TONE_MAPPING_NAMES)[number];

/**
 * How an ignifx `Environment` component configures image based lighting.
 *
 * @internal
 */
export interface EnvironmentLoadOptions {
  /** The `.env` file holding the prefiltered specular cube map and its spherical harmonics. */
  readonly url: string;
  /** The RGBD PNG BRDF lookup table. Required by Lite. */
  readonly brdfUrl: string;
  /** A `.dds` or `.env` skybox. Omit for a flat background. */
  readonly skyboxUrl?: string;
  /** The skybox cube's size, in metres. Lite defaults to 20. */
  readonly skyboxSize?: number;
  /** Skip the skybox entirely. */
  readonly skipSkybox?: boolean;
  /** Skip the reflective ground plane Lite would otherwise add. */
  readonly skipGround?: boolean;
  /** A texture for that ground plane. */
  readonly groundTextureUrl?: string;
}

/**
 * Loads an `.env` environment and installs it on a scene.
 *
 * @param scene - The scene to light.
 * @param options - The environment, BRDF, and skybox URLs.
 * @returns The GPU-resident environment textures, for materials that need them explicitly.
 *
 * @example
 * ```ts
 * await loadSceneEnvironment(scene, {
 *   url: "environments/studio.env",
 *   brdfUrl: "environments/brdf-lut.png",
 * });
 * ```
 *
 * @internal
 */
export function loadSceneEnvironment(
  scene: SceneContext,
  options: EnvironmentLoadOptions,
): Promise<EnvironmentTextures> {
  const liteOptions: {
    brdfUrl: string;
    skyboxUrl?: string;
    skyboxSize?: number;
    skipSkybox?: boolean;
    skipGround?: boolean;
    groundTextureUrl?: string;
  } = { brdfUrl: options.brdfUrl };
  if (options.skyboxUrl !== undefined) {
    liteOptions.skyboxUrl = options.skyboxUrl;
  }
  if (options.skyboxSize !== undefined) {
    liteOptions.skyboxSize = options.skyboxSize;
  }
  if (options.skipSkybox !== undefined) {
    liteOptions.skipSkybox = options.skipSkybox;
  }
  if (options.skipGround !== undefined) {
    liteOptions.skipGround = options.skipGround;
  }
  if (options.groundTextureUrl !== undefined) {
    liteOptions.groundTextureUrl = options.groundTextureUrl;
  }
  return loadEnvironment(scene, options.url, liteOptions);
}

/**
 * The scene fields Babylon Lite 1.27.0 writes for image-based lighting but does not declare in
 * `index.d.ts`. Adapter-internal Lite mirror (coding standards §5.1); see the module header for the
 * `lib/` lines that prove each one.
 */
interface SceneEnvironmentSlot {
  /** What `loadEnvironment` installed, or `undefined` on a scene that has never had one. */
  _envTextures?: EnvironmentTextures | undefined;
}

/**
 * Views a scene through its undeclared environment slot.
 *
 * @param scene - The scene.
 * @returns The same object, typed so the slot is reachable.
 */
function environmentSlotOf(scene: SceneContext): SceneEnvironmentSlot {
  // Boundary assertion (coding standards §5.2): `SceneContext` is a plain object literal Lite
  // creates in `lib/scene/scene-core.js`, and `_envTextures` is one of its own fields — it is
  // absent from `index.d.ts` because it is not part of Lite's declared surface, not because it is
  // a different object. See the module header for every `lib/` line that reads or writes it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return scene as SceneContext & SceneEnvironmentSlot;
}

/**
 * Reports which environment textures a scene is currently lit by.
 *
 * @param scene - The scene to inspect.
 * @returns The installed textures, or `null` when no environment has ever been installed.
 *
 * @internal
 */
export function readSceneEnvironment(scene: SceneContext): EnvironmentTextures | null {
  // The underscore is Lite's, not ignifx's: coding standards §5.1 reserves `_field` for exactly
  // this, an adapter-internal mirror of a Lite field, and the module header proves the name.
  // oxlint-disable-next-line no-underscore-dangle
  return environmentSlotOf(scene)._envTextures ?? null;
}

/**
 * Points a scene at an already-loaded set of environment textures, without loading anything.
 *
 * @remarks
 * This is how an `Environment` component swaps environments at runtime: the textures belong to the
 * `EnvironmentAsset` that loaded them and stay alive as long as its handle is retained, so
 * switching between two loaded assets uploads nothing and frees nothing.
 *
 * The specular reflection follows only after the scene's material groups are rebuilt
 * (`rebuildRenderables` in `../shadow.ts`): a PBR bind group holds the cube map's `GPUTextureView`,
 * not the slot. The diffuse harmonics and the LOD scale follow immediately, because the render
 * task's scene-UBO cache is keyed on this object's identity.
 *
 * @param scene - The scene to light.
 * @param textures - The textures to light it with.
 * @returns `true` when the scene was lit by something else and now is not — the caller owes a
 * renderable rebuild; `false` when these textures were already installed and nothing was written.
 *
 * @example
 * ```ts
 * if (installSceneEnvironment(scene, asset.lite.textures)) {
 *   await rebuildRenderables(scene);
 * }
 * ```
 *
 * @internal
 */
export function installSceneEnvironment(scene: SceneContext, textures: EnvironmentTextures): boolean {
  const slot = environmentSlotOf(scene);
  // As in `readSceneEnvironment`: an adapter-internal Lite mirror (coding standards §5.1).
  // oxlint-disable-next-line no-underscore-dangle
  if (slot._envTextures === textures) {
    return false;
  }
  // oxlint-disable-next-line no-underscore-dangle
  slot._envTextures = textures;
  return true;
}

/**
 * Loads a six-face cube-map skybox from a base URL.
 *
 * @param scene - The scene to give a background.
 * @param baseUrl - The URL prefix each face name is appended to.
 * @param extension - The face file extension, such as `".jpg"`.
 * @param size - The skybox cube's size, in metres.
 * @returns A promise that resolves when the faces are uploaded.
 *
 * @internal
 */
export function loadSceneSkybox(scene: SceneContext, baseUrl: string, extension: string, size?: number): Promise<void> {
  return loadSkybox(scene, baseUrl, extension, size);
}

/**
 * Rotates the environment around the world Y axis.
 *
 * @param scene - The scene to rotate the environment of.
 * @param degrees - The rotation, in degrees.
 *
 * @internal
 */
export function setSceneEnvironmentRotation(scene: SceneContext, degrees: number): void {
  setEnvironmentRotation(scene, degToRad(degrees));
}

/**
 * Blurs the environment's specular reflection.
 *
 * @param scene - The scene to change.
 * @param blur - The blur amount, 0 to 1.
 *
 * @internal
 */
export function setSceneEnvironmentBlur(scene: SceneContext, blur: number): void {
  setEnvironmentBlur(scene, blur);
}

/**
 * Sets the colour the scene is cleared to each frame.
 *
 * @param scene - The scene to change.
 * @param r - The linear red component, 0 to 1.
 * @param g - The linear green component, 0 to 1.
 * @param b - The linear blue component, 0 to 1.
 * @param a - The alpha component; only meaningful with a premultiplied canvas alpha mode.
 *
 * @internal
 */
export function setSceneClearColor(scene: SceneContext, r: number, g: number, b: number, a: number): void {
  const clear = scene.clearColor;
  clear.r = r;
  clear.g = g;
  clear.b = b;
  clear.a = a;
}

/**
 * Configures the scene's fog, or turns it off.
 *
 * @param scene - The scene to change.
 * @param mode - The fog falloff, or `"none"` to disable it.
 * @param r - The linear red component of the fog colour.
 * @param g - The linear green component.
 * @param b - The linear blue component.
 * @param density - The density, for the exponential modes.
 * @param start - Where linear fog begins, in metres.
 * @param end - Where linear fog reaches full strength, in metres.
 *
 * @internal
 */
export function setSceneFog(
  scene: SceneContext,
  mode: FogMode,
  r: number,
  g: number,
  b: number,
  density: number,
  start: number,
  end: number,
): void {
  if (mode === "none") {
    scene.fog = null;
    return;
  }
  const existing = scene.fog;
  if (existing === null) {
    scene.fog = { mode: FOG_MODES[mode], density, start, end, color: [r, g, b] };
    return;
  }
  existing.mode = FOG_MODES[mode];
  existing.density = density;
  existing.start = start;
  existing.end = end;
  const color = existing.color;
  color[0] = r;
  color[1] = g;
  color[2] = b;
}

/**
 * Sets exposure, contrast, and the tone-mapping curve.
 *
 * @remarks
 * Asynchronous by nature: tone mapping is compiled into the PBR shaders, so changing it after
 * `registerScene` recompiles the scene's PBR pipelines. Exposure and contrast alone are uniform
 * values, but Lite routes them through the same call.
 *
 * @param scene - The scene to change.
 * @param exposure - The exposure multiplier.
 * @param contrast - The contrast multiplier.
 * @param toneMapping - The curve, or `"none"` to leave the colour untouched.
 * @returns A promise that resolves when any affected pipeline has been rebuilt.
 *
 * @internal
 */
export function setSceneImageProcessingOptions(
  scene: SceneContext,
  exposure: number,
  contrast: number,
  toneMapping: ToneMappingName,
): Promise<void> {
  if (toneMapping === "none") {
    return setSceneImageProcessing(scene, { exposure, contrast, toneMappingEnabled: false });
  }
  return setSceneImageProcessing(scene, {
    exposure,
    contrast,
    toneMappingEnabled: true,
    toneMapping: toneMappingCurve(toneMapping),
  });
}

/**
 * Maps an ignifx tone-mapping name onto the Lite curve object.
 *
 * @param name - The curve name; `"none"` is handled by the caller.
 * @returns The Lite curve.
 */
function toneMappingCurve(name: Exclude<ToneMappingName, "none">): ToneMapping {
  switch (name) {
    case "standard":
      return StandardToneMapping;
    case "aces":
      return AcesToneMapping;
    case "neutral":
      return NeutralToneMapping;
    default:
      return assertNever(name, "tone mapping");
  }
}
