import type { LiteFont } from "../lite/font.js";

/**
 * `FontAsset` (`docs/architecture/05-assets-and-loading.md` §5, the `font` row): a parsed TTF or
 * OTF, for world and HUD text.
 *
 * It is the one rendering asset that loads **completely** under the null engine.
 * `createFontFromBuffer` (`index.d.ts` 2527) parses the byte range into a branded, opaque `Font`
 * and touches no device; glyph rasterisation happens later, in the text layer `@ignifx/ui` owns. A
 * font therefore has no GPU half to leave `null` in headless mode, and nothing to release: Lite's
 * `Font` exposes no disposer and holds no GPU resource, so the collector reclaims the value like
 * any other object.
 */

/**
 * The asset type fonts are registered under.
 *
 * @public
 */
export const FONT_ASSET_TYPE = "font";

/**
 * The address suffixes that select the font loader.
 *
 * @public
 */
export const FONT_FILE_EXTENSIONS: readonly string[] = Object.freeze([".ttf", ".otf"]);

/**
 * The Babylon Lite objects a {@link FontAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface FontAssetLiteHandles {
  /** The parsed font. Present in headless mode too: parsing needs no device. */
  readonly font: LiteFont;
}

/**
 * A parsed font file (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * @example
 * ```ts
 * const inter = await app.assets.loadAsync<FontAsset>("fonts/inter.ttf");
 * inter.value.address; // "fonts/inter.ttf"
 * ```
 *
 * @public
 */
export class FontAsset {
  /** The type name the asset service registers fonts under. */
  static assetType: string = FONT_ASSET_TYPE;

  /** The address the font was loaded from. */
  readonly address: string;

  /** How many bytes the file held, for diagnostics. */
  readonly byteLength: number;

  readonly #font: LiteFont;

  /**
   * Wraps a parsed font. The `font` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param font - The parsed font.
   * @param byteLength - The file's size in bytes.
   *
   * @internal
   */
  constructor(address: string, font: LiteFont, byteLength: number) {
    this.address = address;
    this.#font = font;
    this.byteLength = byteLength;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The parsed font.
   */
  get lite(): FontAssetLiteHandles {
    return { font: this.#font };
  }
}
