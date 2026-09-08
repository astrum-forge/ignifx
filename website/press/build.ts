/**
 * Generates the brand files.
 *
 * Two sets come out of one run, so they cannot drift apart (`05-press-kit.md` §3):
 *
 * - `website/public/press/**` — the logo package and the archive people download.
 * - the site's own icons: `website/public/{favicon.ico,favicon-16.png,favicon-32.png,
 *   apple-touch-icon.png}` and `website/public/brand/mark-<size>.png`, which the site shell links.
 *
 * Everything is derived from `website/brand/ignifx-mark.png` and the two variable fonts. Run it
 * with `pnpm --filter @ignifx/website press-kit`; add `--sheet <path>` to also render the lockup
 * construction sheet `02-design-system.md` §2.2 asks for, which is a review artefact and is
 * deliberately not written under `public/`.
 *
 * The output is committed, and the same inputs give the same bytes, so the command doubles as a
 * check that the committed files still match the mark, the font and the rules.
 *
 * Nothing here invents an image. When an input does not exist yet — a capture the visual suite has
 * not produced — the file is **skipped** and named in the report; a placeholder would end up on a
 * real Open Graph card.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArchive } from "./archive.ts";
import {
  BADGE,
  badgeSvg,
  horizontalLockup,
  HORIZONTAL_CANDIDATES,
  lockupSvg,
  markSvg,
  measureWordmark,
  silhouetteIconSvg,
  silhouetteSvg,
  stackedLockup,
  wordmarkSvg,
  WORDMARK_TEXT,
} from "./art.ts";
import {
  ARCHIVO_FILE,
  BADGE_MARK_STYLE,
  FAVICON_ICO_SIZES,
  FLAME_ON_DARK,
  FLAME_ON_LIGHT,
  HORIZONTAL_CONSTRUCTION,
  INK_2_ON_DARK,
  INK_2_ON_LIGHT,
  INK_ON_DARK,
  INK_ON_LIGHT,
  MARK_MASTER,
  MARK_PNG_SIZES,
  PAPER,
  RULE_ON_DARK,
  RULE_ON_LIGHT,
  SCREENSHOTS,
  SILHOUETTE_PNG_SIZES,
  SITE_MARK_SIZES,
  SOCIAL_CAPTURE,
  SURFACE_ON_DARK,
  UNITS_PER_EM,
  WHITE,
  WORDMARK_TRACKING_EM,
  WORDMARK_WEIGHT,
} from "./brand.ts";
import { AA_NORMAL_TEXT, contrastRatio } from "./contrast.ts";
import { captionsText, coloursText, licenceText } from "./docs.ts";
import { buildIco } from "./ico.ts";
import { loadMark } from "./mark.ts";
import {
  appleTouchIconPng,
  AVATAR_SIZE,
  avatarPng,
  markInkBase64,
  markSquarePng,
  rasteriseToHeight,
  rasteriseToWidth,
  socialPng,
  SOCIAL_SIZE,
} from "./raster.ts";
import { constructionSheet } from "./sheet.ts";
import { num, renderSvg } from "./svg.ts";
import { openWeight600 } from "./type.ts";
import type { ArchiveEntry } from "./archive.ts";
import type { BadgeColours, MarkStyle } from "./art.ts";
import type { Mark } from "./mark.ts";
import type { SvgDocument } from "./svg.ts";

/** The lockup PNG widths, and the suffix each is published under. */
const LOCKUP_RASTERS = [
  { suffix: "1x", width: 400 },
  { suffix: "2x", width: 800 },
  { suffix: "4x", width: 1600 },
] as const;

/** The badge PNG heights (`05-press-kit.md` §3). */
const BADGE_HEIGHTS = [20, 32] as const;

/** The two badges (`05-press-kit.md` §4). */
const BADGES = [
  { slug: "powered-by-ignifx", label: "Powered by" },
  { slug: "made-with-ignifx", label: "Made with" },
] as const;

/** The light badge colourway. */
const BADGE_LIGHT: BadgeColours = {
  ground: PAPER,
  border: RULE_ON_LIGHT,
  label: INK_2_ON_LIGHT,
  wordmark: INK_ON_LIGHT,
  mark: FLAME_ON_LIGHT,
};

/** The dark badge colourway. */
const BADGE_DARK: BadgeColours = {
  ground: SURFACE_ON_DARK,
  border: RULE_ON_DARK,
  label: INK_2_ON_DARK,
  wordmark: INK_ON_DARK,
  mark: FLAME_ON_DARK,
};

/** The gaps the construction sheet compares: the brand's 0.35 em, and 0.1 em more. */
const SHEET_GAPS = [0.35, 0.45] as const;

/**
 * Prints one line of the build report.
 *
 * @param line - The line.
 */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** One finished file. */
interface KitFile {
  /** Path inside its root, forward slashes. */
  readonly file: string;
  /** The contents. */
  readonly bytes: Uint8Array;
}

/**
 * Collects files, rasterisations included, and only settles them at the end.
 *
 * Nothing is written until every file is in hand, so a failure halfway through cannot leave a
 * half-updated directory. A PNG is added as the still-running `sharp` promise, so the rasterisations
 * overlap instead of queueing.
 */
class Kit {
  readonly #files: { readonly file: string; readonly bytes: Uint8Array | Promise<Uint8Array> }[] = [];

  /**
   * Records one file.
   *
   * @param file - Path inside the root, forward slashes.
   * @param bytes - The contents: bytes, a UTF-8 string, or a promise of bytes.
   */
  add(file: string, bytes: Uint8Array | string | Promise<Uint8Array>): void {
    this.#files.push({ file, bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes });
  }

  /**
   * Records an SVG.
   *
   * @param file - Path inside the root.
   * @param document - The vector.
   * @param pixelSize - As {@link renderSvg}: `null` omits the intrinsic size.
   * @returns The same document, so the caller can rasterise it too.
   */
  addSvg(file: string, document: SvgDocument, pixelSize?: null): SvgDocument {
    this.add(file, renderSvg(document, pixelSize));
    return document;
  }

  /**
   * Waits for every rasterisation and returns the files in the order they were added.
   *
   * @returns The finished files.
   */
  settle(): Promise<readonly KitFile[]> {
    return Promise.all(this.#files.map(async (entry) => ({ file: entry.file, bytes: await entry.bytes })));
  }
}

/**
 * Replaces a directory with exactly the given files: one that is no longer produced cannot survive
 * in the committed output.
 *
 * @param root - Absolute path to the directory.
 * @param files - What to write.
 */
async function replaceDirectory(root: string, files: readonly KitFile[]): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await writeFiles(root, files);
}

/**
 * Writes files under a root, creating directories as needed and leaving anything else alone.
 *
 * @param root - Absolute path to the directory.
 * @param files - What to write.
 */
async function writeFiles(root: string, files: readonly KitFile[]): Promise<void> {
  await Promise.all(
    files.map(async (entry) => {
      const target = path.join(root, entry.file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.bytes);
    }),
  );
}

/**
 * Reads a file, or returns `null` when it does not exist yet.
 *
 * @param file - Absolute path.
 * @returns The bytes, or `null`.
 * @throws When the file exists but cannot be read.
 */
async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Checks one badge colourway's colours against its ground, prints the ratios, and refuses a
 * colourway whose text fails WCAG AA (`05-press-kit.md` §6).
 *
 * @param name - The colourway's name, for the report.
 * @param colours - The colourway.
 * @throws When a text colour is below {@link AA_NORMAL_TEXT}.
 */
function checkBadgeContrast(name: string, colours: BadgeColours): void {
  const pairs: readonly (readonly [string, string, boolean])[] = [
    ["label", colours.label, true],
    ["wordmark", colours.wordmark, true],
    ["silhouette", colours.mark, false],
  ];
  for (const [role, colour, isText] of pairs) {
    const ratio = contrastRatio(colour, colours.ground);
    say(`  ${name.padEnd(6)} ${role.padEnd(11)} ${colour} on ${colours.ground}  ${ratio.toFixed(2)}:1`);
    if (isText && ratio < AA_NORMAL_TEXT) {
      throw new Error(
        `the ${name} badge's ${role} contrast is ${ratio.toFixed(2)}:1, below ${String(AA_NORMAL_TEXT)}:1`,
      );
    }
  }
}

/**
 * How a badge draws the mark in one colourway.
 *
 * @param mark - The mark.
 * @param colours - The colourway.
 * @param inkHeight - The ink height the badge draws the mark at, in pixels.
 * @returns The style.
 */
async function badgeMarkStyle(mark: Mark, colours: BadgeColours, inkHeight: number): Promise<MarkStyle> {
  if (BADGE_MARK_STYLE === "silhouette") {
    return { kind: "silhouette", fill: colours.mark };
  }
  // Prepared at a little over twice the drawn size, so the badge stays clean when a README renders
  // it on a 2× display, without the base64 of a hot-linked file running to half a megabyte.
  return { kind: "colour", base64: await markInkBase64(mark, inkHeight * 2) };
}

/**
 * Builds every brand file.
 *
 * @param sheetPath - Where to write the construction sheet, or `null` to skip it.
 * @returns Nothing; the report goes to standard output.
 * @throws When an input is malformed, a rasterisation misses its target size, or a contrast check
 *   fails. An input that simply does not exist yet is skipped instead.
 */
async function run(sheetPath: string | null): Promise<void> {
  const websiteRoot = path.join(import.meta.dirname, "..");
  const publicRoot = path.join(websiteRoot, "public");
  const pressRoot = path.join(publicRoot, "press");
  const brandRoot = path.join(publicRoot, "brand");
  const capturesRoot = path.join(publicRoot, "examples");
  const kit = new Kit();
  const site = new Kit();
  const siteMarks = new Kit();
  const skipped: string[] = [];

  const mark = await loadMark(path.join(websiteRoot, MARK_MASTER));
  const archivo = openWeight600(path.join(websiteRoot, ARCHIVO_FILE));

  say("ignifx brand files");
  say("");
  say("Inputs");
  say(
    `  mark      ${MARK_MASTER} — ${String(mark.canvas)}x${String(mark.canvas)} RGBA, ${String(mark.master.byteLength)} bytes`,
  );
  say(
    `            ink ${num(mark.ink.width)}x${num(mark.ink.height)} at (${num(mark.ink.x)}, ${num(mark.ink.y)});` +
      ` aspect ${mark.aspect.toFixed(4)}`,
  );
  say(
    `            square region ${num(mark.region.width)} at (${num(mark.region.x)}, ${num(mark.region.y)});` +
      ` ink is ${(mark.inkFraction * 100).toFixed(2)}% of it`,
  );
  say(`  wordmark  ${ARCHIVO_FILE}`);
  say(`            ${archivo.familyName} — weight ${String(WORDMARK_WEIGHT)}, ${String(archivo.unitsPerEm)} units/em`);

  say("");
  say("Silhouette (traced from the master's alpha edge)");
  say(
    `  ${String(mark.silhouette.boundaryPixels)} boundary pixels -> ${String(mark.silhouette.vertices)} vertices` +
      ` at Douglas-Peucker tolerance ${num(mark.silhouette.tolerance)} px`,
  );
  say(
    `  mismatch against the master's own mask: ${(mark.silhouette.mismatchOfInk * 100).toFixed(3)}% of the ink,` +
      ` ${(mark.silhouette.mismatchOfCanvas * 100).toFixed(3)}% of the canvas`,
  );

  say("");
  say("Mark palette (sampled; not brand tokens)");
  for (const facet of mark.palette) {
    say(`  ${facet.hex}  ${facet.name.padEnd(12)} ${(facet.share * 100).toFixed(1)}% of the mark`);
  }

  // The construction numbers, printed so a change to the mark or to Archivo shows up in a build log.
  const metrics = measureWordmark(archivo, UNITS_PER_EM);
  const shaped = archivo.layout(WORDMARK_TEXT);
  const advances = shaped.glyphs.map(
    (glyph, index) => `${glyph.name} ${num(shaped.positions[index]?.xAdvance ?? Number.NaN)}`,
  );
  const horizontal = horizontalLockup(mark, archivo, HORIZONTAL_CONSTRUCTION.candidate, HORIZONTAL_CONSTRUCTION.gapEm);
  const stacked = stackedLockup(mark, archivo);

  say("");
  say(`Construction — press units, ${String(UNITS_PER_EM)} per em`);
  say(`  cap height ${num(metrics.capHeight)} · x-height ${num(metrics.xHeight)}`);
  say(`  wordmark ink rises ${num(metrics.aboveBaseline)} above the baseline, drops ${num(metrics.belowBaseline)}`);
  say(`  tracking ${String(WORDMARK_TRACKING_EM)} em · glyph advances, font units: ${advances.join(", ")}`);
  say(`  tracked advance ${num(metrics.advance)} · ink box ${num(metrics.width)}x${num(metrics.height)}`);
  say(
    `  horizontal, candidate ${HORIZONTAL_CONSTRUCTION.candidate} at ${String(HORIZONTAL_CONSTRUCTION.gapEm)} em:` +
      ` ${num(horizontal.width)}x${num(horizontal.height)} — mark ink` +
      ` ${num(horizontal.notes["markInkWidth"] ?? Number.NaN)}x${num(horizontal.notes["markInkHeight"] ?? Number.NaN)}` +
      ` at y ${num(horizontal.notes["markInkTop"] ?? Number.NaN)}, gap ${num(horizontal.notes["gap"] ?? Number.NaN)}`,
  );
  say(
    `  stacked: ${num(stacked.width)}x${num(stacked.height)} — mark ink` +
      ` ${num(stacked.notes["markInkWidth"] ?? Number.NaN)}x${num(stacked.notes["markInkHeight"] ?? Number.NaN)},` +
      ` gap ${num(stacked.notes["gap"] ?? Number.NaN)}`,
  );

  if (sheetPath !== null) {
    const sheet = await constructionSheet(mark, archivo, HORIZONTAL_CANDIDATES, SHEET_GAPS);
    await mkdir(path.dirname(sheetPath), { recursive: true });
    await writeFile(sheetPath, sheet.png);
    say("");
    say(`Construction sheet -> ${sheetPath}`);
    for (const line of sheet.lines) {
      say(`  ${line}`);
    }
  }

  // The mark: the cleaned wrapper, the colour rasters, the silhouette.
  kit.addSvg("ignifx-mark.svg", markSvg(mark), null);
  for (const size of MARK_PNG_SIZES) {
    kit.add(`ignifx-mark-${String(size)}.png`, markSquarePng(mark, size));
  }
  kit.addSvg("ignifx-mark-silhouette.svg", silhouetteSvg(mark, "currentColor"));
  kit.addSvg("ignifx-mark-silhouette-black.svg", silhouetteSvg(mark, INK_ON_LIGHT));
  kit.addSvg("ignifx-mark-silhouette-white.svg", silhouetteSvg(mark, WHITE));
  for (const [tone, fill] of [
    ["black", INK_ON_LIGHT],
    ["white", WHITE],
  ] as const) {
    const icon = silhouetteIconSvg(mark, fill);
    for (const size of SILHOUETTE_PNG_SIZES) {
      kit.add(`ignifx-mark-silhouette-${tone}-${String(size)}.png`, rasteriseToHeight(icon, size));
    }
  }

  // The wordmark.
  kit.addSvg("ignifx-wordmark.svg", wordmarkSvg(archivo, INK_ON_LIGHT));
  kit.addSvg("ignifx-wordmark-white.svg", wordmarkSvg(archivo, WHITE));

  // The lockups. Mono uses the silhouette, since `currentColor` is the whole point of it.
  for (const [name, lockup] of [
    ["horizontal", horizontal],
    ["stacked", stacked],
  ] as const) {
    // The colour SVGs embed the master itself: a lockup is what goes into a slide or a print page,
    // where `05-press-kit.md` §3's 4x raster sizes have to stay sharp.
    const colour: MarkStyle = { kind: "colour", base64: mark.masterBase64 };
    const light = kit.addSvg(`ignifx-lockup-${name}.svg`, lockupSvg(mark, lockup, colour, INK_ON_LIGHT));
    const dark = kit.addSvg(`ignifx-lockup-${name}-dark.svg`, lockupSvg(mark, lockup, colour, INK_ON_DARK));
    kit.addSvg(
      `ignifx-lockup-${name}-mono.svg`,
      lockupSvg(mark, lockup, { kind: "silhouette", fill: "currentColor" }, "currentColor"),
    );
    for (const raster of LOCKUP_RASTERS) {
      kit.add(`ignifx-lockup-${name}-${raster.suffix}.png`, rasteriseToWidth(light, raster.width));
      kit.add(`ignifx-lockup-${name}-dark-${raster.suffix}.png`, rasteriseToWidth(dark, raster.width));
    }
  }

  // The badges.
  say("");
  say(`Badge contrast — WCAG 2.1; text needs ${String(AA_NORMAL_TEXT)}:1`);
  checkBadgeContrast("light", BADGE_LIGHT);
  checkBadgeContrast("dark", BADGE_DARK);
  const badgeSizes: string[] = [];
  const colourways = await Promise.all(
    (
      [
        ["", BADGE_LIGHT],
        ["-dark", BADGE_DARK],
      ] as const
    ).map(async ([suffix, colours]) => ({
      suffix,
      colours,
      style: await badgeMarkStyle(mark, colours, BADGE.markHeight),
    })),
  );
  for (const badge of BADGES) {
    for (const { suffix, colours, style } of colourways) {
      const document = kit.addSvg(
        `badges/${badge.slug}${suffix}.svg`,
        badgeSvg(mark, archivo, badge.label, colours, style),
      );
      badgeSizes.push(`${badge.slug}${suffix} ${num(document.width)}x${num(document.height)}`);
      for (const height of BADGE_HEIGHTS) {
        kit.add(`badges/${badge.slug}${suffix}-${String(height)}.png`, rasteriseToHeight(document, height));
      }
    }
  }
  say("");
  say(`Badge sizes — the mark is drawn ${String(BADGE.markHeight)} px tall, as ${BADGE_MARK_STYLE}`);
  for (const line of badgeSizes) {
    say(`  ${line}`);
  }

  // The avatar always; the social image only once its capture exists.
  kit.add(`ignifx-avatar-${String(AVATAR_SIZE)}.png`, avatarPng(mark));
  const socialName = `ignifx-social-${String(SOCIAL_SIZE.width)}x${String(SOCIAL_SIZE.height)}.png`;
  const capture = await readOptional(path.join(capturesRoot, SOCIAL_CAPTURE));
  if (capture === null) {
    skipped.push(`${socialName} — public/examples/${SOCIAL_CAPTURE} has not been captured yet`);
  } else {
    const social = await socialPng(mark, archivo, capture, HORIZONTAL_CONSTRUCTION.candidate);
    say("");
    say("Social image contrast");
    say(`  positioning ${INK_2_ON_DARK} on the composited ground ${social.ground}  ${social.ratio.toFixed(2)}:1`);
    kit.add(socialName, social.bytes);
  }

  // The screenshots, copied from what the visual pipeline wrote.
  const captures = await Promise.all(
    SCREENSHOTS.map(async (shot) => ({ shot, bytes: await readOptional(path.join(capturesRoot, shot.file)) })),
  );
  const copied: string[] = [];
  for (const { shot, bytes } of captures) {
    if (bytes === null) {
      skipped.push(`screenshots/${shot.file} — public/examples/${shot.file} has not been captured yet`);
    } else {
      kit.add(`screenshots/${shot.file}`, bytes);
      copied.push(shot.file);
    }
  }
  kit.add("screenshots/CAPTIONS.txt", captionsText(copied));

  // The text files.
  kit.add("colours.txt", coloursText(mark.palette));
  kit.add("LICENSE.txt", licenceText());

  // The archive, of everything above and nothing else. The site's own icons are not in it: they are
  // the site's plumbing, not a press asset.
  const settled = await kit.settle();
  const entries: readonly ArchiveEntry[] = settled.map((entry) => ({ path: entry.file, bytes: entry.bytes }));
  const pressFiles: readonly KitFile[] = [...settled, { file: "ignifx-press-kit.zip", bytes: buildArchive(entries) }];

  // The site's own icons.
  const icoPngs = await Promise.all(FAVICON_ICO_SIZES.map((size) => markSquarePng(mark, size)));
  site.add(
    "favicon.ico",
    buildIco(FAVICON_ICO_SIZES.map((size, index) => ({ size, png: icoPngs[index] ?? new Uint8Array() }))),
  );
  site.add("favicon-16.png", markSquarePng(mark, 16));
  site.add("favicon-32.png", markSquarePng(mark, 32));
  site.add("apple-touch-icon.png", appleTouchIconPng(mark));
  for (const size of SITE_MARK_SIZES) {
    siteMarks.add(`mark-${String(size)}.png`, markSquarePng(mark, size));
  }
  const siteFiles = await site.settle();
  const siteMarkFiles = await siteMarks.settle();

  await replaceDirectory(pressRoot, pressFiles);
  await replaceDirectory(brandRoot, siteMarkFiles);
  await writeFiles(publicRoot, siteFiles);

  say("");
  report("public/press/", pressFiles);
  report("public/", siteFiles);
  report("public/brand/", siteMarkFiles);

  if (skipped.length > 0) {
    say("");
    say(`SKIPPED ${String(skipped.length)} file(s): an input does not exist yet, and this generator never`);
    say("composites a placeholder. Re-run it once the examples pipeline has written the captures:");
    say("  pnpm --filter @ignifx/website press-kit");
    for (const line of skipped) {
      say(`  · ${line}`);
    }
  }
}

/**
 * Prints one written-file table.
 *
 * @param label - The directory the files went into.
 * @param files - The files.
 */
function report(label: string, files: readonly KitFile[]): void {
  say(`${String(files.length)} files in ${label}`);
  let total = 0;
  for (const entry of files) {
    total += entry.bytes.byteLength;
    say(`  ${entry.file.padEnd(40)} ${String(entry.bytes.byteLength).padStart(9)}`);
  }
  say(`  ${"total bytes".padEnd(40)} ${String(total).padStart(9)}`);
  say("");
}

const sheetFlag = process.argv.indexOf("--sheet");
const sheetTarget = sheetFlag < 0 ? null : (process.argv[sheetFlag + 1] ?? null);
if (sheetFlag >= 0 && sheetTarget === null) {
  process.stderr.write("--sheet needs a path to write the construction sheet to\n");
  process.exitCode = 1;
} else {
  try {
    await run(sheetTarget);
  } catch (error) {
    process.stderr.write(`press-kit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
  }
}
