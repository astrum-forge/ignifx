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
   * camera wins whenever it is not `null`, an `Environment.clearColor` wins over this setting, and
   * this setting wins over Babylon Lite's own mid grey.
   */
  readonly clearColor: ColorLike;
  /** The address of the RGBD BRDF lookup table `loadEnvironment` requires. */
  readonly brdfLut: string;
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
