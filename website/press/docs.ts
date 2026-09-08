/**
 * The three plain-text files the kit ships.
 *
 * Their wording is `05-press-kit.md` §2 and §5 verbatim, flattened to plain text: the archive is
 * read by people who never see `/press/`, so the rules have to travel with the files.
 */
import {
  FLAME_ON_DARK,
  FLAME_ON_LIGHT,
  GROUND_DARK,
  INK_2_ON_DARK,
  INK_2_ON_LIGHT,
  INK_ON_DARK,
  INK_ON_LIGHT,
  PAPER,
  RULE_ON_DARK,
  RULE_ON_LIGHT,
  SCREENSHOT_LICENCE,
  SCREENSHOTS,
  SURFACE_ON_DARK,
} from "./brand.ts";
import type { FacetColour } from "./mark.ts";

/**
 * `colours.txt` — every hex the kit uses, with the role it plays.
 *
 * @param facets - The mark's own colours, sampled from the master by `mark.ts`. They are listed so
 *   a designer matching a slide to the mark has the values, and marked not-for-reuse because the
 *   site's accent is `--flame`, not the artwork's magenta (`08-execution.md` §9).
 * @returns The file contents.
 */
export function coloursText(facets: readonly FacetColour[]): string {
  const rows: readonly (readonly [string, string])[] = [
    [FLAME_ON_LIGHT, "Flame — the mark and the accent, on light grounds"],
    [FLAME_ON_DARK, "Flame — the mark and the accent, on dark grounds"],
    [INK_ON_LIGHT, "Ink — the wordmark and body text, on light grounds"],
    [INK_ON_DARK, "Ink — the wordmark and body text, on dark grounds"],
    [INK_2_ON_LIGHT, "Secondary ink — the badge label, on light grounds"],
    [INK_2_ON_DARK, "Secondary ink — the badge label, on dark grounds"],
    [PAPER, "Paper — the light badge's ground"],
    [SURFACE_ON_DARK, "Surface (dark) — the dark badge's ground; the same value as ink on light"],
    [RULE_ON_LIGHT, "Hairline — the light badge's border"],
    [RULE_ON_DARK, "Hairline — the dark badge's border"],
    [GROUND_DARK, "Dark ground — the social image and the avatar"],
  ];
  return [
    "ignifx — brand colours",
    "",
    "The palette in 05-press-kit.md §2 and 02-design-system.md §2.3. Do not recolour the mark or",
    "the wordmark outside these values.",
    "",
    ...rows.map(([hex, role]) => `${hex}  ${role}`),
    "",
    "Mark facets, not for reuse: sampled from the master (brand/ignifx-mark.png). The artwork is a",
    "raster; these are the colours it is painted in, for matching a layout to it. They are not",
    "brand tokens and nothing else should be coloured with them.",
    "",
    ...facets.map(
      (facet) =>
        `${facet.hex}  mark facets, not for reuse: ${facet.name} (${(facet.share * 100).toFixed(1)}% of the mark)`,
    ),
    "",
  ].join("\n");
}

/**
 * `LICENSE.txt` — the usage rules, the trademark permission, the short boilerplate and how the
 * name is written.
 *
 * @returns The file contents.
 */
export function licenceText(): string {
  return [
    "ignifx — logo and badge usage",
    "",
    "The logos and badges in this archive are free to use under the rules below; no permission is",
    "needed.",
    "",
    "ABOUT",
    "",
    "ignifx is an open-source TypeScript game engine built on WebGPU, for 2D and 3D games that run",
    "in the browser and on the desktop.",
    "",
    "THE NAME",
    "",
    'Say it "ig-ni-fix". Write it ignifx, always lowercase, even at the start of a sentence.',
    "",
    "DO",
    "",
    "- Use the badges to show your game or project runs on ignifx.",
    "- Use the mark or lockup when writing about ignifx, in a talk, or in a list of engines.",
    "- Use the light lockup on dark grounds and the dark lockup on light grounds.",
    "- Keep the clear space: at least the height of the mark on every side.",
    "",
    "DO NOT",
    "",
    "- Change the colours, add effects, rotate, stretch, outline or recolour the mark.",
    "- Use the mark or name as part of your own product's name or logo, or in a way that suggests",
    "  Astrum Forge Studios made or endorses your product.",
    '- Capitalise it: it is ignifx, not "Ignifx" or "IgniFX".',
    "- Set the wordmark in another typeface.",
    "",
    "MINIMUM SIZES",
    "",
    "Mark 16 px. Horizontal lockup 96 px wide. Stacked lockup 64 px wide. Badges 20 px high.",
    "",
    "COLOURS",
    "",
    `Flame ${FLAME_ON_LIGHT} on light, ${FLAME_ON_DARK} on dark. Ink ${INK_ON_LIGHT}. ` +
      `Paper ${PAPER}. Dark ground ${GROUND_DARK}.`,
    "See colours.txt for the full list.",
    "",
    "PERMISSION",
    "",
    "The ignifx name and mark are trademarks of Astrum Forge Studios Pty Ltd. You may use them as",
    "described here to refer to ignifx. For anything else, email info@astrumforge.com.",
    "",
    "The engine itself is released under the Apache-2.0 licence; this file covers the marks only.",
    "",
  ].join("\n");
}

/**
 * `screenshots/CAPTIONS.txt` — one caption per capture that is present, plus the licence line
 * every capture is published under.
 *
 * @param present - File names that were copied into `screenshots/`.
 * @returns The file contents.
 */
export function captionsText(present: readonly string[]): string {
  const lines = SCREENSHOTS.filter((shot) => present.includes(shot.file)).map((shot) => shot.caption);
  const missing = SCREENSHOTS.filter((shot) => !present.includes(shot.file)).map((shot) => shot.file);
  return [
    "ignifx — screenshots",
    "",
    "Six captures at 1280×720, produced by the repository's visual test suite. No hand-made images.",
    "",
    ...(lines.length > 0 ? lines : ["(no captures in this archive yet)"]),
    ...(missing.length > 0
      ? ["", `Not yet captured: ${missing.join(", ")}. Rebuild the kit once the visual suite has run.`]
      : []),
    "",
    `Licence: ${SCREENSHOT_LICENCE}`,
    "",
  ].join("\n");
}
