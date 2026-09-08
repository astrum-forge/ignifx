/**
 * The drawings: the mark's SVGs, the wordmark, the two lockups and the two badges.
 *
 * Construction follows `05-press-kit.md` §3 and §4 and `02-design-system.md` §2.1–§2.2. The mark is
 * raster, so a drawing that wants it in colour embeds a PNG (`mark.ts`) and one that wants a single
 * colour uses the traced silhouette. The measured numbers behind every layout are printed by the
 * build and recorded in `press/README.md`, so a change to the mark or to Archivo shows up in a build
 * log rather than only in the pixels.
 */
import { LOCKUP_GAP_EM, STACKED_MARK_CAP_MULTIPLE, UNITS_PER_EM, WORDMARK_TRACKING_EM } from "./brand.ts";
import { markImageElement, markInkWidth, placeMarkImage, placeSilhouette, silhouetteElement } from "./mark.ts";
import { num } from "./svg.ts";
import { outline } from "./type.ts";
import type { Box } from "./geometry.ts";
import type { Mark } from "./mark.ts";
import type { SvgDocument } from "./svg.ts";
import type { Font } from "fontkit";

/** The word the wordmark sets. Lowercase always (`CONSTITUTION.md` §1.5). */
export const WORDMARK_TEXT = "ignifx";

/**
 * How a drawing renders the mark: the artwork in colour, or its silhouette in one colour.
 *
 * A raster mark has no `currentColor` form (`08-execution.md` §9), so this is the whole choice.
 */
export type MarkStyle =
  | {
      /** The full-colour artwork, embedded as a PNG. */
      readonly kind: "colour";
      /** Base64 of the PNG to embed, prepared at a resolution that suits the drawing's size. */
      readonly base64: string;
    }
  | {
      /** The traced outline. */
      readonly kind: "silhouette";
      /** Its fill: a colour, or `currentColor`. */
      readonly fill: string;
    };

/**
 * Draws the mark with its ink at a given box.
 *
 * @param mark - The mark.
 * @param style - Colour artwork or silhouette.
 * @param inkX - Target-space x of the ink's left edge.
 * @param inkY - Target-space y of the ink's top edge.
 * @param inkHeight - Target-space ink height.
 * @returns The markup.
 */
function drawMark(mark: Mark, style: MarkStyle, inkX: number, inkY: number, inkHeight: number): string {
  return style.kind === "colour"
    ? markImageElement(placeMarkImage(mark, inkX, inkY, inkHeight), style.base64)
    : silhouetteElement(mark, placeSilhouette(mark, inkX, inkY, inkHeight), style.fill);
}

/**
 * `ignifx-mark.svg`: the designer's wrapper, cleaned.
 *
 * The master PNG goes in untouched — it is the source of truth, and re-encoding it would make the
 * kit's mark a copy rather than the artwork. What changes is the wrapper: the `viewBox` stays, the
 * intrinsic `width`/`height` go so the file scales to whatever box it is dropped into, and
 * `role`/`aria-label` are added (`05-press-kit.md` §3).
 *
 * @param mark - The mark.
 * @returns The document.
 */
export function markSvg(mark: Mark): SvgDocument {
  return {
    width: mark.canvas,
    height: mark.canvas,
    ariaLabel: "ignifx",
    body: markImageElement({ x: 0, y: 0, width: mark.canvas, height: mark.canvas }, mark.masterBase64),
  };
}

/**
 * `ignifx-mark-silhouette*.svg`: the traced outline, in the master's own canvas box so it is a
 * drop-in replacement for {@link markSvg}.
 *
 * @param mark - The mark.
 * @param fill - The fill: `currentColor`, ink, or white.
 * @returns The document.
 */
export function silhouetteSvg(mark: Mark, fill: string): SvgDocument {
  return {
    width: mark.canvas,
    height: mark.canvas,
    ariaLabel: "ignifx",
    body: `<path fill="${fill}" d="${mark.silhouette.data}"/>`,
  };
}

/**
 * The silhouette framed the way the square colour rasters are framed — ink centred with the
 * standard margin — for the raster silhouettes.
 *
 * @param mark - The mark.
 * @param fill - The fill.
 * @returns The document.
 */
export function silhouetteIconSvg(mark: Mark, fill: string): SvgDocument {
  return {
    width: mark.region.width,
    height: mark.region.height,
    viewBox: `${num(mark.region.x)} ${num(mark.region.y)} ${num(mark.region.width)} ${num(mark.region.height)}`,
    ariaLabel: "ignifx",
    body: `<path fill="${fill}" d="${mark.silhouette.data}"/>`,
  };
}

/** What the wordmark measures, in press units (hundredths of an em). */
export interface WordmarkMetrics {
  /** Ink width. */
  readonly width: number;
  /** Ink height, the `f` ascender down to the `g` descender. */
  readonly height: number;
  /** How far the ink rises above the baseline. */
  readonly aboveBaseline: number;
  /** How far the ink drops below the baseline. */
  readonly belowBaseline: number;
  /** The left side bearing of the first glyph. */
  readonly bearingX: number;
  /** Archivo's cap height at this size. */
  readonly capHeight: number;
  /** Archivo's x-height at this size. */
  readonly xHeight: number;
  /** The tracked advance of the whole word, tracking after the last glyph excluded. */
  readonly advance: number;
}

/**
 * Measures the wordmark once, so every lockup can be laid out from numbers instead of by eye.
 *
 * @param font - Archivo at weight 600.
 * @param size - Em size in the target space.
 * @returns The metrics.
 */
export function measureWordmark(font: Font, size: number): WordmarkMetrics {
  const probe = outline(font, WORDMARK_TEXT, { size, trackingEm: WORDMARK_TRACKING_EM, originX: 0, baselineY: 0 });
  return {
    width: probe.ink.width,
    height: probe.ink.height,
    aboveBaseline: -probe.ink.y,
    belowBaseline: probe.ink.y + probe.ink.height,
    bearingX: probe.ink.x,
    capHeight: (font.capHeight / font.unitsPerEm) * size,
    xHeight: (font.xHeight / font.unitsPerEm) * size,
    advance: probe.advanceEnd,
  };
}

/**
 * Sets the wordmark with its ink's left edge at `inkLeft` and its baseline at `baselineY`.
 *
 * @param font - Archivo at weight 600.
 * @param size - Em size in the target space.
 * @param metrics - The measurement from {@link measureWordmark} at the same size.
 * @param inkLeft - Target-space x of the ink's left edge.
 * @param baselineY - Target-space y of the baseline.
 * @returns SVG path data.
 */
export function wordmarkData(
  font: Font,
  size: number,
  metrics: WordmarkMetrics,
  inkLeft: number,
  baselineY: number,
): string {
  return outline(font, WORDMARK_TEXT, {
    size,
    trackingEm: WORDMARK_TRACKING_EM,
    originX: inkLeft - metrics.bearingX,
    baselineY,
  }).data;
}

/**
 * The standalone wordmark, its viewBox trimmed to the ink so that "set it 24 px tall" means 24 px
 * of visible letters.
 *
 * @param font - Archivo at weight 600.
 * @param fill - The ink colour.
 * @returns The document.
 */
export function wordmarkSvg(font: Font, fill: string): SvgDocument {
  const metrics = measureWordmark(font, UNITS_PER_EM);
  const data = wordmarkData(font, UNITS_PER_EM, metrics, 0, metrics.aboveBaseline);
  return {
    width: metrics.width,
    height: metrics.height,
    ariaLabel: "ignifx",
    body: `<path fill="${fill}" d="${data}"/>`,
  };
}

/** A mark-plus-wordmark composition, colourway not yet chosen. */
export interface Lockup {
  /** viewBox width. */
  readonly width: number;
  /** viewBox height. */
  readonly height: number;
  /** Where the mark's **ink** goes. */
  readonly markInk: Box;
  /** The wordmark's outlines. */
  readonly wordmark: string;
  /** The measurements the build reports and `press/README.md` records. */
  readonly notes: Readonly<Record<string, number>>;
}

/**
 * The three horizontal constructions `02-design-system.md` §2.2 asks to be compared.
 *
 * The new mark is tall and pointed (aspect 0.70), so no single rule is obviously right and the
 * choice is made from a rendered sheet rather than from arithmetic.
 */
export const HORIZONTAL_CANDIDATES = [
  {
    /** The identifier used in the sheet and in `README.md`. */
    id: "A",
    /** What the candidate does. */
    label: "mark spans the wordmark's full ink height",
  },
  { id: "B", label: "mark at 1.15x cap height, centred on the ink box" },
  { id: "C", label: "mark at cap height, on the baseline" },
] as const;

/** One of {@link HORIZONTAL_CANDIDATES}. */
export type HorizontalCandidateId = (typeof HORIZONTAL_CANDIDATES)[number]["id"];

/**
 * The horizontal lockup: mark left, wordmark right.
 *
 * @param mark - The mark.
 * @param font - Archivo at weight 600.
 * @param candidate - Which of {@link HORIZONTAL_CANDIDATES} to build.
 * @param gapEm - Ink-to-ink gap, in em.
 * @returns The lockup.
 * @throws When the candidate is not one of the three.
 */
export function horizontalLockup(
  mark: Mark,
  font: Font,
  candidate: HorizontalCandidateId,
  gapEm: number = LOCKUP_GAP_EM,
): Lockup {
  const size = UNITS_PER_EM;
  const metrics = measureWordmark(font, size);
  const gap = gapEm * size;
  const baselineY = metrics.aboveBaseline;

  let markHeight: number;
  let markTop: number;
  switch (candidate) {
    case "A": {
      // The mark spans exactly what the letters span, `f` ascender to `g` descender.
      markHeight = metrics.height;
      markTop = 0;
      break;
    }
    case "B": {
      markHeight = 1.15 * metrics.capHeight;
      markTop = (metrics.height - markHeight) / 2;
      break;
    }
    case "C": {
      markHeight = metrics.capHeight;
      markTop = baselineY - markHeight;
      break;
    }
    default: {
      throw new Error(`unknown horizontal lockup candidate ${JSON.stringify(candidate)}`);
    }
  }

  const markWidth = markInkWidth(mark, markHeight);
  const wordmarkLeft = markWidth + gap;
  return {
    width: wordmarkLeft + metrics.width,
    height: metrics.height,
    markInk: { x: 0, y: markTop, width: markWidth, height: markHeight },
    wordmark: wordmarkData(font, size, metrics, wordmarkLeft, baselineY),
    notes: {
      capHeight: metrics.capHeight,
      xHeight: metrics.xHeight,
      markInkHeight: markHeight,
      markInkWidth: markWidth,
      markInkTop: markTop,
      gap,
      gapEm,
      wordmarkWidth: metrics.width,
      wordmarkAdvance: metrics.advance,
      baselineY,
    },
  };
}

/**
 * The stacked lockup: mark above, wordmark centred beneath it.
 *
 * @param mark - The mark.
 * @param font - Archivo at weight 600.
 * @param gapEm - Ink-to-ink gap, in em.
 * @returns The lockup.
 */
export function stackedLockup(mark: Mark, font: Font, gapEm: number = LOCKUP_GAP_EM): Lockup {
  const size = UNITS_PER_EM;
  const metrics = measureWordmark(font, size);
  const gap = gapEm * size;
  const markHeight = STACKED_MARK_CAP_MULTIPLE * metrics.capHeight;
  const markWidth = markInkWidth(mark, markHeight);
  const width = Math.max(markWidth, metrics.width);
  const baselineY = markHeight + gap + metrics.aboveBaseline;
  return {
    width,
    height: markHeight + gap + metrics.height,
    markInk: { x: (width - markWidth) / 2, y: 0, width: markWidth, height: markHeight },
    wordmark: wordmarkData(font, size, metrics, (width - metrics.width) / 2, baselineY),
    notes: {
      markInkHeight: markHeight,
      markInkWidth: markWidth,
      gap,
      gapEm,
      wordmarkWidth: metrics.width,
      baselineY,
    },
  };
}

/**
 * Renders a lockup's contents, without the surrounding `<svg>`.
 *
 * @param mark - The mark.
 * @param lockup - The composition.
 * @param style - How to draw the mark.
 * @param wordmarkFill - Colour for the letters.
 * @returns The markup.
 */
export function lockupBody(mark: Mark, lockup: Lockup, style: MarkStyle, wordmarkFill: string): string {
  return (
    drawMark(mark, style, lockup.markInk.x, lockup.markInk.y, lockup.markInk.height) +
    `<path fill="${wordmarkFill}" d="${lockup.wordmark}"/>`
  );
}

/**
 * Renders a lockup in one colourway.
 *
 * @param mark - The mark.
 * @param lockup - The composition.
 * @param style - How to draw the mark.
 * @param wordmarkFill - Colour for the letters.
 * @returns The document.
 */
export function lockupSvg(mark: Mark, lockup: Lockup, style: MarkStyle, wordmarkFill: string): SvgDocument {
  return {
    width: lockup.width,
    height: lockup.height,
    ariaLabel: "ignifx",
    body: lockupBody(mark, lockup, style, wordmarkFill),
  };
}

/** A badge colourway. */
export interface BadgeColours {
  /** The pill's fill. */
  readonly ground: string;
  /** The hairline border. */
  readonly border: string;
  /** The label — "Powered by", "Made with". */
  readonly label: string;
  /** The wordmark. */
  readonly wordmark: string;
  /** The flame, when the badge falls back to the silhouette. */
  readonly mark: string;
}

/** The badge geometry, in pixels at the 20 px pill `05-press-kit.md` §4 specifies. */
export const BADGE = {
  /** Pill height. */
  height: 20,
  /** Hairline width. */
  border: 1,
  /** Corner radius. A 999 px radius on a 19 px inner box resolves to half its height. */
  radius: 9.5,
  /** Em size for the label and the wordmark. */
  typeSize: 11,
  /** Left and right padding. */
  padding: 7,
  /** Gap between the mark, the label and the wordmark. */
  gap: 4,
  /** The mark's ink height in the 20 px pill (`05-press-kit.md` §4). */
  markHeight: 14,
} as const;

/**
 * Draws one badge.
 *
 * Deliberate refinement of `05-press-kit.md` §4, carried over from the first build and now recorded
 * in `08-execution.md` §9: the product name in the badge is the **real wordmark** — Archivo 600
 * outlines with the brand's −0.02 em tracking — rather than the label typeface. §4's own table
 * writes the name in bold ("Powered by **ignifx**"), the usage rules forbid setting the wordmark in
 * another face, and a badge is the one asset that appears beside other people's logos.
 *
 * @param mark - The mark.
 * @param font - Archivo at weight 600 — the label's face too; see the note in `press/type.ts`.
 * @param label - The words before the wordmark.
 * @param colours - The colourway.
 * @param style - How to draw the mark: the colour raster, or the silhouette fallback.
 * @returns The document.
 */
export function badgeSvg(mark: Mark, font: Font, label: string, colours: BadgeColours, style: MarkStyle): SvgDocument {
  const size = BADGE.typeSize;
  const wordmarkMetrics = measureWordmark(font, size);
  const labelProbe = outline(font, label, { size, trackingEm: 0, originX: 0, baselineY: 0 });

  // Centre the text's own ink box in the pill, so the descenders of `y` and `g` are paid for on
  // both sides instead of pushing the whole line low.
  const above = Math.max(-labelProbe.ink.y, wordmarkMetrics.aboveBaseline);
  const below = Math.max(labelProbe.ink.y + labelProbe.ink.height, wordmarkMetrics.belowBaseline);
  const baselineY = BADGE.height / 2 + (above - below) / 2;

  const markWidth = markInkWidth(mark, BADGE.markHeight);
  const labelLeft = BADGE.padding + markWidth + BADGE.gap;
  const wordmarkLeft = labelLeft + labelProbe.ink.width + BADGE.gap;
  // A whole-pixel width keeps `<img width>` honest; the rounding goes to the right padding.
  const width = Math.ceil(wordmarkLeft + wordmarkMetrics.width + BADGE.padding);

  const inset = BADGE.border / 2;
  const pill =
    `<rect x="${num(inset)}" y="${num(inset)}"` +
    ` width="${num(width - BADGE.border)}" height="${num(BADGE.height - BADGE.border)}"` +
    ` rx="${num(BADGE.radius)}" fill="${colours.ground}"` +
    ` stroke="${colours.border}" stroke-width="${num(BADGE.border)}"/>`;
  const flame = drawMark(mark, style, BADGE.padding, (BADGE.height - BADGE.markHeight) / 2, BADGE.markHeight);
  const labelData = outline(font, label, {
    size,
    trackingEm: 0,
    originX: labelLeft - labelProbe.ink.x,
    baselineY,
  }).data;
  const wordmark = wordmarkData(font, size, wordmarkMetrics, wordmarkLeft, baselineY);

  return {
    width,
    height: BADGE.height,
    ariaLabel: `${label} ignifx`,
    body:
      pill +
      flame +
      `<path fill="${colours.label}" d="${labelData}"/>` +
      `<path fill="${colours.wordmark}" d="${wordmark}"/>`,
  };
}
