/**
 * The `SKILL.md` template rules of `docs/architecture/16-docs-harness-and-skill.md` §2: which `##`
 * sections a skill has, in which order, and what the "Deprecated (current window)" section may say.
 *
 * The template is a contract, not a suggestion: an agent that has read one skill knows where to
 * look in every other one. A subsystem skill may not add sections of its own — extra material goes
 * under a `###` heading inside the section it belongs to.
 */
import { extractSections, stripFencedBlocks } from "./markdown.ts";
import type { SkillRoot } from "./skill-files.ts";

/** The `##` sections every `SKILL.md` has, in order (§2). */
export const SKILL_SECTIONS = [
  "What this is / when to use",
  "Environment",
  "Mental model",
  "First app",
  "Core APIs",
  "Recipes",
  "File formats",
  "Gotchas",
  "Deprecated (current window)",
  "Where to look next",
] as const;

/** Title of the section whose contents §2 constrains. */
const DEPRECATED_SECTION = "Deprecated (current window)";

/** `## Gotchas` may carry a count, as in `## Gotchas (top 12)`. */
const GOTCHAS_WITH_COUNT = /^Gotchas \(top \d+\)$/u;

/** One line per symbol, `` `X` is deprecated; use `Y`. `` — optionally as a list item (§2 step 10). */
const DEPRECATION_LINE = /^(?:[-*]\s+)?`(?<symbol>[^`]+)` is deprecated; use `[^`]+`\.?$/u;

/**
 * Folds the allowed variants of a heading onto the template's name.
 *
 * @param title - The heading text, without the leading hashes.
 * @returns The template section name when the heading is one of its allowed spellings.
 */
function normalizeSectionTitle(title: string): string {
  return GOTCHAS_WITH_COUNT.test(title) ? "Gotchas" : title;
}

/**
 * Checks that a `SKILL.md` carries exactly the template's sections, in the template's order.
 *
 * @param root - The skill being checked.
 * @param source - Contents of its `SKILL.md`.
 * @param problems - Collector the function appends messages to.
 */
export function checkSectionOrder(root: SkillRoot, source: string, problems: string[]): void {
  const found = extractSections(stripFencedBlocks(source)).map((section) => ({
    title: section.title,
    startLine: section.startLine,
    name: normalizeSectionTitle(section.title),
  }));
  const expected = new Set<string>(SKILL_SECTIONS);
  let strayed = false;
  for (const section of found) {
    if (!expected.has(section.name)) {
      problems.push(
        `${root.label}:${String(section.startLine)}: "## ${section.title}" is not a template section` +
          ` (16-docs-harness-and-skill.md §2); put extra material under a \`###\` inside the section it belongs to`,
      );
      strayed = true;
    }
  }
  const names = new Set(found.map((section) => section.name));
  for (const expectedName of SKILL_SECTIONS) {
    if (!names.has(expectedName)) {
      problems.push(`${root.label}: missing the template section "## ${expectedName}"`);
      strayed = true;
    }
  }
  if (strayed) {
    return;
  }
  for (const [index, section] of found.entries()) {
    const wanted = SKILL_SECTIONS[index];
    if (wanted !== undefined && section.name !== wanted) {
      problems.push(
        `${root.label}:${String(section.startLine)}: "## ${section.title}" is out of order;` +
          ` the template has "## ${wanted}" in position ${String(index + 1)}`,
      );
      return;
    }
  }
}

/**
 * Checks what the "Deprecated (current window)" section is allowed to say (§2 step 10).
 *
 * Before 1.0 there is no deprecation window at all, so the section states in one line that nothing
 * is deprecated. From 1.0 on it is a list of one line per symbol, each of the exact shape
 * `` `X` is deprecated; use `Y`. `` and each symbol named once — nothing else about the past.
 *
 * @param root - The skill being checked.
 * @param source - Contents of its `SKILL.md`.
 * @param releaseVersion - Version of `@ignifx/core`.
 * @param problems - Collector the function appends messages to.
 */
export function checkDeprecatedSection(
  root: SkillRoot,
  source: string,
  releaseVersion: string,
  problems: string[],
): void {
  const stripped = stripFencedBlocks(source);
  const sections = extractSections(stripped);
  const section = sections.find((candidate) => candidate.title === DEPRECATED_SECTION);
  if (section === undefined) {
    return;
  }
  const lines = stripped
    .split("\n")
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter((line) => line.number > section.startLine && line.number <= section.endLine && line.text !== "");
  if (lines.length === 0) {
    problems.push(`${root.label}:${String(section.startLine)}: "## ${DEPRECATED_SECTION}" is empty`);
    return;
  }
  if (releaseVersion.startsWith("0.")) {
    const first = lines[0];
    if (lines.length > 1 || first === undefined || !/^none\b/iu.test(first.text)) {
      problems.push(
        `${root.label}:${String(section.startLine)}: before 1.0 "## ${DEPRECATED_SECTION}" is one line` +
          ` starting with "None" — there is no deprecation window yet (16-docs-harness-and-skill.md §2)`,
      );
    }
    return;
  }
  const seen = new Set<string>();
  for (const line of lines) {
    const match = DEPRECATION_LINE.exec(line.text);
    if (match === null) {
      problems.push(
        `${root.label}:${String(line.number)}: "## ${DEPRECATED_SECTION}" takes one line per symbol,` +
          " `X` is deprecated; use `Y`. — and nothing else",
      );
      continue;
    }
    const symbol = match.groups?.["symbol"] ?? "";
    if (seen.has(symbol)) {
      problems.push(`${root.label}:${String(line.number)}: \`${symbol}\` is listed twice; one line per symbol`);
    }
    seen.add(symbol);
  }
}
