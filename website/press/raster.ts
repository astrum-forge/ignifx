/**
 * Rasterisation and compositing, through `sharp`.
 *
 * Two kinds of raster come out of here. **Vector** drawings — the wordmark, the silhouette, a badge
 * — are rendered from an SVG re-emitted at its final pixel size, so librsvg draws them once at full
 * resolution instead of resampling a smaller raster. The **mark** is already a raster, so its
 * derivatives are Lanczos downscales of the master with a light unsharp mask at icon sizes, which
 * is what keeps a 16 px favicon readable (`02-design-system.md` §2.1).
 *
 * PNG encoding is pinned so that two runs of the generator produce the same bytes.
 */
import sharp from "sharp";
import { horizontalLockup, lockupBody } from "./art.ts";
import {
  APPLE_TOUCH,
  FLAME_ON_DARK,
  GROUND_DARK,
  INK_2_ON_DARK,
  INK_ON_DARK,
  POSITIONING,
  SHARPEN_AT_OR_BELOW,
} from "./brand.ts";
import { AA_NORMAL_TEXT, contrastRatio } from "./contrast.ts";
import { renderSvg, transform } from "./svg.ts";
import { outline } from "./type.ts";
import type { HorizontalCandidateId } from "./art.ts";
import type { Box } from "./geometry.ts";
import type { Mark } from "./mark.ts";
import type { SvgDocument } from "./svg.ts";
import type { Font } from "fontkit";

/** PNG encoder settings, fixed so the output is reproducible. */
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false, effort: 10 } as const;

/** Unsharp mask for icon-size downscales: gentle, because the artwork is flat colour. */
const SHARPEN = { sigma: 0.6, m1: 0.4, m2: 0.6 } as const;

/** How the mark's raster is resampled. Lanczos 3 keeps the facet edges clean. */
const KERNEL = "lanczos3";

/** The Open Graph image's size (`02-design-system.md` §2.7). */
export const SOCIAL_SIZE = { width: 1200, height: 630 } as const;

/** The social avatar's size. */
export const AVATAR_SIZE = 1024;

/** How much of the avatar's height the mark's ink takes; the rest is the margin a round crop eats. */
const AVATAR_INK_FRACTION = 0.56;

/** How opaque the dark scrim over the hero capture is. */
const SOCIAL_SCRIM = 0.82;

/**
 * Rasterises one vector at an exact pixel size.
 *
 * @param document - The vector.
 * @param width - Target width in pixels.
 * @param height - Target height in pixels.
 * @returns The PNG bytes.
 * @throws When librsvg does not produce the size asked for.
 */
export async function rasterise(document: SvgDocument, width: number, height: number): Promise<Buffer> {
  const svg = renderSvg(document, { width, height });
  const png = await sharp(Buffer.from(svg, "utf8")).png(PNG).toBuffer();
  const metadata = await sharp(png).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(
      `rasterised ${String(metadata.width)}×${String(metadata.height)}, expected ` +
        `${String(width)}×${String(height)}`,
    );
  }
  return png;
}

/**
 * Rasterises a vector to a given height, keeping its aspect ratio.
 *
 * @param document - The vector.
 * @param height - Target height in pixels.
 * @returns The PNG bytes.
 */
export function rasteriseToHeight(document: SvgDocument, height: number): Promise<Buffer> {
  return rasterise(document, Math.round((document.width / document.height) * height), height);
}

/**
 * Rasterises a vector to a given width, keeping its aspect ratio.
 *
 * @param document - The vector.
 * @param width - Target width in pixels.
 * @returns The PNG bytes.
 */
export function rasteriseToWidth(document: SvgDocument, width: number): Promise<Buffer> {
  return rasterise(document, width, Math.round((document.height / document.width) * width));
}

/**
 * Downscales the master's ink-centred square region to one side length.
 *
 * This is the square full-colour mark: `ignifx-mark-<size>.png` in the kit,
 * `public/brand/mark-<size>.png` and the favicon PNGs on the site. Transparent ground, ink centred,
 * the margin {@link Mark.region} carries.
 *
 * @param mark - The mark.
 * @param size - Side of the output, in pixels.
 * @returns The PNG bytes.
 */
export async function markSquarePng(mark: Mark, size: number): Promise<Buffer> {
  let pipeline = sharp(mark.master)
    .extract({ left: mark.region.x, top: mark.region.y, width: mark.region.width, height: mark.region.height })
    .resize(size, size, { kernel: KERNEL });
  if (size <= SHARPEN_AT_OR_BELOW) {
    pipeline = pipeline.sharpen(SHARPEN);
  }
  return pipeline.png(PNG).toBuffer();
}

/**
 * Downscales the master so that its **ink** is a given height, for embedding in a drawing where the
 * layout is expressed in ink terms.
 *
 * The embedded PNG is prepared at the resolution the drawing will actually be seen at rather than
 * being the 1024 master, because a badge is hot-linked and half a megabyte of base64 in a README
 * image would be indefensible. The mark SVG and the lockups embed the master itself, where the
 * point is that a 4× print use stays sharp.
 *
 * @param mark - The mark.
 * @param inkHeight - The ink height the drawing needs, in pixels.
 * @returns The PNG's base64.
 */
export async function markInkBase64(mark: Mark, inkHeight: number): Promise<string> {
  const side = Math.max(1, Math.round(inkHeight / mark.inkFraction));
  const png = await markSquarePng(mark, side);
  return png.toString("base64");
}

/**
 * `favicon.ico`'s member PNGs, and `favicon-16.png`/`favicon-32.png`.
 *
 * @param mark - The mark.
 * @param sizes - The sizes to render.
 * @returns One entry per size, in order.
 */
export function faviconPngs(mark: Mark, sizes: readonly number[]): Promise<readonly Buffer[]> {
  return Promise.all(sizes.map((size) => markSquarePng(mark, size)));
}

/**
 * `apple-touch-icon.png`: the mark on the dark ground, opaque, with the margin iOS expects because
 * it draws the icon with its own rounded mask and no transparency.
 *
 * @param mark - The mark.
 * @returns The PNG bytes.
 */
export async function appleTouchIconPng(mark: Mark): Promise<Buffer> {
  const { size, inkFraction } = APPLE_TOUCH;
  const region = Math.max(1, Math.round((size * inkFraction) / mark.inkFraction));
  const art = await sharp(mark.master)
    .extract({ left: mark.region.x, top: mark.region.y, width: mark.region.width, height: mark.region.height })
    .resize(region, region, { kernel: KERNEL })
    .png(PNG)
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: GROUND_DARK } })
    .composite([{ input: art, gravity: "centre" }])
    .flatten({ background: GROUND_DARK })
    .removeAlpha()
    .png(PNG)
    .toBuffer();
}

/**
 * The avatar: the full-colour mark on the dark ground, with margin enough that the circular crop
 * most social platforms apply cannot clip it.
 *
 * @param mark - The mark.
 * @returns The PNG bytes.
 */
export async function avatarPng(mark: Mark): Promise<Buffer> {
  const region = Math.max(1, Math.round((AVATAR_SIZE * AVATAR_INK_FRACTION) / mark.inkFraction));
  const art = await sharp(mark.master)
    .extract({ left: mark.region.x, top: mark.region.y, width: mark.region.width, height: mark.region.height })
    .resize(region, region, { kernel: KERNEL })
    .png(PNG)
    .toBuffer();
  return sharp({ create: { width: AVATAR_SIZE, height: AVATAR_SIZE, channels: 4, background: GROUND_DARK } })
    .composite([{ input: art, gravity: "centre" }])
    .flatten({ background: GROUND_DARK })
    .removeAlpha()
    .png(PNG)
    .toBuffer();
}

/** The Open Graph image, and what its positioning line measured against the ground behind it. */
export interface SocialImage {
  /** The PNG bytes. */
  readonly bytes: Buffer;
  /** The mean colour of the composited ground under the positioning line. */
  readonly ground: string;
  /** WCAG 2.1 contrast of the positioning line against that ground. */
  readonly ratio: number;
}

/**
 * The Open Graph image: the hero capture cropped to 1200×630, a dark scrim so the ground colour
 * reads as `--bg` and the text stays legible, the single ember glow `02-design-system.md` §2.3
 * allows, then the dark horizontal lockup and the positioning line.
 *
 * The capture is not known in advance, so the positioning line's legibility cannot be reasoned
 * about up front: the function measures the composited ground under the text and refuses an image
 * whose text fails WCAG AA. Darkening {@link SOCIAL_SCRIM} is the fix.
 *
 * @param mark - The mark.
 * @param font - Archivo at weight 600.
 * @param capture - The hero capture's PNG bytes.
 * @param candidate - The chosen horizontal lockup construction.
 * @returns The image and its measured contrast.
 * @throws When the positioning line does not clear {@link AA_NORMAL_TEXT} against the ground the
 *   capture put behind it.
 */
export async function socialPng(
  mark: Mark,
  font: Font,
  capture: Buffer,
  candidate: HorizontalCandidateId,
): Promise<SocialImage> {
  const lockup = horizontalLockup(mark, font, candidate);
  const lockupWidth = 480;
  const lockupScale = lockupWidth / lockup.width;
  const lockupHeight = lockup.height * lockupScale;
  const left = 88;
  const gap = 44;
  const positioningSize = 34;

  const probe = outline(font, POSITIONING, { size: positioningSize, trackingEm: 0, originX: 0, baselineY: 0 });
  const blockHeight = lockupHeight + gap + probe.ink.height;
  const top = (SOCIAL_SIZE.height - blockHeight) / 2;
  const baselineY = top + lockupHeight + gap - probe.ink.y;

  const line = outline(font, POSITIONING, {
    size: positioningSize,
    trackingEm: 0,
    originX: left - probe.ink.x,
    baselineY,
  });

  // The lockup is drawn 480 px wide, so the mark only needs the ink height it occupies there.
  const base64 = await markInkBase64(mark, lockup.markInk.height * lockupScale);
  const overlay: SvgDocument = {
    width: SOCIAL_SIZE.width,
    height: SOCIAL_SIZE.height,
    ariaLabel: "ignifx — the TypeScript game engine for WebGPU",
    body:
      "<defs>" +
      `<radialGradient id="ember" cx="0.5" cy="0.5" r="0.62">` +
      `<stop offset="0" stop-color="${FLAME_ON_DARK}" stop-opacity="0.12"/>` +
      `<stop offset="1" stop-color="${FLAME_ON_DARK}" stop-opacity="0"/>` +
      "</radialGradient>" +
      "</defs>" +
      `<rect width="${String(SOCIAL_SIZE.width)}" height="${String(SOCIAL_SIZE.height)}"` +
      ` fill="${GROUND_DARK}" opacity="${String(SOCIAL_SCRIM)}"/>` +
      `<rect width="${String(SOCIAL_SIZE.width)}" height="${String(SOCIAL_SIZE.height)}" fill="url(#ember)"/>` +
      `<g transform="${transform({ x: left, y: top, scale: lockupScale })}">` +
      lockupBody(mark, lockup, { kind: "colour", base64 }, INK_ON_DARK) +
      "</g>" +
      `<path fill="${INK_2_ON_DARK}" d="${line.data}"/>`,
  };

  const ground = await sharp(capture)
    .resize(SOCIAL_SIZE.width, SOCIAL_SIZE.height, { fit: "cover", position: "centre" })
    .toBuffer();
  const front = await sharp(Buffer.from(renderSvg(overlay, SOCIAL_SIZE), "utf8"))
    .png(PNG)
    .toBuffer();
  const bytes = await sharp(ground)
    .composite([{ input: front }])
    .png(PNG)
    .toBuffer();

  // Measure the ground the capture actually put behind the text: everything below the scrim and the
  // glow but without the letters, which is the same overlay minus the one path that draws them.
  const withoutText: SvgDocument = { ...overlay, body: overlay.body.slice(0, overlay.body.lastIndexOf("<path")) };
  const behind = await sharp(ground)
    .composite([
      {
        input: await sharp(Buffer.from(renderSvg(withoutText, SOCIAL_SIZE), "utf8"))
          .png(PNG)
          .toBuffer(),
      },
    ])
    .png(PNG)
    .toBuffer();
  const groundHex = await meanColour(behind, line.ink);
  const ratio = contrastRatio(INK_2_ON_DARK, groundHex);
  if (ratio < AA_NORMAL_TEXT) {
    throw new Error(
      `the social image's positioning line is ${ratio.toFixed(2)}:1 against ${groundHex}, below ` +
        `${String(AA_NORMAL_TEXT)}:1. Darken SOCIAL_SCRIM in website/press/raster.ts.`,
    );
  }
  return { bytes, ground: groundHex, ratio };
}

/**
 * The mean colour of a region of an image, as `#RRGGBB`.
 *
 * @param image - The PNG bytes.
 * @param box - The region, in pixels.
 * @returns The mean colour.
 */
async function meanColour(image: Buffer, box: Box): Promise<string> {
  const pixel = await sharp(image)
    .extract({
      left: Math.max(0, Math.floor(box.x)),
      top: Math.max(0, Math.floor(box.y)),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    })
    .resize(1, 1, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const hex = [...pixel.subarray(0, 3)].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return `#${hex.toUpperCase()}`;
}
