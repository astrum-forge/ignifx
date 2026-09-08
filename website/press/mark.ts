/**
 * The mark: the owner's raster master, and everything measured or derived from it.
 *
 * `website/brand/ignifx-mark.png` is the source of truth (`02-design-system.md` §2.1,
 * `08-execution.md` §9). It is a 1024×1024 RGBA PNG extracted byte for byte from the designer's
 * `pro_icon.svg` wrapper, and it is **never re-encoded**: the colour SVGs embed exactly these bytes,
 * and every raster is a Lanczos downscale of them.
 *
 * Two derived things live here. The **ink box** — the alpha edge at the ink threshold — is what the
 * lockups align to, because the master's canvas carries transparent margin that no layout should
 * see. The **silhouette** is the traced outline (`trace.ts`), which is the only single-colour form
 * a raster mark can have.
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { simplifyRing } from "./geometry.ts";
import { num, transform } from "./svg.ts";
import { compareMasks, maskBounds, maskFromAlpha, ringToPath, traceOuterBoundary } from "./trace.ts";
import type { Box } from "./geometry.ts";
import type { Placement } from "./svg.ts";
import type { Mask, Silhouette } from "./trace.ts";

/**
 * Clear margin around the ink on a square mark raster, as a fraction of the canvas
 * (`05-press-kit.md` §3: "ink-centred square canvas", ~4%).
 */
export const MARK_MARGIN = 0.04;

/** Douglas–Peucker tolerances the silhouette trace tries, in master pixels, coarsest last. */
const TRACE_TOLERANCES = [1, 1.5, 2, 2.5, 3, 4] as const;

/** The most vertices the silhouette may have — "a few dozen" for a low-poly shape. */
const TRACE_MAX_VERTICES = 48;

/** Hue bands the facet palette is sampled in, in degrees, and what to call each. */
const PALETTE_BANDS: readonly { readonly name: string; readonly from: number; readonly to: number }[] = [
  { name: "magenta-red", from: 320, to: 378 },
  { name: "orange", from: 18, to: 42 },
  { name: "yellow", from: 42, to: 70 },
];

/** How many levels per channel the palette sampler quantises to before taking the modal bin. */
const PALETTE_LEVELS = 12;

/** Alpha at or above which a pixel is counted when sampling the palette. */
const PALETTE_ALPHA = 200;

/** One sampled facet colour. */
export interface FacetColour {
  /** What the colour is called in `colours.txt`. */
  readonly name: string;
  /** The colour, `#RRGGBB`. */
  readonly hex: string;
  /** Share of the mark's opaque pixels that fall in this hue band. */
  readonly share: number;
}

/** The master mark and its measurements. */
export interface Mark {
  /** The master PNG's bytes, exactly as committed. */
  readonly master: Buffer;
  /** The master's base64, for the SVG that embeds it whole. */
  readonly masterBase64: string;
  /** The master's canvas side, in pixels. */
  readonly canvas: number;
  /** The ink box at the alpha threshold, in master pixels. */
  readonly ink: Box;
  /**
   * The square crop every derived raster comes from: the ink box grown to leave
   * {@link MARK_MARGIN} of clear space, centred on the ink.
   */
  readonly region: Box;
  /** The ink's height as a fraction of {@link Mark.region}'s side. */
  readonly inkFraction: number;
  /** The ink's aspect ratio, width over height. */
  readonly aspect: number;
  /** The traced outline. */
  readonly silhouette: Silhouette;
  /** The dominant facet colours, sampled from the master. */
  readonly palette: readonly FacetColour[];
}

/**
 * Reads the master, measures it, traces its silhouette and samples its palette.
 *
 * @param file - Absolute path to `website/brand/ignifx-mark.png`.
 * @returns The mark.
 * @throws When the master is not a square RGBA raster, or its ink cannot be traced.
 */
export async function loadMark(file: string): Promise<Mark> {
  // Read, never decode-and-re-encode: these exact bytes are what the colour SVGs embed, and
  // `08-execution.md` §9 makes the file the source of truth.
  const master = await readFile(file);
  const { data, info } = await sharp(master).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) {
    throw new Error(`the mark master must be square, got ${String(info.width)}×${String(info.height)}`);
  }
  const canvas = info.width;
  const mask = maskFromAlpha(data, info.width, info.height, info.channels);
  const { box: ink } = maskBounds(mask);

  // The region is the ink plus the margin the square rasters want, centred on the ink. An even side
  // keeps the crop on whole pixels; this master's ink happens to be exactly canvas-centred, so the
  // crop is symmetric, but the arithmetic does not rely on that.
  const side = Math.min(canvas, 2 * Math.round(ink.height / (1 - 2 * MARK_MARGIN) / 2));
  const centreX = ink.x + ink.width / 2;
  const centreY = ink.y + ink.height / 2;
  const region: Box = {
    x: Math.min(Math.max(0, Math.round(centreX - side / 2)), canvas - side),
    y: Math.min(Math.max(0, Math.round(centreY - side / 2)), canvas - side),
    width: side,
    height: side,
  };

  const silhouette = await traceOutline(mask, canvas);
  return {
    master,
    masterBase64: master.toString("base64"),
    canvas,
    ink,
    region,
    inkFraction: ink.height / side,
    aspect: ink.width / ink.height,
    silhouette,
    palette: samplePalette(data, info.width * info.height, info.channels),
  };
}

/**
 * Traces the outline and checks it by rendering it back over the master's own mask.
 *
 * @param mask - The master's mask.
 * @param canvas - The master's canvas side.
 * @returns The silhouette and its accuracy.
 * @throws When no tolerance simplifies the outline far enough.
 */
async function traceOutline(mask: Mask, canvas: number): Promise<Silhouette> {
  const boundary = traceOuterBoundary(mask);
  const chosen = TRACE_TOLERANCES.map((tolerance) => ({ tolerance, ring: simplifyRing(boundary, tolerance) })).find(
    (candidate) => candidate.ring.length <= TRACE_MAX_VERTICES,
  );
  if (chosen === undefined) {
    throw new Error(
      `no tolerance in ${JSON.stringify(TRACE_TOLERANCES)} simplified the mark's outline to ` +
        `${String(TRACE_MAX_VERTICES)} vertices or fewer`,
    );
  }
  const data = ringToPath(chosen.ring);
  // Render the polygon back at the master's own size and diff the two masks, so the build reports
  // how faithful the silhouette is rather than asserting that it is.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(canvas)}" height="${String(canvas)}"` +
    ` viewBox="0 0 ${String(canvas)} ${String(canvas)}"><path fill="#000" d="${data}"/></svg>`;
  const rendered = await sharp(Buffer.from(svg, "utf8")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const comparison = compareMasks(
    maskFromAlpha(rendered.data, rendered.info.width, rendered.info.height, rendered.info.channels),
    mask,
  );
  return {
    data,
    vertices: chosen.ring.length,
    tolerance: chosen.tolerance,
    boundaryPixels: boundary.length,
    mismatchOfInk: comparison.ofInk,
    mismatchOfCanvas: comparison.ofCanvas,
  };
}

/**
 * Samples the mark's dominant facet colours.
 *
 * Averaging a hue band gives mud, so each band's colours are quantised into bins, the fullest bin
 * wins, and its members are averaged: that returns a colour the artwork actually contains rather
 * than the midpoint of a gradient. Ties break on the bin key, so the result is deterministic.
 *
 * @param pixels - Raw RGBA bytes.
 * @param count - How many pixels there are.
 * @param channels - Bytes per pixel.
 * @returns One colour per band, in {@link PALETTE_BANDS} order.
 * @throws When a band has no pixels, which would mean this is not the mark.
 */
function samplePalette(pixels: Uint8Array, count: number, channels: number): readonly FacetColour[] {
  const bins = PALETTE_BANDS.map(() => new Map<string, { n: number; r: number; g: number; b: number }>());
  let opaque = 0;
  for (let index = 0; index < count; index++) {
    const base = index * channels;
    if ((pixels[base + 3] ?? 0) < PALETTE_ALPHA) {
      continue;
    }
    opaque++;
    const r = pixels[base] ?? 0;
    const g = pixels[base + 1] ?? 0;
    const b = pixels[base + 2] ?? 0;
    const hue = hueOf(r, g, b);
    // The magenta-red band wraps past 360, so compare against the unwrapped hue too.
    const band = PALETTE_BANDS.findIndex(
      (candidate) =>
        (hue >= candidate.from && hue < candidate.to) || (hue + 360 >= candidate.from && hue + 360 < candidate.to),
    );
    if (band < 0) {
      continue;
    }
    const key = [r, g, b].map((channel) => Math.floor((channel / 256) * PALETTE_LEVELS)).join(",");
    const bucket = bins[band]?.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bins[band]?.set(key, bucket);
  }

  return PALETTE_BANDS.map((band, index) => {
    const entries = [...(bins[index]?.entries() ?? [])];
    const total = entries.reduce((sum, [, bucket]) => sum + bucket.n, 0);
    const best = entries.toSorted((left, right) => right[1].n - left[1].n || (left[0] < right[0] ? -1 : 1))[0];
    if (best === undefined || opaque === 0) {
      throw new Error(`the mark has no ${band.name} pixels; is this the right master?`);
    }
    const bucket = best[1];
    const hex = [bucket.r, bucket.g, bucket.b]
      .map((channel) =>
        Math.round(channel / bucket.n)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
    return { name: band.name, hex: `#${hex.toUpperCase()}`, share: total / opaque };
  });
}

/**
 * The hue of an sRGB colour, in degrees.
 *
 * @param r - Red, 0–255.
 * @param g - Green, 0–255.
 * @param b - Blue, 0–255.
 * @returns The hue, 0 to 360.
 */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) {
    return 0;
  }
  let hue: number;
  if (max === r) {
    hue = 60 * (((g - b) / chroma) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / chroma + 2);
  } else {
    hue = 60 * ((r - g) / chroma + 4);
  }
  return hue < 0 ? hue + 360 : hue;
}

/**
 * The ink's width at a given ink height.
 *
 * @param mark - The mark.
 * @param inkHeight - The ink height in the target space.
 * @returns The ink width.
 */
export function markInkWidth(mark: Mark, inkHeight: number): number {
  return mark.aspect * inkHeight;
}

/** Where a derived mark raster is drawn, so that its **ink** lands where the layout wants it. */
export interface ImageBox {
  /** Left edge of the image, which sits outside the ink by the master's margin. */
  readonly x: number;
  /** Top edge of the image. */
  readonly y: number;
  /** Image width. */
  readonly width: number;
  /** Image height. */
  readonly height: number;
}

/**
 * Places a derived raster of {@link Mark.region} so its ink box lands at a target position.
 *
 * @param mark - The mark.
 * @param inkX - Target-space x of the ink's left edge.
 * @param inkY - Target-space y of the ink's top edge.
 * @param inkHeight - Target-space ink height.
 * @returns Where to draw the image.
 */
export function placeMarkImage(mark: Mark, inkX: number, inkY: number, inkHeight: number): ImageBox {
  const side = inkHeight / mark.inkFraction;
  return {
    x: inkX - (side - markInkWidth(mark, inkHeight)) / 2,
    y: inkY - (side - inkHeight) / 2,
    width: side,
    height: side,
  };
}

/**
 * Places the silhouette path — which is in master canvas coordinates — so its ink box lands at a
 * target position.
 *
 * @param mark - The mark.
 * @param inkX - Target-space x of the ink's left edge.
 * @param inkY - Target-space y of the ink's top edge.
 * @param inkHeight - Target-space ink height.
 * @returns The placement for a wrapping `<g>`.
 */
export function placeSilhouette(mark: Mark, inkX: number, inkY: number, inkHeight: number): Placement {
  const scale = inkHeight / mark.ink.height;
  return { x: inkX - mark.ink.x * scale, y: inkY - mark.ink.y * scale, scale };
}

/**
 * An `<image>` element carrying an embedded PNG.
 *
 * @param box - Where to draw it.
 * @param base64 - The PNG's base64.
 * @returns The markup.
 */
export function markImageElement(box: ImageBox, base64: string): string {
  return (
    `<image x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}"` +
    ` xlink:href="data:image/png;base64,${base64}"/>`
  );
}

/**
 * A `<g><path/></g>` drawing the silhouette.
 *
 * @param mark - The mark.
 * @param placement - Where to draw it.
 * @param fill - The fill colour, or `currentColor`.
 * @returns The markup.
 */
export function silhouetteElement(mark: Mark, placement: Placement, fill: string): string {
  return `<g fill="${fill}" transform="${transform(placement)}"><path d="${mark.silhouette.data}"/></g>`;
}
