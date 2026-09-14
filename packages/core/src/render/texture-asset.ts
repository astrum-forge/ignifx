import { releaseTextureHandle, retainTexture } from "../lite/gpu/texture.js";
import type { LiteTexture2D, LiteTexture2DOptions } from "../lite/gpu/texture.js";
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
 * ## Headless
 *
 * `loadTexture2D` uploads through `engine._device`, which the null engine has none of, so a
 * headless load produces an asset with `lite.texture === null` — the `gpu: null` shape
 * `05-assets-and-loading.md` §5 requires of every GPU loader.
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

  /**
   * Wraps a loaded texture. The `texture` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param texture - The GPU texture, or `null` when the app is headless.
   * @param options - The resolved import options.
   *
   * @internal
   */
  constructor(address: string, texture: LiteTexture2D | null, options: TextureImportOptions) {
    this.address = address;
    this.#texture = texture;
    this.options = options;
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
    const texture = this.#texture;
    if (texture !== null) {
      retainTexture(texture);
    }
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
    return texture === null ? false : releaseTextureHandle(texture);
  }
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
