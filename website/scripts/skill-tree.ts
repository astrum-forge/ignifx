/**
 * Discovery of the pages served under `/skill/`.
 *
 * The URL mapping is the contract `website/public/llms.txt` publishes and `scripts/lib/llms-index.ts`
 * documents:
 *
 * | Repository path                            | URL                              |
 * | ------------------------------------------ | -------------------------------- |
 * | `skills/ignifx/SKILL.md`                   | `/skill/`                        |
 * | `skills/ignifx/references/gotchas.md`      | `/skill/references/gotchas`      |
 * | `skills/ignifx/references/<dir>/<name>.md` | `/skill/references/<dir>/<name>` |
 * | `packages/<pkg>/skills/<name>/SKILL.md`    | `/skill/<name>/`                 |
 *
 * The mapping is re-implemented here rather than imported from `scripts/`, so the site never
 * depends on workspace code that a fresh Cloudflare clone has not built. `buildSite` fails the
 * build when an `llms.txt` entry has no page, and `test/site.test.ts` asserts the same thing over
 * the emitted files, so the two implementations cannot drift apart silently.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/** Which group of the skill a page belongs to. Drives the rail, the prev/next pair, and search. */
export type SkillSection = "entry" | "extensions" | "concepts" | "recipes" | "formats" | "api";

/** One rendered skill page. */
export interface SkillPage {
  /** Site route, always absolute and always ending in `/` or a bare name. */
  readonly route: string;
  /** Absolute path to the Markdown file. */
  readonly file: string;
  /** Repository-relative path, used for the "view source" link and for link rewriting. */
  readonly repoPath: string;
  /** Group this page belongs to. */
  readonly section: SkillSection;
  /** Label shown in the rail and in search results. */
  readonly label: string;
}

/** The `references/` directories that become sections, in the order the site lists them. */
const REFERENCE_SECTIONS: readonly { readonly dir: string; readonly section: SkillSection }[] = [
  { dir: "concepts", section: "concepts" },
  { dir: "recipes", section: "recipes" },
  { dir: "formats", section: "formats" },
  { dir: "api", section: "api" },
];

/** Human labels for the sections, used as headings in the rail and on `/docs/`. */
export const SECTION_TITLES: Readonly<Record<SkillSection, string>> = {
  entry: "Entry skill",
  extensions: "Extensions",
  concepts: "Concepts",
  recipes: "Recipes",
  formats: "File formats",
  api: "API reference",
};

/**
 * Lists the `.md` files of one directory, `README.md` excluded, sorted by file name.
 *
 * @param directory - Absolute path.
 * @returns Absolute file paths.
 */
function markdownFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => path.join(directory, name));
}

/**
 * Reads the `ignifx.skill` manifest entry of one package.
 *
 * @param packageDirectory - Absolute path to the package.
 * @returns Absolute path to the declared `SKILL.md`, or `null`.
 */
function declaredSkill(packageDirectory: string): string | null {
  const manifestFile = path.join(packageDirectory, "package.json");
  if (!existsSync(manifestFile)) {
    return null;
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("ignifx" in parsed)) {
    return null;
  }
  const block: unknown = parsed.ignifx;
  if (typeof block !== "object" || block === null || !("skill" in block) || typeof block.skill !== "string") {
    return null;
  }
  const resolved = path.resolve(packageDirectory, block.skill);
  return existsSync(resolved) ? resolved : null;
}

/**
 * Finds every page the site serves under `/skill/`.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @returns The pages, in the order the rail lists them.
 */
export function findSkillPages(repositoryRoot: string): readonly SkillPage[] {
  const entryDirectory = path.join(repositoryRoot, "skills", "ignifx");
  const pages: SkillPage[] = [];

  /**
   * Appends one page.
   *
   * @param file - Absolute path to the Markdown file.
   * @param route - The site route.
   * @param section - The group it belongs to.
   * @param label - The rail label.
   */
  function add(file: string, route: string, section: SkillSection, label: string): void {
    pages.push({ route, file, repoPath: path.relative(repositoryRoot, file), section, label });
  }

  add(path.join(entryDirectory, "SKILL.md"), "/skill/", "entry", "ignifx");
  const gotchas = path.join(entryDirectory, "references", "gotchas.md");
  if (existsSync(gotchas)) {
    add(gotchas, "/skill/references/gotchas", "entry", "Gotchas");
  }

  const packagesDirectory = path.join(repositoryRoot, "packages");
  const extensions = readdirSync(packagesDirectory)
    .map((name) => declaredSkill(path.join(packagesDirectory, name)))
    .filter((file): file is string => file !== null)
    .map((file) => ({ file, name: path.basename(path.dirname(file)) }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  for (const { file, name } of extensions) {
    add(file, `/skill/${name}/`, "extensions", `@ignifx/${name}`);
  }

  for (const { dir, section } of REFERENCE_SECTIONS) {
    for (const file of markdownFiles(path.join(entryDirectory, "references", dir))) {
      const name = path.basename(file, ".md");
      add(file, `/skill/references/${dir}/${name}`, section, name);
    }
  }
  return pages;
}

/**
 * Reads the site URLs listed in `website/public/llms.txt`.
 *
 * @param llmsText - The generated file's contents.
 * @returns Every `/skill/…` URL it links to, in file order.
 */
export function llmsRoutes(llmsText: string): readonly string[] {
  const routes: string[] = [];
  const pattern = /^- \[[^\]]*\]\((?<url>\/[^)]*)\)/gmu;
  for (const match of llmsText.matchAll(pattern)) {
    const url = match.groups?.["url"];
    if (url !== undefined) {
      routes.push(url);
    }
  }
  return routes;
}
