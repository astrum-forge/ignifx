/**
 * A YAML-subset parser for Agent Skill frontmatter.
 *
 * The Agent Skills spec (`docs/architecture/16-docs-harness-and-skill.md` §1) needs only scalar
 * `key: value` pairs plus one nested map (`metadata:`), so the harness parses that subset itself
 * rather than adding a YAML dependency to the repository root.
 */

/** Frontmatter parsed out of a Markdown file. */
export interface Frontmatter {
  /** Top-level scalar keys, in source order. */
  readonly fields: ReadonlyMap<string, string>;
  /** Nested maps such as `metadata:`, keyed by the parent key then the child key. */
  readonly maps: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Number of lines the frontmatter block occupies, delimiters included. */
  readonly lineCount: number;
}

/** Outcome of parsing frontmatter: either a block or the reasons it could not be read. */
export interface FrontmatterResult {
  /** The parsed block, or `null` when the file has none or it is malformed. */
  readonly frontmatter: Frontmatter | null;
  /** Human-readable problems found while parsing. */
  readonly errors: readonly string[];
}

const SCALAR_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/u;
const NESTED_LINE = /^[ \t]+([A-Za-z0-9_-]+):[ \t]*(.*)$/u;

/**
 * Removes matching surrounding quotes from a scalar value.
 *
 * @param value - The raw text after the colon.
 * @returns The value without its surrounding quotes.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.slice(0, 1);
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses the leading `---` delimited frontmatter block of a Markdown source.
 *
 * @param source - Full Markdown file contents.
 * @returns The parsed block plus any problems found.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, errors: ["file does not start with a `---` frontmatter delimiter"] };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return { frontmatter: null, errors: ["frontmatter block is not closed by a `---` line"] };
  }
  const fields = new Map<string, string>();
  const maps = new Map<string, Map<string, string>>();
  const errors: string[] = [];
  let currentMap: Map<string, string> | null = null;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const nested = NESTED_LINE.exec(line);
    if (nested !== null && currentMap !== null) {
      currentMap.set(nested[1] ?? "", unquote(nested[2] ?? ""));
      continue;
    }
    const scalar = SCALAR_LINE.exec(line);
    if (scalar === null) {
      errors.push(`line ${String(index + 1)}: not a \`key: value\` pair (nested lists are not supported)`);
      continue;
    }
    const key = scalar[1] ?? "";
    const value = unquote(scalar[2] ?? "");
    if (value === "") {
      currentMap = new Map<string, string>();
      maps.set(key, currentMap);
      continue;
    }
    currentMap = null;
    fields.set(key, value);
  }
  return { frontmatter: { fields, maps, lineCount: end + 1 }, errors };
}
