/**
 * Everything the site states about ignifx is read out of the repository at build time, so a page
 * cannot claim a number the tree does not hold. Nothing here is written by hand except the shape it
 * is read into; the values come from `packages/core/package.json`, `AGENTS.md`,
 * `benchmarks/baselines.json`, `packages/core/src/app/types.ts`, and the template and example
 * `README.md` files.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** The canonical repository URL, as the Phase 0 shell already published it. */
export const REPOSITORY_URL = "https://github.com/astrum-forge/ignifx";

/** `blob/main` prefix for source links. */
export const BLOB_URL = `${REPOSITORY_URL}/blob/main`;

/** `tree/main` prefix for directory links. */
export const TREE_URL = `${REPOSITORY_URL}/tree/main`;

/** One frame phase, as `packages/core/src/app/types.ts` defines it. */
export interface FramePhase {
  /** The `Phase` member name. */
  readonly name: string;
  /** Its ordinal, which is the order the frame function walks the phases in. */
  readonly ordinal: number;
  /** One line of what runs in it, taken from the TSDoc on the member. */
  readonly summary: string;
}

/** A measured bundle size from `benchmarks/baselines.json`. */
export interface BundleSize {
  /** The workspace path the number was measured for. */
  readonly target: string;
  /** Entry-chunk bytes after gzip — what a first load actually fetches. */
  readonly gzipBytes: number;
}

/** Facts about one template or example, read from its `README.md`. */
export interface Showcase {
  /** Directory name, which is also the golden-screenshot name. */
  readonly name: string;
  /** `templates` or `examples`. */
  readonly group: "templates" | "examples";
  /** The lead paragraph of its `README.md`, as one line of Markdown. */
  readonly blurb: string;
  /** The rows of its `## Controls` table, if it has one: action plus the keyboard column. */
  readonly controls: readonly (readonly [string, string])[];
  /** Repository-relative path to the directory. */
  readonly repoPath: string;
  /** Entry-chunk gzip bytes, when `benchmarks/baselines.json` records one. */
  readonly gzipBytes: number | null;
}

/** Everything the pages read. */
export interface RepositoryFacts {
  /** The version every `@ignifx/*` package carries. */
  readonly version: string;
  /** The `AGENTS.md` Status sentence about which phases are delivered. */
  readonly statusSentence: string;
  /** The six frame phases, in ordinal order. */
  readonly phases: readonly FramePhase[];
  /** Median CPU milliseconds per frame for the 1,002-entity benchmark scene. */
  readonly thousandEntityMs: number;
  /** Entity count behind {@link RepositoryFacts.thousandEntityMs}. */
  readonly thousandEntityCount: number;
  /** The machine the baselines were recorded on. */
  readonly baselineMachine: string;
  /** The date the baselines were recorded. */
  readonly baselineDate: string;
  /** Entry-chunk gzip sizes per template and example. */
  readonly bundles: readonly BundleSize[];
  /** The browser requirement row of the skill's Environment table. */
  readonly browserSupport: string;
  /** The pinned Babylon Lite version. */
  readonly liteVersion: string;
  /** Templates and examples, in display order. */
  readonly showcases: readonly Showcase[];
}

/**
 * The six phases. The names and ordinals are asserted against `packages/core/src/app/types.ts`
 * during the build ({@link readFacts} throws when they drift), and the summaries are that file's
 * own TSDoc, shortened.
 */
const PHASES: readonly FramePhase[] = [
  { name: "EndOfFrame", ordinal: 0, summary: "Deferred signal deliveries, drained before the clock advances." },
  { name: "PreUpdate", ordinal: 1, summary: "Input polling and asset delivery, before any script callback." },
  { name: "FixedUpdate", ordinal: 2, summary: "The fixed-timestep loop: fixedUpdate, physics, collision dispatch." },
  { name: "Update", ordinal: 3, summary: "update on every enabled script, then coroutine resumption." },
  { name: "PostUpdate", ordinal: 4, summary: "Animation, state machines and tweens." },
  { name: "PreRender", ordinal: 5, summary: "Interpolation, sprite and camera sync, audio, diagnostics." },
];

const TABLE_ROW = /^\|(?<cells>.+)\|\s*$/gmu;

/**
 * Reads and parses one JSON file.
 *
 * @param file - Absolute path.
 * @returns The parsed value.
 */
function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Reads a nested string/number out of parsed JSON without `any`.
 *
 * @param value - The parsed value.
 * @param keys - The property path to walk.
 * @returns The value found, or `null`.
 */
function pick(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    // The guard above proves `current` is an object with `key` on it, but TypeScript keeps its
    // static type (`unknown`), and there is no index signature to read through. This is the one
    // boundary between parsed JSON and typed code in the site (coding standards §5.2).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Reads a number out of parsed JSON.
 *
 * @param value - The parsed value.
 * @param keys - The property path.
 * @returns The number, or `0` when the path is missing.
 */
function pickNumber(value: unknown, keys: readonly string[]): number {
  const found = pick(value, keys);
  return typeof found === "number" ? found : 0;
}

/**
 * Reads a string out of parsed JSON.
 *
 * @param value - The parsed value.
 * @param keys - The property path.
 * @returns The string, or an empty string when the path is missing.
 */
function pickString(value: unknown, keys: readonly string[]): string {
  const found = pick(value, keys);
  return typeof found === "string" ? found : "";
}

/**
 * Extracts the lead paragraph of a Markdown file: everything between the `#` heading and the first
 * blank line after it, collapsed onto one line.
 *
 * @param source - The file's text.
 * @returns The paragraph, or an empty string.
 */
function leadParagraph(source: string): string {
  const lines = source.split("\n");
  const collected: string[] = [];
  let seenTitle = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenTitle) {
      seenTitle = trimmed.startsWith("# ");
      continue;
    }
    if (trimmed === "") {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("```")) {
      break;
    }
    collected.push(trimmed);
  }
  return collected.join(" ");
}

/**
 * Extracts a template's `## Controls` table as action/keyboard pairs.
 *
 * @param source - The `README.md` text.
 * @returns The rows, header and alignment row dropped.
 */
function controlsTable(source: string): readonly (readonly [string, string])[] {
  // Split on `## ` headings rather than matching across them: a lookahead for "the next heading or
  // the end of the file" needs `\Z`, which JavaScript does not have.
  const section = source.split(/^## /mu).find((block) => block.startsWith("Controls")) ?? "";
  const rows: (readonly [string, string])[] = [];
  for (const match of section.matchAll(TABLE_ROW)) {
    const cells = (match.groups?.["cells"] ?? "").split("|").map((cell) => cell.trim());
    const [action = "", keyboard = ""] = cells;
    if (action === "" || /^-+$/u.test(action) || action.toLowerCase() === "action") {
      continue;
    }
    rows.push([action, keyboard]);
  }
  return rows;
}

/**
 * Reads every fact the pages use.
 *
 * @param root - Absolute path to the repository root.
 * @returns The facts.
 * @throws When the frame phases in `packages/core/src/app/types.ts` no longer match {@link PHASES}.
 */
export function readFacts(root: string): RepositoryFacts {
  const types = readFileSync(path.join(root, "packages", "core", "src", "app", "types.ts"), "utf8");
  for (const phase of PHASES) {
    if (!new RegExp(`\\b${phase.name}: ${String(phase.ordinal)},`, "u").test(types)) {
      throw new Error(
        `website: the hero timeline names ${phase.name} = ${String(phase.ordinal)}, which packages/core/src/app/types.ts no longer declares.`,
      );
    }
  }

  const baselines = readJson(path.join(root, "benchmarks", "baselines.json"));
  const bundleBlock = pick(baselines, ["bundles"]);
  const bundles: BundleSize[] = [];
  if (typeof bundleBlock === "object" && bundleBlock !== null) {
    for (const target of Object.keys(bundleBlock)) {
      bundles.push({ target, gzipBytes: pickNumber(bundleBlock, [target, "gzipBytes"]) });
    }
  }

  const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const status = /^Phases 0–\d+ of .*?\.\s/mu.exec(agents)?.[0]?.trim() ?? "";

  const skill = readFileSync(path.join(root, "skills", "ignifx", "SKILL.md"), "utf8");
  const browserRow = /^\| Browser requirement \|(?<value>.+?)\|\s*$/mu.exec(skill)?.groups?.["value"] ?? "";
  const liteRow = /^\| Babylon Lite\s*\|\s*(?<value>[\d.]+)/mu.exec(skill)?.groups?.["value"] ?? "";

  const showcases: Showcase[] = [];
  for (const group of ["templates", "examples"] as const) {
    const names =
      group === "templates"
        ? ["2d-topdown", "2d-sidescroller", "3d-third-person", "3d-first-person"]
        : ["hello-cube", "gltf-viewer"];
    for (const name of names) {
      const repoPath = `${group}/${name}`;
      const readme = path.join(root, group, name, "README.md");
      if (!existsSync(readme)) {
        continue;
      }
      const source = readFileSync(readme, "utf8");
      showcases.push({
        name,
        group,
        blurb: leadParagraph(source),
        controls: controlsTable(source),
        repoPath,
        gzipBytes: bundles.find((bundle) => bundle.target === repoPath)?.gzipBytes ?? null,
      });
    }
  }

  return {
    version: pickString(readJson(path.join(root, "packages", "core", "package.json")), ["version"]),
    statusSentence: status,
    phases: PHASES,
    thousandEntityMs: pickNumber(baselines, ["frameTime", "thousand-entities", "meanMs"]),
    thousandEntityCount: pickNumber(baselines, ["frameTime", "thousand-entities", "entities"]),
    baselineMachine: pickString(baselines, ["machine"]),
    baselineDate: pickString(baselines, ["recordedOn"]),
    bundles,
    browserSupport: browserRow.trim(),
    liteVersion: liteRow,
    showcases,
  };
}
