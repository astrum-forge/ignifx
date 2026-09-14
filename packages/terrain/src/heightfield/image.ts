import { TerrainErrorCode, terrainError } from "../errors.js";
import { decodePng, isPng, pngToRgba8 } from "./png.js";

/**
 * Decoding a control map or a layer texture to tightly packed RGBA8, which is what
 * `TextureAsset.fromPixels` and Babylon Lite's texture arrays take.
 *
 * PNG goes through this package's own decoder, so it works in Node; anything else falls back to the
 * browser's `createImageBitmap`, which Node does not have.
 */

/**
 * An 8-bit RGBA image.
 *
 * @public
 */
export interface RgbaImage {
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
  /** `width * height * 4` bytes, row-major, top row first, straight alpha. */
  readonly data: Uint8Array;
}

/**
 * Decodes an image file to RGBA8.
 *
 * @param bytes - The file's bytes.
 * @param file - The file's address, for messages.
 * @returns The decoded image.
 * @throws IgnifxError with code `IGX-1606` when neither the built-in PNG decoder nor the browser can
 * read the bytes.
 *
 * @public
 */
export async function decodeRgbaImage(bytes: ArrayBuffer, file = "<memory>"): Promise<RgbaImage> {
  const view = new Uint8Array(bytes);
  if (isPng(view)) {
    try {
      const png = await decodePng(view, file);
      return { width: png.width, height: png.height, data: pngToRgba8(png) };
    } catch (error) {
      if (!hasBitmapDecoder()) {
        throw error;
      }
    }
  }
  if (!hasBitmapDecoder()) {
    throw terrainError(
      TerrainErrorCode.unsupportedImage,
      `${file} is not an image the built-in decoder reads: only PNG decodes without a browser.`,
      {
        context: { file, reason: "no browser image decoder" },
        hint: "Use a non-interlaced 8- or 16-bit PNG, which decodes in Node and in the browser alike.",
      },
    );
  }
  return decodeWithBitmap(view, file);
}

/**
 * Whether the host can decode images through `createImageBitmap` and an `OffscreenCanvas`.
 *
 * @returns `true` in a browser.
 */
function hasBitmapDecoder(): boolean {
  return typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function";
}

/**
 * Decodes through the browser's image pipeline.
 *
 * @param bytes - The file's bytes.
 * @param file - The file's address, for messages.
 * @returns The decoded image.
 * @throws IgnifxError with code `IGX-1606` when the browser refuses the bytes too.
 */
async function decodeWithBitmap(bytes: Uint8Array, file: string): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    // See `png.ts` for why the array is asserted to `BlobPart`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  } catch (error) {
    throw terrainError(
      TerrainErrorCode.unsupportedImage,
      `${file} is not an image the built-in decoder reads: the browser could not decode it either.`,
      { context: { file, reason: "browser decode failed" }, cause: error },
    );
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw terrainError(TerrainErrorCode.unsupportedImage, `${file} could not be read: no 2D canvas context.`, {
      context: { file, reason: "no 2d context" },
    });
  }
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    width: image.width,
    height: image.height,
    data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  };
}
