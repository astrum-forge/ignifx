import { createFontFromBuffer, type Font } from "@babylonjs/lite";

/**
 * Font half of the Babylon Lite adapter (`docs/architecture/05-assets-and-loading.md` §5, the
 * `font` row). It is deliberately **not** under `./gpu/`: `createFontFromBuffer`
 * (`index.d.ts` 2527) parses a TTF/OTF byte range into a branded, opaque `Font` and touches no
 * device, so a `FontAsset` is the one rendering asset that loads completely under the null engine.
 * Glyph rasterisation happens later, in the text layer `@ignifx/ui` owns.
 *
 * Everything here is `@internal`.
 *
 * ## What a `Font` is (verified against `@babylonjs/lite@1.27.0`)
 *
 * `interface Font { readonly [fontBrand]: true }` (`index.d.ts` 5359) — a nominal handle with no
 * readable members and no disposer. Nothing has to be released when a font is unloaded; the value
 * is plain JavaScript and the collector reclaims it.
 */

/**
 * The Babylon Lite font handle a `FontAsset` wraps, re-exported under an ignifx name so feature code
 * can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
 * standards §4).
 *
 * @remarks
 * Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
 * is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteFont = Font;

/**
 * Parses a TTF or OTF file into a Lite font.
 *
 * @param bytes - The whole font file, as the asset layer fetched it.
 * @returns The font handle.
 * @throws Whatever Lite's parser throws for a file it cannot read; the asset layer turns that into
 * an `IGX-0505`.
 *
 * @example
 * ```ts
 * const font = createFontFromBytes(await ctx.fetchBytes());
 * ```
 *
 * @internal
 */
export function createFontFromBytes(bytes: ArrayBuffer): LiteFont {
  return createFontFromBuffer(bytes);
}
