/**
 * Emits `dist/_headers` and `dist/_redirects` from `website/headers.txt` and
 * `website/redirects.txt` (`08-execution.md` §4.5).
 *
 * They are templates rather than `public/` files for two reasons: Vite copies `public/` after the
 * bundle is written and would overwrite an emitted file, and both need something the build knows
 * and the source does not — the SHA-256 of the JSON-LD block, and one redirect per Agent Skill
 * file.
 */

import path from "node:path";
import { site } from "../site.config.ts";
import { jsonLdHash } from "./layout.ts";
import { findSkillPages } from "./skill-tree.ts";
import { readText } from "./text.ts";

/** The marker line `redirects.txt` carries where the generated block goes. */
const SKILL_MARKER = "%%SKILL_REDIRECTS%%";

/** The marker `headers.txt` carries on its `script-src` line. */
const HASH_MARKER = "%%JSONLD_HASH%%";

/** Column width the generated redirect sources are padded to, so the file reads as a table. */
const SOURCE_WIDTH = 44;

/**
 * Renders `_headers`.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The file contents.
 * @throws When the template has lost its hash marker.
 */
export function renderHeaders(websiteRoot: string): string {
  const template = readText(path.join(websiteRoot, "headers.txt"));
  if (!template.includes(HASH_MARKER)) {
    throw new Error("website: headers.txt no longer carries the JSON-LD hash marker, so the block would be blocked.");
  }
  return template.replaceAll(HASH_MARKER, jsonLdHash());
}

/**
 * Renders one redirect line, padded into columns.
 *
 * @param from - The source path.
 * @param to - The destination, a site path or an absolute URL.
 * @returns The line, without its newline.
 */
function line(from: string, to: string): string {
  return `${from.padEnd(SOURCE_WIDTH)} ${to} 301`;
}

/**
 * Renders `_redirects`.
 *
 * Every skill file gets an explicit line, because Cloudflare documents a splat as a whole-tail
 * match and says nothing about text after `:splat` — `/skill/references/*` →
 * `…/references/:splat.md` is therefore written as a safety net after the explicit lines rather
 * than relied on. Rules are matched in file order, so the specific lines come first.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The file contents.
 * @throws When the template has lost its marker.
 */
export function renderRedirects(repositoryRoot: string, websiteRoot: string): string {
  const template = readText(path.join(websiteRoot, "redirects.txt"));
  if (!template.includes(SKILL_MARKER)) {
    throw new Error("website: redirects.txt no longer carries the skill-redirects marker line.");
  }
  const pages = findSkillPages(repositoryRoot);
  const generated: string[] = [
    "# Generated from the Agent Skill tree by scripts/headers.ts. One line per file, then two splat",
    "# rules for anything added without rebuilding, then the retired `/docs/skill/*` alias.",
  ];
  for (const page of pages) {
    generated.push(line(page.route, `${site.blob}/${page.repoPath}`));
  }
  generated.push(
    "",
    line("/skill/references/*", `${site.blob}/skills/ignifx/references/:splat.md`),
    line("/skill/*", `${site.tree}/skills/ignifx/:splat`),
    line("/docs/skill/*", "/skill/:splat"),
  );
  return template.replaceAll(SKILL_MARKER, generated.join("\n"));
}
