/**
 * The lockup construction sheet.
 *
 * `02-design-system.md` §2.2 does not fix the horizontal construction: the new mark is tall and
 * pointed, so the alignment is chosen **optically**, from this sheet, and the choice is then
 * recorded in `press/README.md`. The generator renders every candidate at the size the lockup is
 * actually used at — 400 px wide, on light and on dark — so the decision is made on pixels rather
 * than on arithmetic.
 *
 * The sheet is a review artefact, not a deliverable: `build.ts` writes it outside `public/`.
 */
import { horizontalLockup, lockupBody, measureWordmark } from "./art.ts";
import { INK_ON_DARK, INK_ON_LIGHT, PAPER, UNITS_PER_EM } from "./brand.ts";
import { markInkBase64, rasterise } from "./raster.ts";
import { num } from "./svg.ts";
import { outline } from "./type.ts";
import type { HorizontalCandidateId } from "./art.ts";
import type { Mark } from "./mark.ts";
import type { SvgDocument } from "./svg.ts";
import type { Font } from "fontkit";

/** How wide each candidate is drawn: the size the horizontal lockup is used at on the site. */
const TILE_LOCKUP_WIDTH = 400;

/** Clear space inside a tile. */
const TILE_PADDING = 20;

/** Tile width. */
const TILE_WIDTH = TILE_LOCKUP_WIDTH + 2 * TILE_PADDING;

/** Space around and between tiles. */
const GUTTER = 24;

/** Height of the label strip above each row. */
const LABEL_HEIGHT = 26;

/** Em size of the sheet's own labels. */
const LABEL_SIZE = 13;

/** The sheet's ground: a mid grey, so light and dark tiles both read against it. */
const SHEET_GROUND = "#5A6474";

/** One row of the sheet. */
interface Row {
  /** The candidate. */
  readonly candidate: HorizontalCandidateId;
  /** The ink-to-ink gap, in em. */
  readonly gapEm: number;
}

/**
 * Renders the sheet.
 *
 * @param mark - The mark.
 * @param font - Archivo at weight 600.
 * @param candidates - The candidate identifiers, with the label each is described by.
 * @param gaps - The ink-to-ink gaps to compare, in em.
 * @returns The PNG bytes and one measurement line per row, for the build report.
 */
export async function constructionSheet(
  mark: Mark,
  font: Font,
  candidates: readonly { readonly id: HorizontalCandidateId; readonly label: string }[],
  gaps: readonly number[],
): Promise<{ readonly png: Buffer; readonly lines: readonly string[] }> {
  const rows: Row[] = gaps.flatMap((gapEm) => candidates.map((candidate) => ({ candidate: candidate.id, gapEm })));
  const width = 2 * TILE_WIDTH + 3 * GUTTER;

  // Every row's mark raster is prepared first, so the twelve tiles are drawn from data in hand.
  const prepared = await Promise.all(
    rows.map(async (row) => {
      const lockup = horizontalLockup(mark, font, row.candidate, row.gapEm);
      const scale = TILE_LOCKUP_WIDTH / lockup.width;
      return { row, lockup, scale, base64: await markInkBase64(mark, lockup.markInk.height * scale) };
    }),
  );

  const parts: string[] = [];
  const lines: string[] = [];
  let y = GUTTER;

  for (const { row, lockup, scale, base64 } of prepared) {
    const lockupHeight = lockup.height * scale;
    const tileHeight = Math.round(lockupHeight) + 2 * TILE_PADDING;
    const description = candidates.find((candidate) => candidate.id === row.candidate)?.label ?? row.candidate;

    const label =
      `${row.candidate} · ${description} · gap ${row.gapEm.toFixed(2)} em · ` +
      `mark ink ${num(lockup.markInk.width * scale)}x${num(lockup.markInk.height * scale)} px ` +
      `· lockup ${String(TILE_LOCKUP_WIDTH)}x${num(lockupHeight)} px`;
    lines.push(label);
    parts.push(
      `<path fill="${INK_ON_DARK}" d="${
        outline(font, label, { size: LABEL_SIZE, trackingEm: 0, originX: GUTTER, baselineY: y + 17 }).data
      }"/>`,
    );

    const tileTop = y + LABEL_HEIGHT;
    for (const [index, ground] of [PAPER, "#0D1015"].entries()) {
      const tileLeft = GUTTER + index * (TILE_WIDTH + GUTTER);
      const wordmarkFill = index === 0 ? INK_ON_LIGHT : INK_ON_DARK;
      parts.push(
        `<rect x="${num(tileLeft)}" y="${num(tileTop)}" width="${num(TILE_WIDTH)}"` +
          ` height="${num(tileHeight)}" fill="${ground}"/>`,
        `<g transform="translate(${num(tileLeft + TILE_PADDING)} ${num(tileTop + TILE_PADDING)})` +
          ` scale(${num(scale, 5)})">` +
          lockupBody(mark, lockup, { kind: "colour", base64 }, wordmarkFill) +
          "</g>",
      );
    }
    y = tileTop + tileHeight + GUTTER;
  }

  // A last band with the wordmark's own metrics, so the sheet carries the numbers it was judged on.
  const metrics = measureWordmark(font, UNITS_PER_EM);
  const footer =
    `wordmark: cap height ${num(metrics.capHeight)}, ink ${num(metrics.width)}x${num(metrics.height)}, ` +
    `rises ${num(metrics.aboveBaseline)} above the baseline and drops ${num(metrics.belowBaseline)} · ` +
    `mark ink aspect ${mark.aspect.toFixed(4)}`;
  parts.push(
    `<path fill="${INK_ON_DARK}" d="${
      outline(font, footer, { size: LABEL_SIZE, trackingEm: 0, originX: GUTTER, baselineY: y + 4 }).data
    }"/>`,
  );
  const height = Math.round(y + GUTTER);

  const document: SvgDocument = {
    width,
    height,
    ariaLabel: "ignifx lockup construction candidates",
    body: `<rect width="${num(width)}" height="${num(height)}" fill="${SHEET_GROUND}"/>${parts.join("")}`,
  };
  return { png: await rasterise(document, width, height), lines };
}
