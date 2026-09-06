import type { UiScalingMode } from "../settings.js";

/**
 * The scaling arithmetic behind `app.ui.scaling` (`docs/architecture/13-ui.md` §1). Every function
 * here is pure: it takes measurements and returns numbers, so the three modes are unit-testable
 * under Node with no DOM at all, and the host is left with nothing but the DOM writes.
 *
 * ## The three coordinate systems
 *
 * A canvas has two sizes: its **CSS** size, which is what layout and pointer coordinates use, and
 * its **backing-store** size (`canvas.width`/`canvas.height`), which is what WebGPU renders into.
 * Their ratio is the effective device pixel ratio. `Camera.worldToScreen`, Lite's text renderer,
 * and `app.renderer.captureScreenshot()` all work in backing-store pixels; a DOM element is placed
 * in CSS pixels. A "UI unit" is whichever of the two — or neither — the scaling mode picks:
 *
 * | Mode    | One UI unit is       | Root size                | Scale                        |
 * | ------- | -------------------- | ------------------------ | ---------------------------- |
 * | `"css"` | one CSS pixel        | the canvas's CSS size    | `1`                          |
 * | `"fit"` | one reference pixel  | `referenceResolution`    | `min(cssW/refW, cssH/refH)`  |
 * | `"dpi"` | one backing pixel    | the canvas's pixel size  | `cssW / backingW`            |
 */

/**
 * The two sizes of the canvas the overlay covers, both measured by the host.
 *
 * @public
 */
export interface UiSurfaceMetrics {
  /** The canvas's laid-out width, in CSS pixels. */
  readonly cssWidth: number;
  /** The canvas's laid-out height, in CSS pixels. */
  readonly cssHeight: number;
  /** The canvas's backing-store width, in device pixels — `canvas.width`. */
  readonly deviceWidth: number;
  /** The canvas's backing-store height, in device pixels — `canvas.height`. */
  readonly deviceHeight: number;
}

/**
 * Where the overlay root sits and how big it is, in the units the mode chose.
 *
 * @public
 */
export interface UiLayout {
  /** The mode this layout was computed for. */
  readonly mode: UiScalingMode;
  /** The root's width, in UI units. */
  readonly width: number;
  /** The root's height, in UI units. */
  readonly height: number;
  /** The uniform CSS scale applied to the root. */
  readonly scale: number;
  /** The root's left edge, in CSS pixels from the canvas's left edge. */
  readonly offsetX: number;
  /** The root's top edge, in CSS pixels from the canvas's top edge. */
  readonly offsetY: number;
}

/** The smallest size any measurement is treated as, so no ratio divides by zero. */
const MIN_EXTENT = 1;

/**
 * Clamps a measurement to something a ratio can safely divide by.
 *
 * @param value - The measured extent.
 * @returns The extent, or {@link MIN_EXTENT} when it is absent, zero, or not a finite number.
 */
function extent(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : MIN_EXTENT;
}

/**
 * The `[width, height]` a `"fit"` layout scales to, with both entries made safe.
 *
 * @param reference - The `ui.referenceResolution` setting.
 * @returns The width and height, each at least {@link MIN_EXTENT}.
 *
 * @internal
 */
export function resolveReferenceResolution(reference: readonly number[]): { width: number; height: number } {
  return { width: extent(reference[0] ?? 0), height: extent(reference[1] ?? 0) };
}

/**
 * Computes the overlay root's size, scale, and offset for one mode and one measured canvas.
 *
 * @param mode - The scaling mode.
 * @param metrics - The canvas's CSS and backing-store sizes.
 * @param reference - The `[width, height]` a `"fit"` layout scales to; ignored by the other modes.
 * @returns The layout to write onto the root.
 *
 * @example
 * ```ts
 * computeUiLayout("fit", { cssWidth: 800, cssHeight: 600, deviceWidth: 800, deviceHeight: 600 }, [
 *   400, 300,
 * ]).scale; // 2
 * ```
 *
 * @public
 */
export function computeUiLayout(
  mode: UiScalingMode,
  metrics: UiSurfaceMetrics,
  reference: readonly number[],
): UiLayout {
  const cssWidth = extent(metrics.cssWidth);
  const cssHeight = extent(metrics.cssHeight);
  if (mode === "fit") {
    const { width, height } = resolveReferenceResolution(reference);
    const scale = Math.min(cssWidth / width, cssHeight / height);
    return {
      mode,
      width,
      height,
      scale,
      offsetX: (cssWidth - width * scale) / 2,
      offsetY: (cssHeight - height * scale) / 2,
    };
  }
  if (mode === "dpi") {
    const deviceWidth = extent(metrics.deviceWidth);
    const deviceHeight = extent(metrics.deviceHeight);
    const scale = cssWidth / deviceWidth;
    return { mode, width: deviceWidth, height: deviceHeight, scale, offsetX: 0, offsetY: 0 };
  }
  return { mode: "css", width: cssWidth, height: cssHeight, scale: 1, offsetX: 0, offsetY: 0 };
}

/**
 * Whether two layouts are the same, so the host can skip the DOM writes when a resize changed
 * nothing (coding standards §7).
 *
 * @param left - One layout.
 * @param right - The other.
 * @returns `true` when every field matches.
 *
 * @internal
 */
export function layoutsEqual(left: UiLayout, right: UiLayout): boolean {
  return (
    left.mode === right.mode &&
    left.width === right.width &&
    left.height === right.height &&
    left.scale === right.scale &&
    left.offsetX === right.offsetX &&
    left.offsetY === right.offsetY
  );
}

/**
 * How a render-target pixel maps onto a UI unit under one layout.
 *
 * @remarks
 * `Camera.worldToScreen` answers in **backing-store** pixels (it divides by
 * `RendererImpl.readTargetSize`, which reads `canvas.width`/`canvas.height`), and a DOM element is
 * placed in UI units inside a root that is itself translated by `offsetX`/`offsetY` CSS pixels and
 * scaled by `scale`. This is the conversion between the two, expressed so a per-frame loop needs
 * two multiplies and a subtract and allocates nothing.
 *
 * @public
 */
export interface UiPixelMapping {
  /** Multiply a backing-store x by this. */
  readonly scaleX: number;
  /** Then subtract this. */
  readonly originX: number;
  /** Multiply a backing-store y by this. */
  readonly scaleY: number;
  /** Then subtract this. */
  readonly originY: number;
}

/**
 * Builds the backing-store-pixel to UI-unit conversion for one layout and one canvas.
 *
 * @param layout - The current layout.
 * @param metrics - The canvas's CSS and backing-store sizes.
 * @returns The mapping.
 *
 * @example
 * ```ts
 * const metrics = { cssWidth: 400, cssHeight: 300, deviceWidth: 800, deviceHeight: 600 };
 * const layout = computeUiLayout("css", metrics, [400, 300]);
 * const map = pixelMapping(layout, metrics);
 * map.scaleX * 800 - map.originX; // 400 — the canvas's right edge, in CSS pixels
 * ```
 *
 * @public
 */
export function pixelMapping(layout: UiLayout, metrics: UiSurfaceMetrics): UiPixelMapping {
  const cssPerDeviceX = extent(metrics.cssWidth) / extent(metrics.deviceWidth);
  const cssPerDeviceY = extent(metrics.cssHeight) / extent(metrics.deviceHeight);
  const scale = layout.scale === 0 ? 1 : layout.scale;
  return {
    scaleX: cssPerDeviceX / scale,
    originX: layout.offsetX / scale,
    scaleY: cssPerDeviceY / scale,
    originY: layout.offsetY / scale,
  };
}
