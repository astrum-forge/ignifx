/**
 * Turning shaped text into SVG outlines.
 *
 * The press kit ships no live text and no embedded font (`05-press-kit.md` §6), so every letter in
 * it — the wordmark, a badge's label, the social image's positioning line — is a filled path taken
 * from the same variable font the site serves.
 *
 * ## Why the font is not instanced with `getVariation`
 *
 * `05-press-kit.md` §3 asks for Archivo at weight 600, and the obvious call is
 * `font.getVariation({ wght: 600 })`. It does not work on these files, and the reason is worth
 * recording because it decides which faces the kit can use at all.
 *
 * fontkit 2.0.4 cannot re-instance a **WOFF2** variable font, in two independent ways:
 *
 * 1. `TTFFont.getVariation` builds the new font from `this.stream.buffer` at `this._directoryPos`.
 *    On a `WOFF2Font` that buffer is the brotli-decompressed table data, which has no SFNT
 *    directory at that offset, so the instance comes back with no `cmap` and `layout` throws.
 * 2. Even reconstructed by hand, the outlines would not move: `WOFF2Glyph._decode` returns the
 *    pre-decoded glyph from the WOFF2 glyf transform and never calls
 *    `_variationProcessor.transformPoints`, so `gvar` deltas are skipped. Verified at this version
 *    by instancing weights 100, 400, 600 and 900 and diffing the outlines: identical, while the
 *    advances (which come from `HVAR`, applied elsewhere) did move.
 *
 * What a WOFF2 variable font does give is its **default master**, exactly. And
 * `@fontsource-variable/archivo`'s weight-axis file has `fvar` default 600 and `OS/2.usWeightClass`
 * 600 — its default master *is* SemiBold, the weight the wordmark wants. So the kit reads the
 * default instance and asserts that the file still claims 600 ({@link openWeight600}); if
 * fontsource ever re-defaults the file, the build stops instead of quietly shipping a lighter
 * wordmark.
 *
 * The same file for `@fontsource-variable/public-sans` defaults to weight **100**, so Public Sans
 * 600 outlines are not reachable here at all. `press/README.md` records what the repository would
 * need for `05-press-kit.md` §4's Public Sans badge label.
 */
import { openSync } from "fontkit";
import { num } from "./svg.ts";
import type { Box } from "./geometry.ts";
import type { Font, GlyphPathCommand } from "fontkit";

/** One SVG command letter per fontkit path command. */
const COMMAND_LETTERS = {
  moveTo: "M",
  lineTo: "L",
  quadraticCurveTo: "Q",
  bezierCurveTo: "C",
  closePath: "Z",
} as const;

/**
 * Opens a variable font whose default master is weight 600.
 *
 * @param file - Absolute path to the font file.
 * @returns The font, at weight 600.
 * @throws When the file's default instance is not weight 600, in which case its outlines are the
 *   wrong weight and no supported fontkit call can move them (see the module note).
 */
export function openWeight600(file: string): Font {
  const font = openSync(file);
  const weightAxis = font.variationAxes["wght"];
  if (weightAxis === undefined) {
    throw new Error(`${file} has no weight axis`);
  }
  if (weightAxis.default !== 600 || font["OS/2"].usWeightClass !== 600) {
    throw new Error(
      `${file} defaults to weight ${String(weightAxis.default)} ` +
        `(OS/2 usWeightClass ${String(font["OS/2"].usWeightClass)}), not 600. ` +
        "fontkit 2.0.4 cannot instance a WOFF2 variable font, so only the default master is " +
        "available — see the note at the top of website/press/type.ts.",
    );
  }
  return font;
}

/** How a run of outlined text is placed. */
export interface TypeSetting {
  /** Em size in the target space's units. */
  readonly size: number;
  /** Tracking in em, added to every advance but the last. */
  readonly trackingEm: number;
  /** Target-space x of the pen's origin — the run's left side bearing, not its ink. */
  readonly originX: number;
  /** Target-space y of the baseline. */
  readonly baselineY: number;
}

/** A run of text, converted to outlines. */
export interface OutlinedText {
  /** SVG path data in the target space, y down. */
  readonly data: string;
  /** The ink box in the target space. */
  readonly ink: Box;
  /** Where the pen ends up, in the target space, tracking after the last glyph excluded. */
  readonly advanceEnd: number;
}

/**
 * Shapes a string and converts it to one SVG path.
 *
 * The font's own layout engine does the shaping, so kerning and any default ligature apply, and
 * the tracking from `02-design-system.md` §2.2 is then added between glyphs — not after the last
 * one, which would push the ink box out by a phantom sidebearing.
 *
 * @param font - The font, already at the weight wanted.
 * @param text - The string to set.
 * @param setting - Size, tracking and where to put it.
 * @returns The outlines, the ink box, and where the pen ended.
 * @throws When the string shapes to nothing drawable.
 */
export function outline(font: Font, text: string, setting: TypeSetting): OutlinedText {
  const scale = setting.size / font.unitsPerEm;
  const tracking = setting.trackingEm * font.unitsPerEm;
  const run = font.layout(text);

  const parts: string[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pen = 0;

  for (const [index, glyph] of run.glyphs.entries()) {
    const position = run.positions[index];
    if (position === undefined) {
      throw new Error(`glyph ${String(index)} of ${JSON.stringify(text)} has no position`);
    }
    const commands = glyph.path.commands;
    if (commands.length > 0) {
      const offsetX = pen + position.xOffset;
      const offsetY = position.yOffset;
      // Font units are y up from the baseline; SVG is y down from the top of the viewBox.
      const toX = (value: number): number => setting.originX + (offsetX + value) * scale;
      const toY = (value: number): number => setting.baselineY - (offsetY + value) * scale;
      parts.push(pathData(commands, toX, toY));

      const box = glyph.path.bbox;
      minX = Math.min(minX, toX(box.minX));
      maxX = Math.max(maxX, toX(box.maxX));
      // maxY in font units is the *top*, which is the smaller y once flipped.
      minY = Math.min(minY, toY(box.maxY));
      maxY = Math.max(maxY, toY(box.minY));
    }
    pen += position.xAdvance;
    if (index < run.glyphs.length - 1) {
      pen += tracking;
    }
  }

  if (parts.length === 0) {
    throw new Error(`${JSON.stringify(text)} produced no outlines`);
  }
  return {
    data: parts.join(""),
    ink: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    advanceEnd: setting.originX + pen * scale,
  };
}

/**
 * Serialises fontkit path commands into SVG path data, mapping every coordinate as it goes.
 *
 * @param commands - The glyph's commands.
 * @param toX - Maps a font-unit x into the target space.
 * @param toY - Maps a font-unit y into the target space.
 * @returns The path data.
 * @throws When a command carries an odd number of coordinates, which would mean a fontkit change.
 */
function pathData(
  commands: readonly GlyphPathCommand[],
  toX: (value: number) => number,
  toY: (value: number) => number,
): string {
  let data = "";
  for (const command of commands) {
    if (command.args.length % 2 !== 0) {
      throw new Error(`command ${command.command} carried ${String(command.args.length)} coordinates`);
    }
    const coordinates: string[] = [];
    for (let index = 0; index < command.args.length; index += 2) {
      const x = command.args[index];
      const y = command.args[index + 1];
      if (x === undefined || y === undefined) {
        throw new Error(`command ${command.command} is missing a coordinate`);
      }
      coordinates.push(num(toX(x)), num(toY(y)));
    }
    data += COMMAND_LETTERS[command.command] + coordinates.join(" ");
  }
  return data;
}
