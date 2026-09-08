/**
 * Types for `fontkit` 2.0.4, which ships no declarations of its own.
 *
 * Only the surface the press-kit generator uses is declared. Everything here was read off
 * `node_modules/fontkit/src/**` at that version, not from memory: `TTFFont` for the font metrics
 * and `layout`, `GlyphRun`/`Glyph` for the shaped run, and `glyph/Path.js` for the outline.
 */
declare module "fontkit" {
  /** An axis-aligned box, in font design units, y up. */
  export interface FontBBox {
    /** Left edge. */
    readonly minX: number;
    /** Bottom edge. */
    readonly minY: number;
    /** Right edge. */
    readonly maxX: number;
    /** Top edge. */
    readonly maxY: number;
  }

  /** One command of a glyph outline. `args` holds x/y pairs in font design units, y up. */
  export interface GlyphPathCommand {
    /** The command name, which is also the name of the method on a graphics context. */
    readonly command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
    /** Flat list of coordinates: `x0 y0 x1 y1 …`, empty for `closePath`. */
    readonly args: readonly number[];
  }

  /** A glyph outline. */
  export interface GlyphPath {
    /** The outline, as commands. */
    readonly commands: readonly GlyphPathCommand[];
    /** The exact bounding box, curve segments evaluated. */
    readonly bbox: FontBBox;
  }

  /** One shaped glyph. */
  export interface Glyph {
    /** Glyph index in the font. */
    readonly id: number;
    /** The glyph's PostScript name, useful in diagnostics. */
    readonly name: string;
    /** The glyph's outline. */
    readonly path: GlyphPath;
  }

  /** Where the layout engine put one glyph, in font design units. */
  export interface GlyphPosition {
    /** How far the pen moves after this glyph, kerning included. */
    readonly xAdvance: number;
    /** Horizontal nudge for this glyph only. */
    readonly xOffset: number;
    /** Vertical nudge for this glyph only. */
    readonly yOffset: number;
  }

  /** A shaped run of text. */
  export interface GlyphRun {
    /** The glyphs, in visual order. */
    readonly glyphs: readonly Glyph[];
    /** One position per glyph, index-aligned with {@link GlyphRun.glyphs}. */
    readonly positions: readonly GlyphPosition[];
    /** Sum of the glyph advances. */
    readonly advanceWidth: number;
    /** The run's ink box, with every glyph placed. */
    readonly bbox: FontBBox;
  }

  /** One variation axis of a variable font, in user coordinates. */
  export interface VariationAxis {
    /** Human-readable axis name, for example `Weight`. */
    readonly name: string;
    /** Lowest value the axis accepts. */
    readonly min: number;
    /** The value the font renders at when no variation is applied. */
    readonly default: number;
    /** Highest value the axis accepts. */
    readonly max: number;
  }

  /** The `OS/2` table, of which only the weight class is read here. */
  export interface Os2Table {
    /** The weight the font's default instance claims, 1–1000. */
    readonly usWeightClass: number;
  }

  /** An opened font, or one instance of a variable font. */
  export interface Font {
    /** Design units per em. */
    readonly unitsPerEm: number;
    /** Cap height, in design units. */
    readonly capHeight: number;
    /** x-height, in design units. */
    readonly xHeight: number;
    /** Ascent, in design units. */
    readonly ascent: number;
    /** Descent, in design units; negative. */
    readonly descent: number;
    /** The family name of this instance. */
    readonly familyName: string;
    /** Variation axes keyed by four-character tag, absent on a static font. */
    readonly variationAxes: Readonly<Record<string, VariationAxis | undefined>>;
    /** The `OS/2` table. */
    readonly "OS/2": Os2Table;
    /**
     * Shapes a string with the font's own layout engine: kerning and ligatures applied.
     *
     * @param text - The string to shape.
     * @returns The shaped run.
     */
    layout(text: string): GlyphRun;
    /**
     * Returns a new font with the given variation settings applied.
     *
     * @param settings - Axis values keyed by tag, for example `{ wght: 600 }`.
     * @returns The instanced font.
     */
    getVariation(settings: Readonly<Record<string, number>>): Font;
  }

  /**
   * Opens a font file synchronously.
   *
   * @param filename - Absolute path to a TTF, OTF, WOFF or WOFF2 file.
   * @returns The opened font.
   */
  export function openSync(filename: string): Font;
}
