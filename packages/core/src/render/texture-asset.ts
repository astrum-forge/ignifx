import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import {
  createPixelTexture,
  releaseTextureShare,
  retainTextureShare,
  writePixelTexture,
} from "./gpu/texture-pixels.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteTexture2D, LiteTexture2DOptions } from "../lite/gpu/texture.js";
import type { LiteEngine } from "../lite/scene.js";
import type { JsonObject } from "../schema/json.js";

/**
 * `TextureAsset` (`docs/architecture/05-assets-and-loading.md` §5, `07-rendering.md` §7): a GPU
 * texture plus the import options the build recorded for it.
 *
 * ## Lifetime, and why the loader does not `acquireTexture`
 *
 * Lite reference-counts `GPUTexture`s in a process-wide pool keyed by the underlying texture
 * (`lib/resource/gpu-pool.js`): `acquireTexture` increments, `releaseTexture` decrements and
 * destroys at zero, and **a texture that was never acquired starts at an implicit count of one**.
 * A freshly loaded texture is therefore already owned once, by the asset that loaded it. Calling
 * `acquireTexture` in the loader — which `07-rendering.md` §7 could be read as asking for — would
 * put the count at two and make the matching `releaseTexture` on unload free nothing: a leak, not a
 * safety net. So the loader acquires nothing and {@link TextureAsset.releaseGpu} releases the one
 * implicit share when the asset is unloaded.
 *
 * Sharing is expressed one level up instead. A `MaterialAsset` that samples a texture pulls it in
 * with `ctx.loadDependency`, which retains the *asset handle*; the texture's GPU share is released
 * only when the last asset holding that handle is collected. That is the same rule every other
 * dependency follows, and it is observable through `handle.refCount`.
 * {@link TextureAsset.retainGpu} exists for the rare case where a Lite object outlives its asset.
 *
 * {@link TextureAsset.fromPixels} is the other way in: RGBA8 bytes, no file, published at a
 * `memory:texture/<ulid>` address the way `MeshAsset`'s primitive factories are. It is the **only**
 * kind of texture {@link TextureAsset.update} accepts, because `createTexture2DFromPixels` is what
 * asks WebGPU for `COPY_DST` usage (`index.d.ts` 13400). The bytes are copied at creation and not
 * retained; the asset keeps only the size, which is what `update` validates against.
 *
 * ## Headless
 *
 * `loadTexture2D` uploads through `engine._device`, which the null engine has none of, so a
 * headless load produces an asset with `lite.texture === null` — the `gpu: null` shape
 * `05-assets-and-loading.md` §5 requires of every GPU loader. `fromPixels` behaves the same way and
 * still validates and records the size, so a Node test can assert that a generator wrote the right
 * number of bytes without a device.
 */

/**
 * The asset type textures are registered under.
 *
 * @public
 */
export const TEXTURE_ASSET_TYPE = "texture";

/**
 * The import options a texture's `.meta.json` sidecar can declare, under its `texture` key
 * (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @remarks
 * They are the sampler and decode options, not scene state: two materials that sample one address
 * get one texture with one set of options, because the cache is keyed by address.
 *
 * @example
 * ```json
 * { "texture": { "srgb": true, "addressModeU": "clamp-to-edge" } }
 * ```
 *
 * @public
 */
export interface TextureImportOptions {
  /** Decode to linear on sample (`rgba8unorm-srgb`). Base colour and emissive want it; data maps must not. */
  readonly srgb: boolean;
  /** Generate a mip chain. Lite defaults to `true`. */
  readonly mipMaps: boolean;
  /** Address mode along U. */
  readonly addressModeU: string;
  /** Address mode along V. */
  readonly addressModeV: string;
  /** Minification filter. */
  readonly minFilter: string;
  /** Magnification filter. */
  readonly magFilter: string;
  /** Flip the image vertically at upload. Lite defaults to `true`, matching Babylon.js. */
  readonly invertY: boolean;
  /** Premultiply alpha at decode time; for atlases drawn with a premultiplied blend pipeline. */
  readonly premultiplyAlpha: boolean;
}

/**
 * How {@link TextureAsset.fromPixels} samples the texture it creates.
 *
 * @remarks
 * A deliberately small subset of {@link TextureImportOptions}: a pixel texture has one mip level,
 * so `mipMaps` has nothing to say, and the bytes are handed over already oriented and with straight
 * alpha, so `invertY` and `premultiplyAlpha` have nothing to do. The defaults are Lite's own and
 * they suit a data map — `nearest` filtering and `clamp` addressing, no sRGB decode.
 *
 * @public
 */
export interface PixelTextureOptions {
  /** Decode to linear on sample (`rgba8unorm-srgb`). Leave it off for lookup tables and data maps. */
  readonly srgb?: boolean;
  /** How texels are filtered. `"nearest"` keeps a lookup table exact; the default. */
  readonly filter?: "nearest" | "linear";
  /** What happens outside `0..1`. The default is `"clamp"`. */
  readonly wrap?: "clamp" | "repeat";
}

/**
 * The Babylon Lite objects a {@link TextureAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface TextureAssetLiteHandles {
  /** The GPU texture, or `null` under a headless app. */
  readonly texture: LiteTexture2D | null;
}

/**
 * A loaded 2D texture (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * @example
 * ```ts
 * const albedo = await app.assets.loadAsync<TextureAsset>("textures/hero-albedo.png");
 * albedo.value.options.srgb; // what the .meta.json sidecar asked for
 * ```
 *
 * @public
 */
export class TextureAsset {
  /** The type name the asset service registers textures under. */
  static assetType: string = TEXTURE_ASSET_TYPE;

  /** The address the texture was loaded from. */
  readonly address: string;

  /** The resolved import options, sidecar values merged onto the defaults. */
  readonly options: TextureImportOptions;

  #texture: LiteTexture2D | null;

  readonly #pixelSource: PixelTextureSource | null;

  /**
   * Wraps a loaded texture. The `texture` loader and {@link TextureAsset.fromPixels} construct
   * these.
   *
   * @param address - The address it was loaded from, or the `memory:` address it was published at.
   * @param texture - The GPU texture, or `null` when the app is headless.
   * @param options - The resolved import options.
   * @param pixelSource - The engine and size of a texture built from raw pixels, or `null` for a
   * texture that came from a file. It is what makes {@link TextureAsset.update} legal.
   *
   * @internal
   */
  constructor(
    address: string,
    texture: LiteTexture2D | null,
    options: TextureImportOptions,
    // Written out rather than named, so that {@link PixelTextureSource} — which is a private detail
    // of this module — does not have to be re-exported from the package entry point just because an
    // `@internal` constructor mentions it (API Extractor's `ae-forgotten-export`).
    pixelSource: { readonly engine: LiteEngine; readonly width: number; readonly height: number } | null = null,
  ) {
    this.address = address;
    this.#texture = texture;
    this.options = options;
    this.#pixelSource = pixelSource;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The GPU texture, or `null` under a headless app.
   */
  get lite(): TextureAssetLiteHandles {
    return { texture: this.#texture };
  }

  /**
   * The texture's width, in texels.
   *
   * @remarks
   * Known for every texture that reached the GPU — Lite records it on the texture handle
   * (`index.d.ts` 12876) — and for a headless {@link TextureAsset.fromPixels} texture, which
   * remembers the size it was asked for. A texture **loaded** from a file under a headless app
   * decoded nothing, so it reports `0`.
   *
   * @returns The width, or `0` when nothing knows it.
   */
  get width(): number {
    return this.#texture?.width ?? this.#pixelSource?.width ?? 0;
  }

  /**
   * The texture's height, in texels.
   *
   * @returns The height, or `0`; see {@link TextureAsset.width}.
   */
  get height(): number {
    return this.#texture?.height ?? this.#pixelSource?.height ?? 0;
  }

  /**
   * Whether the GPU texture has been given up.
   *
   * @returns `true` once {@link TextureAsset.releaseGpu} has run.
   */
  get isReleased(): boolean {
    return this.#texture === null;
  }

  /**
   * Claims an extra share of the GPU texture, so releasing the asset does not destroy it.
   *
   * @remarks
   * Only needed when a Lite object has to outlive the asset that loaded it. Ordinary sharing goes
   * through `ctx.loadDependency`, which counts the asset handle instead.
   */
  retainGpu(): void {
    retainTextureShare(this.#texture);
  }

  /**
   * Gives up the asset's share of the GPU texture, destroying it when it was the last one. Calling
   * it twice is a no-op, and it is a no-op under a headless app.
   *
   * @returns `true` when this call destroyed the underlying `GPUTexture`.
   */
  releaseGpu(): boolean {
    const texture = this.#texture;
    this.#texture = null;
    return releaseTextureShare(texture);
  }

  /**
   * Writes a rectangular region of the texture from RGBA8 bytes.
   *
   * @remarks
   * Only a texture from {@link TextureAsset.fromPixels} can be written to: that is the factory that
   * asks WebGPU for `COPY_DST` usage. The region defaults to the whole texture. Nothing is uploaded
   * under a headless app, but the size check still runs, so a generator's arithmetic is testable
   * without a device.
   *
   * The texture has one mip level, so there is no chain to regenerate and an update is complete the
   * moment the queue drains.
   *
   * @param data - `width * height * 4` bytes for the region, row-major, top row first.
   * @param x - The destination origin's column. Defaults to `0`.
   * @param y - The destination origin's row. Defaults to `0`.
   * @param width - The region's width. Defaults to the texture's width.
   * @param height - The region's height. Defaults to the texture's height.
   * @throws IgnifxError with code `IGX-0702` when the texture did not come from
   * {@link TextureAsset.fromPixels}.
   * @throws IgnifxError with code `IGX-0722` when the region falls outside the texture or `data` is
   * not exactly `width * height * 4` bytes long.
   *
   * @example
   * ```ts
   * const splat = TextureAsset.fromPixels(app, "splat", pixels, 256, 256);
   * pixels[0] = 255;
   * splat.value.update(pixels.subarray(0, 4), 0, 0, 1, 1); // one texel
   * ```
   */
  update(data: Uint8Array, x = 0, y = 0, width?: number, height?: number): void {
    const source = this.#pixelSource;
    if (source === null) {
      throw new IgnifxError(
        CoreErrorCode.invalidRuntime,
        `${this.address} was not created by TextureAsset.fromPixels, so it cannot be updated.`,
        {
          context: { asset: this.address, member: "TextureAsset.update()" },
          hint: "Only a texture built with TextureAsset.fromPixels carries the COPY_DST usage an update needs.",
        },
      );
    }
    const regionWidth = width ?? source.width;
    const regionHeight = height ?? source.height;
    assertPixelRegion(this.address, data, source, x, y, regionWidth, regionHeight);
    // Headless, or the share was released: the size check above is the whole of what a Node test
    // can assert.
    writePixelTexture(source.engine, this.#texture, data, x, y, regionWidth, regionHeight);
  }

  /**
   * Creates a texture from tightly packed RGBA8 bytes and publishes it as an in-memory asset.
   *
   * @remarks
   * The bytes are `width * height * 4` long, row-major, **top row first**, with straight (not
   * premultiplied) alpha. They are copied into the GPU texture and not retained.
   *
   * The result is the only kind of texture {@link TextureAsset.update} accepts. Ownership follows
   * the rule every in-code asset follows: the caller holds the handle, releasing it (or letting a
   * `using` block do it) runs the `texture` type's unload, which releases the GPU share.
   *
   * @param app - The app whose engine uploads the texture and whose asset service holds the handle.
   * @param name - A human-readable name. It becomes the asset's `address` — the string diagnostics
   * and the `IGX-0722` message name it by — while the handle's own address is the generated
   * `memory:texture/<ulid>` the asset service published it at.
   * @param data - `width * height * 4` bytes.
   * @param width - The width in texels, at least 1.
   * @param height - The height in texels, at least 1.
   * @param options - Sampler and colour-space overrides; `nearest`, `clamp`, no sRGB by default.
   * @returns The handle, already loaded, with one holder — the caller.
   * @throws IgnifxError with code `IGX-0722` when `width` or `height` is not a positive integer, or
   * `data` is not exactly `width * height * 4` bytes long.
   *
   * @example
   * ```ts
   * const pixels = new Uint8Array(2 * 2 * 4);
   * pixels.fill(255);
   * using ramp = TextureAsset.fromPixels(app, "ramp", pixels, 2, 2, { filter: "nearest" });
   * ```
   */
  static fromPixels(
    app: App,
    name: string,
    data: Uint8Array,
    width: number,
    height: number,
    options?: PixelTextureOptions,
  ): AssetHandle<TextureAsset> {
    assertPixelSize(name, data, width, height);
    const resolved = resolvePixelOptions(options);
    const engine = app.lite.engine;
    const texture = createPixelTexture(app.isHeadless, engine, data, width, height, resolved);
    const asset = new TextureAsset(name, texture, resolved, { engine, width, height });
    return app.assets.register(asset, { type: TEXTURE_ASSET_TYPE });
  }
}

/**
 * What a texture built from raw pixels remembers: how to reach the queue, and how big it is.
 *
 * Module-private on purpose: see the constructor's note.
 */
interface PixelTextureSource {
  /** The engine whose queue an update is written through. */
  readonly engine: LiteEngine;
  /** The width in texels. */
  readonly width: number;
  /** The height in texels. */
  readonly height: number;
}

/**
 * How many bytes one RGBA8 texel occupies.
 */
const BYTES_PER_TEXEL = 4;

/**
 * Checks that a byte count matches a texture size.
 *
 * @param asset - The name or address named in the error.
 * @param data - The pixel bytes.
 * @param width - The width in texels.
 * @param height - The height in texels.
 * @throws IgnifxError with code `IGX-0722` when the size is not a positive integer pair or the byte
 * count does not match.
 */
function assertPixelSize(asset: string, data: Uint8Array, width: number, height: number): void {
  const valid = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  const expected = width * height * BYTES_PER_TEXEL;
  if (valid && data.length === expected) {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.invalidPixelData,
    `${asset}: ${String(data.length)} bytes of pixel data do not match ${String(width)}x${String(height)} RGBA.`,
    {
      context: { asset, bytes: data.length, width, height },
      hint: "RGBA8 pixel data is exactly width * height * 4 bytes, row-major with the top row first.",
    },
  );
}

/**
 * Checks that an update's region lies inside the texture and that the byte count matches it.
 *
 * @param asset - The address named in the error.
 * @param data - The pixel bytes.
 * @param source - The texture's recorded size.
 * @param x - The region's origin column.
 * @param y - The region's origin row.
 * @param width - The region's width.
 * @param height - The region's height.
 * @throws IgnifxError with code `IGX-0722` when the region does not fit or the byte count is wrong.
 */
function assertPixelRegion(
  asset: string,
  data: Uint8Array,
  source: PixelTextureSource,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const inside =
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + width <= source.width &&
    y + height <= source.height;
  if (!inside) {
    throw new IgnifxError(
      CoreErrorCode.invalidPixelData,
      `${asset}: the region ${String(width)}x${String(height)} at (${String(x)}, ${String(y)}) falls outside a ` +
        `${String(source.width)}x${String(source.height)} texture.`,
      {
        context: { asset, bytes: data.length, x, y, width, height },
        hint: "An update writes inside the texture it was created with; recreate it to change its size.",
      },
    );
  }
  assertPixelSize(asset, data, width, height);
}

/**
 * Fills in {@link PixelTextureOptions}'s defaults as a complete {@link TextureImportOptions}, so a
 * pixel texture reports its sampler state the way a loaded one does.
 *
 * @param options - What the caller named.
 * @returns The resolved options.
 */
function resolvePixelOptions(options: PixelTextureOptions | undefined): TextureImportOptions {
  const filter = options?.filter ?? "nearest";
  const wrap = options?.wrap === "repeat" ? "repeat" : "clamp-to-edge";
  return {
    srgb: options?.srgb ?? false,
    // One mip level: `createTexture2DFromPixels` generates none.
    mipMaps: false,
    addressModeU: wrap,
    addressModeV: wrap,
    minFilter: filter,
    magFilter: filter,
    // The bytes arrive oriented and with straight alpha; there is no decode step to change either.
    invertY: false,
    premultiplyAlpha: false,
  };
}

/**
 * The import options a texture gets when its sidecar names none: Lite's own defaults, with `srgb`
 * off so that a data map is never silently decoded.
 *
 * @returns A fresh option set.
 *
 * @internal
 */
export function defaultTextureImportOptions(): TextureImportOptions {
  return {
    srgb: false,
    mipMaps: true,
    addressModeU: "repeat",
    addressModeV: "repeat",
    minFilter: "linear",
    magFilter: "linear",
    invertY: true,
    premultiplyAlpha: false,
  };
}

/**
 * Reads the `texture` block of a `.meta.json` sidecar over the defaults.
 *
 * @remarks
 * Unknown keys and values of the wrong type are ignored rather than rejected: a sidecar is written
 * by hand and shared with other tools, and a typo in an optional import hint must not stop a game
 * from starting (`CONSTITUTION.md` §3.9 — the asset still loads, with the documented default).
 *
 * @param meta - The whole sidecar, or `null` when the manifest recorded none.
 * @returns The resolved options.
 *
 * @internal
 */
export function readTextureImportOptions(meta: JsonObject | null): TextureImportOptions {
  const defaults = defaultTextureImportOptions();
  const raw = meta === null ? undefined : meta[TEXTURE_ASSET_TYPE];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaults;
  }
  // The array and `null` cases are already gone, so
  // what is left is a JSON object, which the readers below index by name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const block = raw as Record<string, unknown>;
  return {
    srgb: readBoolean(block, "srgb", defaults.srgb),
    mipMaps: readBoolean(block, "mipMaps", defaults.mipMaps),
    addressModeU: readString(block, "addressModeU", defaults.addressModeU),
    addressModeV: readString(block, "addressModeV", defaults.addressModeV),
    minFilter: readString(block, "minFilter", defaults.minFilter),
    magFilter: readString(block, "magFilter", defaults.magFilter),
    invertY: readBoolean(block, "invertY", defaults.invertY),
    premultiplyAlpha: readBoolean(block, "premultiplyAlpha", defaults.premultiplyAlpha),
  };
}

/**
 * Turns the resolved options into the shape `loadTexture2D` takes.
 *
 * @remarks
 * The sampler strings are handed to Lite as declared; WebGPU rejects a mode or filter it does not
 * know, and that failure is a clearer signal than an ignored option would be.
 *
 * @param options - The resolved import options.
 * @returns Lite's options.
 *
 * @internal
 */
export function toLiteTextureOptions(options: TextureImportOptions): LiteTexture2DOptions {
  return {
    srgb: options.srgb,
    mipMaps: options.mipMaps,
    // The sidecar is JSON, so the sampler modes arrive
    // as plain strings; WebGPU validates them when the sampler is created.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    addressModeU: options.addressModeU as GPUAddressMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    addressModeV: options.addressModeV as GPUAddressMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    minFilter: options.minFilter as GPUFilterMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    magFilter: options.magFilter as GPUFilterMode,
    invertY: options.invertY,
    premultiplyAlpha: options.premultiplyAlpha,
  };
}

/**
 * Reads a boolean out of a sidecar block.
 *
 * @param block - The sidecar sub-object.
 * @param key - The property name.
 * @param fallback - What to use when the property is absent or not a boolean.
 * @returns The value.
 */
function readBoolean(block: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = block[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a string out of a sidecar block.
 *
 * @param block - The sidecar sub-object.
 * @param key - The property name.
 * @param fallback - What to use when the property is absent or not a string.
 * @returns The value.
 */
function readString(block: Record<string, unknown>, key: string, fallback: string): string {
  const value = block[key];
  return typeof value === "string" ? value : fallback;
}
