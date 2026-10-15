/**
 * `screenshot`'s image encoding: a captured frame scaled to the requested size and written as a
 * PNG or JPEG data URL. It needs a browser's `OffscreenCanvas`, as the capture needs a GPU.
 */

import type { PixelSize } from "./view-math.js";
import type { ScreenshotFormat } from "../protocol/index.js";
import type { RenderCapture } from "@ignifx/core";

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
