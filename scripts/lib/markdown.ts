/**
 * Markdown scanning helpers shared by the docs scripts: fenced code blocks, relative links, and
 * `##` sections. Everything here is line-based on purpose — the harness must report line numbers
 * that a human can jump to, and a real Markdown AST would not make the rules any more precise.
 */

/** A fenced code block found in a Markdown file. */
export interface FencedBlock {
  /** The full info string after the opening fence, for example `ts ignore-check`. */
  readonly info: string;
  /** The info string split on whitespace. */
  readonly infoTokens: readonly string[];
  /** The block body, without the fence lines and without a trailing newline. */
  readonly code: string;
  /** 1-based line number of the opening fence. */
  readonly line: number;
}

/** A relative Markdown link. */
export interface MarkdownLink {
  /** The link target with any `#anchor` removed. */
  readonly target: string;
  /** 1-based line number the link appears on. */
  readonly line: number;
}

/** A `##` section of a Markdown file. */
export interface MarkdownSection {
  /** The heading text without the leading hashes. */
  readonly title: string;
  /** 1-based line number of the heading itself. */
  readonly startLine: number;
  /** 1-based line number of the last line belonging to the section. */
  readonly endLine: number;
}

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/u;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/iu;

/**
 * Decides whether a fence line closes the currently open block.
 *
 * @param openMarker - The marker run that opened the block.
 * @param marker - The marker run on the candidate line.
 * @param info - The text after the candidate marker.
 * @returns True when the line uses the same marker character, is at least as long, and carries no info string.
 */
function isClosingFence(openMarker: string, marker: string, info: string): boolean {
  return marker.slice(0, 1) === openMarker.slice(0, 1) && marker.length >= openMarker.length && info.trim() === "";
}

/**
 * Extracts every fenced code block from a Markdown source.
 *
 * @param source - Full Markdown file contents.
 * @returns The blocks in source order.
 */
export function extractFencedBlocks(source: string): readonly FencedBlock[] {
  const lines = source.split("\n");
  const blocks: FencedBlock[] = [];
  let open: { marker: string; info: string; line: number; body: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    const match = FENCE.exec(line);
    if (open === null) {
      if (match !== null) {
        open = { marker: match[2] ?? "", info: (match[3] ?? "").trim(), line: index + 1, body: [] };
      }
      continue;
    }
    if (match !== null && isClosingFence(open.marker, match[2] ?? "", match[3] ?? "")) {
      const info = open.info;
      blocks.push({
        info,
        infoTokens: info.split(/\s+/u).filter((token) => token !== ""),
        code: open.body.join("\n"),
        line: open.line,
      });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return blocks;
}

/**
 * Blanks out fenced code blocks so link scanning does not see example code.
 *
 * @param source - Full Markdown file contents.
 * @returns The source with every fenced block body and fence line replaced by an empty line.
 */
export function stripFencedBlocks(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  let marker: string | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (marker === null) {
      if (match !== null) {
        marker = match[2] ?? "";
        kept.push("");
        continue;
      }
      kept.push(line);
      continue;
    }
    if (match !== null && (match[3] ?? "").trim() === "") {
      marker = null;
    }
    kept.push("");
  }
  return kept.join("\n");
}

/**
 * Extracts relative Markdown links, ignoring code fences, absolute URLs and pure anchors.
 *
 * @param source - Full Markdown file contents.
 * @returns Every relative link with its line number.
 */
export function extractRelativeLinks(source: string): readonly MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const [index, line] of stripFencedBlocks(source).split("\n").entries()) {
    for (const match of line.matchAll(LINK)) {
      const raw = match[1] ?? "";
      if (ABSOLUTE.test(raw)) {
        continue;
      }
      const target = raw.split("#")[0] ?? "";
      if (target !== "") {
        links.push({ target, line: index + 1 });
      }
    }
  }
  return links;
}

/**
 * Splits a Markdown source into its `##` sections.
 *
 * @param source - Full Markdown file contents.
 * @returns The sections in source order; empty when the file has no `##` heading.
 */
export function extractSections(source: string): readonly MarkdownSection[] {
  const lines = source.split("\n");
  const starts: { title: string; startLine: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^##\s+(.*)$/u.exec(line);
    if (match !== null) {
      starts.push({ title: (match[1] ?? "").trim(), startLine: index + 1 });
    }
  }
  return starts.map((start, index) => ({
    title: start.title,
    startLine: start.startLine,
    endLine: (starts[index + 1]?.startLine ?? lines.length + 1) - 1,
  }));
}

/**
 * Finds the `##` section a line belongs to.
 *
 * @param sections - Sections from {@link extractSections}.
 * @param line - 1-based line number.
 * @returns The enclosing section, or `null` when the line sits before the first heading.
 */
export function sectionAt(sections: readonly MarkdownSection[], line: number): MarkdownSection | null {
  return sections.find((section) => line >= section.startLine && line <= section.endLine) ?? null;
}
