/**
 * `screenshot`, shared by the scene view and the play view: the parameter check, and a captured
 * frame scaled to the requested size and written as a PNG or JPEG data URL. Encoding needs a
 * browser's `OffscreenCanvas`, as the capture needs a GPU.
 */

import { InvalidParamsError } from "../channel.js";
import { isScreenshotParams, SCREENSHOT_MAX_SIZE } from "../protocol/index.js";
import { screenshotSize } from "./view-math.js";
import type { PixelSize } from "./view-math.js";
import type { ScreenshotFormat, ScreenshotParams, ScreenshotResult } from "../protocol/index.js";
import type { App, RenderCapture } from "@ignifx/core";

/** The JPEG quality when the request gives none. */
const DEFAULT_JPEG_QUALITY = 0.9;

/** Bytes encoded per `String.fromCharCode` call, to stay under engines' argument limits. */
const BASE64_CHUNK = 0x8000;

/**
 * Encodes bytes as base64.
 *
 * @param bytes - The bytes.
 * @returns The base64 text.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Scales a captured frame to a size and encodes it as a data URL.
 *
 * @param capture - The frame, RGBA8 with the top row first.
 * @param size - The image size.
 * @param format - `"png"` or `"jpeg"`.
 * @param quality - The JPEG quality, from 0 to 1; ignored for PNG.
 * @returns A `data:image/png;base64,…` or `data:image/jpeg;base64,…` URL.
 * @throws Error when the browser has no 2D canvas context.
 */
export async function encodeCapture(
  capture: RenderCapture,
  size: PixelSize,
  format: ScreenshotFormat,
  quality: number,
): Promise<string> {
  const source = new OffscreenCanvas(capture.width, capture.height);
  const sourceContext = source.getContext("2d");
  const target = new OffscreenCanvas(size.width, size.height);
  const targetContext = target.getContext("2d");
  if (sourceContext === null || targetContext === null) {
    throw new Error("This browser has no 2D canvas to encode the screenshot with.");
  }
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(capture.data), capture.width, capture.height), 0, 0);
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(source, 0, 0, size.width, size.height);
  const type = format === "png" ? "image/png" : "image/jpeg";
  const blob = await target.convertToBlob(format === "png" ? { type } : { type, quality });
  return `data:${type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/**
 * Checks `screenshot`'s parameters.
 *
 * @param params - The received `params`.
 * @returns The parameters.
 * @throws InvalidParamsError for a side outside 1 to {@link SCREENSHOT_MAX_SIZE}, an unknown format, or
 * a quality outside 0 to 1.
 */
export function checkScreenshotParams(params: unknown): ScreenshotParams {
  if (typeof params === "object" && params !== null) {
    for (const side of ["width", "height"]) {
      const value: unknown = Reflect.get(params, side);
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > SCREENSHOT_MAX_SIZE)
      ) {
        throw new InvalidParamsError(
          `screenshot takes a width and height from 1 to ${String(SCREENSHOT_MAX_SIZE)} pixels.`,
        );
      }
    }
  }
  if (!isScreenshotParams(params)) {
    throw new InvalidParamsError('screenshot takes { width?, height?, format: "png" | "jpeg", quality? }.');
  }
  return params;
}

/**
 * Captures the app's next presented frame and encodes it as `screenshot` answers.
 *
 * @param app - The app whose canvas is captured.
 * @param params - Checked parameters.
 * @returns The data URL and its size.
 * @throws IgnifxError `IGX-0707` when the app's render loop does not run.
 */
export async function takeScreenshot(app: App, params: ScreenshotParams): Promise<ScreenshotResult> {
  const capture = await app.renderer.captureScreenshot();
  const size = screenshotSize(params, capture);
  const dataUrl = await encodeCapture(capture, size, params.format, params.quality ?? DEFAULT_JPEG_QUALITY);
  return { dataUrl, width: size.width, height: size.height };
}
