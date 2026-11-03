import { NO_RENDERING_FEATURES, RENDERING_FEATURE_NAMES } from "../lite/render-features.js";
import { bool, color, enumOf, f64, map, record, str, u32 } from "../schema/field-kinds.js";
import { defineSchema } from "../schema/schema.js";
import type { RendererOptions } from "../lite/render-diagnostics.js";
import type { RenderingFeatureName, RenderingFeatures } from "../lite/render-features.js";
import type { ColorLike } from "../math/types.js";
import type { Schema } from "../schema/types.js";

/**
 * The `rendering` project settings section (`docs/architecture/04-extensions.md` §5,
 * `07-rendering.md` §1 and §1.1): the engine options the swapchain is created with, and the feature
 * opt-ins that have to be applied before the scene is registered.
 *
 * Three decisions the documents left open, and one place they are wrong:
 *
 * - **There is no `powerPreference`.** `07-rendering.md` §1 lists it among "engine options exposed
 *   by `createApp`". Babylon Lite 1.27.0 has no such option — `lib/engine/engine.js` hard-codes
 *   `requestAdapter({ powerPreference: "high-performance" })` and neither `EngineOptions`
 *   (`index.d.ts` 4709) nor `SurfaceOptions` (12622) declares it — so ignifx does not expose one.
 *   The correction is recorded in `src/lite/render-diagnostics.ts` as well.
 * - **`maxDevicePixelRatio` defaults to `0`, not `Infinity`.** §1 says the default is "`Infinity`,
 *   i.e. native DPR", and that is the behaviour; but a settings section is validated JSON, and
 *   `Infinity` is not a JSON number (`06-serialization-and-scene-format.md` §3 rejects non-finite
 *   values with `IGX-0601`). `0` is the spelling of "do not clamp", and it is what the section
 *   documents.
 * - **`brdfLut` lives here.** Lite's `loadEnvironment` takes a **required** `brdfUrl`
 *   (`index.d.ts` 6779): it decodes the split-sum lookup table from a pre-baked RGBD PNG rather than
 *   computing it. No document says where a game gets that file, so the section carries the address
 *   and every `Environment` component resolves it through the asset service. An `Environment` may
 *   override it per instance.
 * - **`resolutionScale` is not a setting.** §1 makes it a live quality knob (`app.renderer
 *   .resolutionScale`), so it is a `Renderer` property with no settings counterpart; a project that
 *   wants a fixed one writes `maxDevicePixelRatio`.
 */

/**
 * The canvas alpha modes Lite accepts, in the order the inspector lists them.
 *
 * @public
 */
export const CANVAS_ALPHA_MODES = ["opaque", "premultiplied"] as const;

/**
 * The union of the canvas alpha modes.
 *
 * @public
 */
export type CanvasAlphaMode = (typeof CANVAS_ALPHA_MODES)[number];

/**
 * The rendering features a project switches on (`docs/architecture/07-rendering.md` §1.1). Every one
 * of them changes what Lite compiles at `registerScene`, so they are declared up front and a late
 * toggle is `IGX-0704`.
 *
 * @public
 */
export interface RenderingFeatureSettings {
  /** Register the scene with a shadow pass, so a `Light` can cast. */
  readonly shadows: boolean;
  /**
   * Render the scene into an offscreen target and composite it, so a `PostProcessStack` has
   * something it is allowed to sample. Off by default: it costs one full-screen blit per frame.
   */
  readonly postProcessing: boolean;
  /** Compile the Standard pipeline's skinning fragment, for skinned meshes. */
  readonly skeletons: boolean;
  /** Build the glTF loader's skeleton handles, needed before loading a skinned asset. */
  readonly boneControl: boolean;
  /** Install stencil resolvers on the PBR, Standard, and Shader pipelines. */
  readonly stencil: boolean;
  /** Load the PBR lightmap fragment extension. */
  readonly lightmaps: boolean;
  /** Install the material plugin bridges and the scene hook they need. */
  readonly materialPlugins: boolean;
  /** Compile shader pipelines asynchronously instead of blocking the first draw. */
  readonly asyncPipelines: boolean;
  /** Rebuild scenes and their resources after the WebGPU device is lost. */
  readonly deviceLostRecovery: boolean;
}

/**
 * Auto exposure under `rendering.hdr` (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G14):
 * a compute pass meters the HDR scene and eases the exposure towards middle grey.
 *
 * @remarks
 * EV here is `log2` of the scene's metered luminance (the average of a `log2` luminance histogram,
 * the darkest 10% and brightest 10% dropped). The exposure maps that average to 0.18 and multiplies
 * the scene before the `Environment`'s own exposure and curve, so the two compose.
 *
 * @public
 */
export interface AutoExposureSettings {
  /** Meter the scene and adapt the exposure. Off by default; needs `rendering.hdr`. */
  readonly enabled: boolean;
  /** The darkest metered EV the exposure follows: a darker scene is not brightened further. */
  readonly minEv: number;
  /** The brightest metered EV the exposure follows: a brighter scene is not darkened further. */
  readonly maxEv: number;
  /** Adaptation rate, per second, when the scene gets brighter. */
  readonly speedUp: number;
  /** Adaptation rate, per second, when the scene gets darker. */
  readonly speedDown: number;
  /** Stops added to the computed exposure; positive is brighter. */
  readonly compensation: number;
}

/**
 * Temporal anti-aliasing, the `rendering.taa` record (`docs/architecture/07-rendering.md` §2.13).
 *
 * @remarks
 * Needs `rendering.hdr`: TAA runs on the linear scene colour between the scene pass and the HDR
 * output pass. With `hdr` off it stays off and the app logs a warning. Nothing of it loads while
 * `enabled` is `false`.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, settings: { rendering: { hdr: true, taa: { enabled: true } } } });
 * ```
 *
 * @public
 */
export interface TaaSettings {
  /** Turn TAA on. Off by default. */
  readonly enabled: boolean;
  /** Weight of the current frame, 0.01–1. Lower is smoother but slower to follow change. Default 0.1. */
  readonly blend: number;
  /** Output sharpening, 0–1, to offset the softening TAA brings. Default 0. */
  readonly sharpness: number;
  /** Clip history to the current pixel's neighbourhood, which prevents ghosting. Default `true`. */
  readonly clamp: boolean;
  /**
   * How far, in world units, the camera may move in one frame before the history is dropped as a
   * camera cut. A turn of more than 60° in one frame is a cut too. Default 10.
   */
  readonly cutDistance: number;
}

/**
 * The resolved `rendering` settings section
 * (`docs/architecture/04-extensions.md` §5, `07-rendering.md` §1).
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   settings: { rendering: { features: { shadows: true }, msaaSamples: 1 } },
 * });
 * ```
 *
 * @public
 */
export interface RenderingSettings {
  /** The feature opt-ins, applied during `app.start()` before the scene is registered. */
  readonly features: RenderingFeatureSettings;
  /** MSAA sample count for the main pass. WebGPU allows 1 or 4; anything else is read as 4. */
  readonly msaaSamples: number;
  /** How the canvas composites with the page. `"premultiplied"` lets HTML show through. */
  readonly alphaMode: CanvasAlphaMode;
  /** Render through an sRGB swapchain view so alpha blending is gamma-correct. */
  readonly srgb: boolean;
  /** An explicit swapchain texture format; empty means Lite's own choice. Never an `*-srgb` one. */
  readonly format: string;
  /** Clamp on the device pixel ratio the swapchain is sized at. `0` means "do not clamp". */
  readonly maxDevicePixelRatio: number;
  /** Float64 intermediate precision for world matrices, for large worlds. */
  readonly useHighPrecisionMatrix: boolean;
  /** Eye-relative upload for large-world coordinates. Requires `useHighPrecisionMatrix`. */
  readonly useFloatingOrigin: boolean;
  /** Extra WebGPU device limits to request, such as a larger `maxColorAttachmentBytesPerSample`. */
  readonly requiredLimits: Readonly<Record<string, number>>;
  /**
   * The colour the scene is cleared to each frame, in sRGB.
   *
   * @remarks
   * Applied to the render scene as it is created, which makes it the floor of a three-step
   * precedence (`docs/architecture/07-rendering.md` §2.1, §2.5): `Camera.clearColor` on the main
   * camera wins whenever it is not `null`, an `Environment.clearColor` that is not `null` wins over
   * this setting, and
   * this setting wins over Babylon Lite's own mid grey. Whichever wins goes through
   * `Environment.imageProcessing` like a fully fogged fragment of the same colour, so it presents as
   * authored only while there is no exposure, contrast or tone-mapping curve.
   */
  readonly clearColor: ColorLike;
  /** The address of the RGBD BRDF lookup table `loadEnvironment` requires. */
  readonly brdfLut: string;
  /**
   * Render the scene into a floating-point (`rgba16float`) target and tone map it in one final pass.
   *
   * @remarks
   * Off by default, and nothing of it loads while it is off. On, PBR materials keep their linear
   * colour, which may go above 1, and a final output pass applies the `Environment`'s exposure,
   * contrast and tone-mapping curve and encodes the result for the screen. Fog, Standard and unlit
   * materials, surface shaders, custom `.wgsl` materials (particles, foliage) and the `.env`/`.dds`
   * skybox are carried in linear colour too, and sprites draw after the output pass, so with the
   * default image processing a scene looks the same either way; under a tone-mapping curve, Standard
   * and custom-shader colour now goes through it as well. A `PostProcessStack`'s custom effects
   * ordered before any built-in one see linear colour. Lite's six-face `loadSkybox` cube is not
   * covered (`docs/architecture/07-rendering.md` §2.7). Later effects (HDR bloom, auto exposure)
   * need it on.
   */
  readonly hdr: boolean;
  /**
   * Auto exposure, read once at `app.start()`. Ignored unless {@link RenderingSettings.hdr} is on;
   * off, nothing of it loads.
   */
  readonly autoExposure: AutoExposureSettings;
  /** Temporal anti-aliasing; needs {@link RenderingSettings.hdr}. Off by default. */
  readonly taa: TaaSettings;
}

/**
 * The name the `rendering` project settings section is registered under.
 *
 * @public
 */
export const RENDERING_SETTINGS_SECTION = "rendering";

/**
 * The BRDF lookup table address an `Environment` uses when neither it nor the project names one.
 *
 * @public
 */
export const DEFAULT_BRDF_LUT_ADDRESS = "environments/brdf-lut.png";

/** Lite's own MSAA default (`index.d.ts` 4709). */
const DEFAULT_MSAA_SAMPLES = 4;

/** The only other sample count WebGPU allows for a multisampled attachment. */
const SINGLE_SAMPLE = 1;

/**
 * The auto exposure a project that names none gets: off, metering EV −6 to 6, adapting at 2 per
 * second towards brighter scenes and 1 towards darker ones, with no compensation.
 *
 * @returns A fresh record.
 *
 * @public
 */
export function defaultAutoExposureSettings(): AutoExposureSettings {
  return { enabled: false, minEv: -6, maxEv: 6, speedUp: 2, speedDown: 1, compensation: 0 };
}

/**
 * The TAA record a project that names none gets: off.
 *
 * @returns A fresh record.
 */
function defaultTaaSettings(): TaaSettings {
  return { enabled: false, blend: 0.1, sharpness: 0, clamp: true, cutDistance: 10 };
}

/** The clear colour a project that names none gets: opaque black. */
const DEFAULT_CLEAR_COLOR = "#000000";

/**
 * The settings a project that declares no `rendering` section runs with: every feature off, Lite's
 * own swapchain defaults, and an unclamped device pixel ratio.
 *
 * @returns A fresh, complete section. It is built on demand rather than frozen at module scope
 * because `requiredLimits` and `clearColor` are mutable objects a caller must not share
 * (`CONSTITUTION.md` §3.5).
 *
 * @example
 * ```ts
 * const defaults = defaultRenderingSettings();
 * defaults.features.shadows; // false
 * ```
 *
 * @public
 */
export function defaultRenderingSettings(): RenderingSettings {
  return {
    features: { ...NO_RENDERING_FEATURES },
    msaaSamples: DEFAULT_MSAA_SAMPLES,
    alphaMode: "opaque",
    srgb: false,
    format: "",
    maxDevicePixelRatio: 0,
    useHighPrecisionMatrix: false,
    useFloatingOrigin: false,
    requiredLimits: {},
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
    brdfLut: DEFAULT_BRDF_LUT_ADDRESS,
    hdr: false,
    autoExposure: defaultAutoExposureSettings(),
    taa: defaultTaaSettings(),
  };
}

/**
 * Builds the schema the `rendering` section is validated against.
 *
 * @returns The schema. Built on demand: a schema field is a function call, and module scope holds
 * declarations only (`CONSTITUTION.md` §3.5).
 *
 * @internal
 */
export function renderingSettingsSchema(): Schema {
  return defineSchema({
    features: record({
      shadows: bool(false, { tooltip: "Register the scene with a shadow pass." }),
      postProcessing: bool(false, { tooltip: "Render through an offscreen target, for PostProcessStack." }),
      skeletons: bool(false, { tooltip: "Compile the skinning fragment for skinned meshes." }),
      boneControl: bool(false, { tooltip: "Build glTF skeleton handles while loading." }),
      stencil: bool(false, { tooltip: "Install stencil resolvers on every material pipeline." }),
      lightmaps: bool(false, { tooltip: "Load the PBR lightmap fragment extension." }),
      materialPlugins: bool(false, { tooltip: "Install the material plugin bridges." }),
      asyncPipelines: bool(false, { tooltip: "Compile shader pipelines asynchronously." }),
      deviceLostRecovery: bool(false, { tooltip: "Rebuild resources after a WebGPU device loss." }),
    }),
    msaaSamples: u32(DEFAULT_MSAA_SAMPLES, { min: 1, max: 4, tooltip: "MSAA sample count: 1 or 4." }),
    alphaMode: enumOf(CANVAS_ALPHA_MODES, "opaque", { tooltip: "How the canvas composites with the page." }),
    srgb: bool(false, { tooltip: "Render through an sRGB swapchain view." }),
    format: str("", { tooltip: "An explicit swapchain format; empty means Lite's own choice." }),
    maxDevicePixelRatio: f64(0, { min: 0, tooltip: "Device pixel ratio clamp; 0 does not clamp." }),
    useHighPrecisionMatrix: bool(false, { tooltip: "Float64 world matrices, for large worlds." }),
    useFloatingOrigin: bool(false, { tooltip: "Eye-relative upload; needs useHighPrecisionMatrix." }),
    requiredLimits: map(f64(0, { min: 0 }), { tooltip: "Extra WebGPU device limits to request." }),
    clearColor: color(DEFAULT_CLEAR_COLOR, {
      tooltip: "The colour the scene is cleared to, in sRGB. A Camera or Environment overrides it.",
    }),
    brdfLut: str(DEFAULT_BRDF_LUT_ADDRESS, { tooltip: "Address of the RGBD BRDF lookup table." }),
    hdr: bool(false, {
      tooltip:
        "Render in HDR (rgba16float) and tone map in one final pass. Custom post effects ordered first see linear colour.",
    }),
    autoExposure: record({
      enabled: bool(false, { tooltip: "Meter the HDR scene and adapt the exposure. Needs hdr." }),
      minEv: f64(-6, { tooltip: "Darkest metered EV (log2 luminance) the exposure follows." }),
      maxEv: f64(6, { tooltip: "Brightest metered EV (log2 luminance) the exposure follows." }),
      speedUp: f64(2, { min: 0, tooltip: "Adaptation rate per second when the scene gets brighter." }),
      speedDown: f64(1, { min: 0, tooltip: "Adaptation rate per second when the scene gets darker." }),
      compensation: f64(0, { tooltip: "Stops added to the computed exposure; positive is brighter." }),
    }),
    taa: record(
      {
        enabled: bool(false, { tooltip: "Temporal anti-aliasing. Needs rendering.hdr." }),
        blend: f64(0.1, { min: 0.01, max: 1, tooltip: "Weight of the current frame; lower is smoother." }),
        sharpness: f64(0, { min: 0, max: 1, tooltip: "Output sharpening, 0 to 1." }),
        clamp: bool(true, { tooltip: "Clip history to the current neighbourhood, against ghosting." }),
        cutDistance: f64(10, { min: 0, tooltip: "Camera jump per frame, in world units, that resets history." }),
      },
      { tooltip: "Temporal anti-aliasing (jittered frames accumulated over time). Needs rendering.hdr." },
    ),
  });
}

/**
 * Reads the declared feature block as the adapter's own flag record.
 *
 * @remarks
 * Every name is filled in, and anything that is not literally `true` is `false`. That is not
 * defensiveness: the settings store merges a project's section over the registered defaults
 * **shallowly** (`src/settings/settings-store.ts`), so a project that writes
 * `rendering: { features: { shadows: true } }` replaces the whole record and the other seven names
 * arrive `undefined`. Reading them as "off" is the only interpretation that matches what the
 * project wrote.
 *
 * @param settings - The resolved section.
 * @returns One boolean per feature name, in the adapter's order.
 *
 * @internal
 */
export function toRenderingFeatures(settings: RenderingSettings): RenderingFeatures {
  const declared: Partial<RenderingFeatureSettings> = settings.features;
  const features: Record<string, boolean> = {};
  for (let index = 0; index < RENDERING_FEATURE_NAMES.length; index += 1) {
    const name: RenderingFeatureName | undefined = RENDERING_FEATURE_NAMES[index];
    if (name !== undefined) {
      features[name] = declared[name] === true;
    }
  }
  // The loop wrote exactly the keys of
  // `RENDERING_FEATURE_NAMES`, which is what `RenderingFeatures` is a mapped type over.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return features as RenderingFeatures;
}

/**
 * Reads the declared `taa` record with every field filled in.
 *
 * @remarks
 * The settings store merges a section shallowly (see {@link toRenderingFeatures}), so
 * `taa: { enabled: true }` arrives without the other fields; each missing or mistyped one reads as
 * its default.
 *
 * @param settings - The resolved section.
 * @returns A complete record.
 *
 * @internal
 */
export function resolveTaaSettings(settings: RenderingSettings): TaaSettings {
  // A project that declares no `taa` (or a section built before it existed) has none at all.
  const declared: Partial<TaaSettings> = (settings as Partial<RenderingSettings>).taa ?? {};
  const defaults = defaultTaaSettings();
  return {
    enabled: declared.enabled === true,
    blend: finiteOr(declared.blend, defaults.blend),
    sharpness: finiteOr(declared.sharpness, defaults.sharpness),
    clamp: declared.clamp !== false,
    cutDistance: finiteOr(declared.cutDistance, defaults.cutDistance),
  };
}

/**
 * A declared number, or the fallback when it is missing or not finite.
 *
 * @param value - The declared value.
 * @param fallback - The default.
 * @returns The number to use.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Translates the section into the options the adapter hands `createEngine`.
 *
 * @remarks
 * `maxDevicePixelRatio: 0` is dropped rather than passed as a clamp of zero, which would size the
 * swapchain at nothing. `format: ""` is dropped for the same reason. `msaaSamples` is narrowed to
 * the two counts WebGPU allows; the schema already rejects anything outside 1–4, and 2 and 3 read
 * as 4 rather than failing an app over a quality knob.
 *
 * @param settings - The resolved section.
 * @param resolutionScale - The live `renderer.resolutionScale`, multiplied into the clamp by
 * `toLiteEngineOptions`.
 * @returns The adapter's renderer options.
 *
 * @internal
 */
export function toRendererOptions(settings: RenderingSettings, resolutionScale: number): RendererOptions {
  const options: {
    msaaSamples?: 1 | 4;
    alphaMode?: GPUCanvasAlphaMode;
    srgb?: boolean;
    pixelRatio?: number;
    resolutionScale?: number;
    useHighPrecisionMatrix?: boolean;
    useFloatingOrigin?: boolean;
    requiredLimits?: Record<string, GPUSize64 | undefined>;
  } = {
    msaaSamples: settings.msaaSamples === SINGLE_SAMPLE ? SINGLE_SAMPLE : DEFAULT_MSAA_SAMPLES,
    alphaMode: settings.alphaMode,
    srgb: settings.srgb,
    useHighPrecisionMatrix: settings.useHighPrecisionMatrix,
    useFloatingOrigin: settings.useFloatingOrigin,
  };
  if (settings.maxDevicePixelRatio > 0) {
    options.pixelRatio = settings.maxDevicePixelRatio;
  }
  if (resolutionScale !== 1) {
    options.resolutionScale = resolutionScale;
  }
  const limits = settings.requiredLimits;
  if (Object.keys(limits).length > 0) {
    options.requiredLimits = { ...limits };
  }
  return options;
}

/**
 * The swapchain format the section asks for, when it asks for one.
 *
 * @remarks
 * Kept apart from {@link toRendererOptions} because Lite declares `format` on `SurfaceOptions`
 * (`index.d.ts` 12622) rather than on `EngineOptions`, and the adapter's `RendererOptions` covers
 * only the latter. `createApp` merges the two.
 *
 * @param settings - The resolved section.
 * @returns The format, or `null` when the project named none.
 *
 * @internal
 */
export function toSurfaceFormat(settings: RenderingSettings): string | null {
  return settings.format === "" ? null : settings.format;
}

/**
 * The auto exposure knobs the HDR path is built with, or `null` when it stays off.
 *
 * @remarks
 * The settings store merges a section shallowly (see {@link toRenderingFeatures}), so a project that
 * writes `autoExposure: { enabled: true }` leaves the other fields `undefined`; each one falls back to
 * its default here.
 *
 * @param settings - The resolved section.
 * @returns The knobs, or `null` when `hdr` or `autoExposure.enabled` is off.
 *
 * @internal
 */
export function toAutoExposureOptions(settings: RenderingSettings): Omit<AutoExposureSettings, "enabled"> | null {
  const declared: Partial<AutoExposureSettings> = settings.autoExposure;
  if (!settings.hdr || declared.enabled !== true) {
    return null;
  }
  const defaults = defaultAutoExposureSettings();
  return {
    minEv: declared.minEv ?? defaults.minEv,
    maxEv: declared.maxEv ?? defaults.maxEv,
    speedUp: declared.speedUp ?? defaults.speedUp,
    speedDown: declared.speedDown ?? defaults.speedDown,
    compensation: declared.compensation ?? defaults.compensation,
  };
}
