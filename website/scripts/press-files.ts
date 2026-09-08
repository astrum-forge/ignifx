/**
 * The press kit's file list (`website/plan/05-press-kit.md` §3 and §4).
 *
 * The generator that writes `website/public/press/**` belongs to another owner
 * (`08-execution.md` §5); this module is the site's half of the contract. The page shows only the
 * files that are on disk, and the production build fails when one the table names is missing, so
 * the page and the archive cannot disagree.
 */
import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Expands `prefix-{a,b}-{c,d}.ext` style templates into concrete names.
 *
 * @param parts - Name fragments; an array is a set of alternatives at that position.
 * @returns Every combination, in order.
 */
function combine(parts: readonly (string | readonly string[])[]): readonly string[] {
  let names: string[] = [""];
  for (const part of parts) {
    const options = typeof part === "string" ? [part] : part;
    names = names.flatMap((prefix) => options.map((option) => `${prefix}${option}`));
  }
  return names;
}

/**
 * The full-colour mark: the designer's SVG wrapper and the transparent PNG set. The artwork is
 * raster (`02-design-system.md` §2.1), so there is no `currentColor` colour mark.
 */
const MARK_FILES: readonly string[] = [
  "ignifx-mark.svg",
  ...combine(["ignifx-mark-", ["64", "128", "256", "512", "1024"], ".png"]),
];

/** The traced outline, which is what the single-colour variants are. */
const SILHOUETTE_FILES: readonly string[] = [
  "ignifx-mark-silhouette.svg",
  "ignifx-mark-silhouette-black.svg",
  "ignifx-mark-silhouette-white.svg",
  ...combine(["ignifx-mark-silhouette-", ["black", "white"], "-", ["256", "1024"], ".png"]),
];

/** The wordmark and the two lockups, in every colourway and raster size. */
const LOCKUP_FILES: readonly string[] = [
  "ignifx-wordmark.svg",
  "ignifx-wordmark-white.svg",
  ...combine(["ignifx-lockup-", ["horizontal", "stacked"], ["", "-dark", "-mono"], ".svg"]),
  ...combine(["ignifx-lockup-", ["horizontal", "stacked"], ["", "-dark"], "-", ["1x", "2x", "4x"], ".png"]),
];

/** The two social images. */
const SOCIAL_FILES: readonly string[] = ["ignifx-social-1200x630.png", "ignifx-avatar-1024.png"];

/** The badge vectors and their 20 px and 32 px rasters (`05` §4). */
const BADGE_FILES: readonly string[] = [
  ...combine(["badges/", ["powered-by-ignifx", "made-with-ignifx"], ["", "-dark"], ".svg"]),
  ...combine(["badges/", ["powered-by-ignifx", "made-with-ignifx"], ["", "-dark"], "-", ["20", "32"], ".png"]),
];

/** The text files and the archive. */
const DOCUMENT_FILES: readonly string[] = [
  "colours.txt",
  "LICENSE.txt",
  "screenshots/CAPTIONS.txt",
  "ignifx-press-kit.zip",
];

/** Every file `05` §3 lists, with the section of the page it appears under. */
export const PRESS_FILES: readonly { readonly group: string; readonly files: readonly string[] }[] = [
  { group: "Mark", files: MARK_FILES },
  { group: "Silhouette", files: SILHOUETTE_FILES },
  { group: "Wordmark and lockups", files: LOCKUP_FILES },
  { group: "Social", files: SOCIAL_FILES },
  { group: "Badges", files: BADGE_FILES },
  { group: "Documents", files: DOCUMENT_FILES },
];

/** One badge, as the page previews it. */
export interface Badge {
  /** The light-ground SVG, relative to `/press/`. */
  readonly light: string;
  /** The dark-ground SVG. */
  readonly dark: string;
  /** The visible text. */
  readonly label: string;
  /** What it is for. */
  readonly intendedFor: string;
}

/** The two badges (`05` §4). */
export const BADGES: readonly Badge[] = [
  {
    light: "badges/powered-by-ignifx.svg",
    dark: "badges/powered-by-ignifx-dark.svg",
    label: "Powered by ignifx",
    intendedFor: "A game's title screen, credits, store page, README",
  },
  {
    light: "badges/made-with-ignifx.svg",
    dark: "badges/made-with-ignifx-dark.svg",
    label: "Made with ignifx",
    intendedFor: "Itch pages, jam entries, portfolios",
  },
];

/**
 * Reads a PNG's pixel dimensions out of its IHDR chunk.
 *
 * The press page needs the real intrinsic size for an `<img>`'s `width`/`height`, so the browser
 * reserves the right box before the file arrives. Twenty-four bytes is cheaper than decoding, and it
 * keeps `sharp` out of the page renderer.
 *
 * @param file - Absolute path to a PNG.
 * @returns Its width and height, or `null` when the file is not a readable PNG.
 */
export function pngSize(file: string): ImageSize | null {
  if (!existsSync(file)) {
    return null;
  }
  const header = Buffer.alloc(24);
  const handle = openSync(file, "r");
  try {
    if (readSync(handle, header, 0, 24, 0) < 24) {
      return null;
    }
  } finally {
    closeSync(handle);
  }
  // 8-byte signature, then a 4-byte length and the four-character chunk type.
  if (header.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** An image's intrinsic pixel size. */
export interface ImageSize {
  /** Intrinsic width. */
  readonly width: number;
  /** Intrinsic height. */
  readonly height: number;
}

const SVG_SIZE = /\bwidth="(?<w>[\d.]+)(?:px)?"[^>]*?\bheight="(?<h>[\d.]+)(?:px)?"/u;
const SVG_VIEWBOX = /\bviewBox="[\d.-]+ [\d.-]+ (?<w>[\d.]+) (?<h>[\d.]+)"/u;

/**
 * Reads an SVG's intrinsic size from its `width`/`height` attributes, or from its `viewBox`.
 *
 * @param file - Absolute path to an SVG.
 * @returns Its size, rounded up, or `null` when neither is declared.
 */
function svgSize(file: string): ImageSize | null {
  const head = readFileSync(file, "utf8").slice(0, 1024);
  const match = SVG_SIZE.exec(head) ?? SVG_VIEWBOX.exec(head);
  const width = Number(match?.groups?.["w"] ?? Number.NaN);
  const height = Number(match?.groups?.["h"] ?? Number.NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/**
 * The intrinsic size of one press file, so an `<img>` can reserve the right box.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @param file - The file name, relative to `public/press/`.
 * @returns Its size, or `null` when the file is absent or its size cannot be read.
 */
export function pressImageSize(websiteRoot: string, file: string): ImageSize | null {
  const full = path.join(websiteRoot, "public", "press", file);
  if (!existsSync(full)) {
    return null;
  }
  return file.endsWith(".svg") ? svgSize(full) : pngSize(full);
}

/**
 * Which of the listed files are on disk.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The set of present file names, relative to `public/press/`.
 */
export function presentPressFiles(websiteRoot: string): ReadonlySet<string> {
  const root = path.join(websiteRoot, "public", "press");
  const present = new Set<string>();
  for (const group of PRESS_FILES) {
    for (const file of group.files) {
      if (existsSync(path.join(root, file))) {
        present.add(file);
      }
    }
  }
  return present;
}

/**
 * Which of the listed files are missing.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The missing file names, in table order.
 */
export function missingPressFiles(websiteRoot: string): readonly string[] {
  const present = presentPressFiles(websiteRoot);
  return PRESS_FILES.flatMap((group) => group.files).filter((file) => !present.has(file));
}

/**
 * The screenshots on disk. Their names are the visual suite's, not the plan's, so the page reads
 * the directory rather than naming them.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns File names under `public/press/screenshots/`, sorted.
 */
export function pressScreenshots(websiteRoot: string): readonly string[] {
  const directory = path.join(websiteRoot, "public", "press", "screenshots");
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".png"))
    .toSorted((left, right) => left.localeCompare(right));
}
