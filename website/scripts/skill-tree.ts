/**
 * Discovery of the Agent Skill files, for two purposes only.
 *
 * The site no longer renders the skill: `/llms.txt` links straight at the repository and the old
 * `/skill/**` routes are `_redirects` lines (`01-strategy-and-ia.md` §10, decision 3 of
 * `08-execution.md` §2). What survives here is the route → repository-path mapping the redirects
 * are generated from, and the reader that lets the build assert that every URL `/llms.txt`
 * publishes is an absolute link to a file that exists in the working tree.
 *
 * | Repository path                            | Retired URL                      |
 * | ------------------------------------------ | -------------------------------- |
 * | `skills/ignifx/SKILL.md`                   | `/skill/`                        |
 * | `skills/ignifx/references/gotchas.md`      | `/skill/references/gotchas`      |
 * | `skills/ignifx/references/<dir>/<name>.md` | `/skill/references/<dir>/<name>` |
 * | `packages/<pkg>/skills/<name>/SKILL.md`    | `/skill/<name>/`                 |
 *
 * The mapping is re-implemented here rather than imported from the repository's `scripts/`, because
 * `scripts/lib/*` is type-checked as a Node tool project and the site is a browser bundle project;
 * `test/site.test.ts` asserts the emitted redirects against the tree, so the two cannot drift.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/** One skill file and the route that used to serve it. */
export interface SkillPage {
  /** The retired site route, which is now a redirect source. */
  readonly route: string;
  /** Absolute path to the Markdown file. */
  readonly file: string;
  /** Repository-relative path, with `/` separators. */
  readonly repoPath: string;
}

/** The `references/` directories, in the order the index lists them. */
const REFERENCE_DIRECTORIES: readonly string[] = ["concepts", "recipes", "formats", "api"];

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
 * Finds every Agent Skill file, with the route that used to serve it.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @returns The files, entry skill first, then the subsystem skills, then the reference pages.
 */
export function findSkillPages(repositoryRoot: string): readonly SkillPage[] {
  const entryDirectory = path.join(repositoryRoot, "skills", "ignifx");
  const pages: SkillPage[] = [];

  /**
   * Appends one page.
   *
   * @param file - Absolute path to the Markdown file.
   * @param route - The retired site route.
   */
  function add(file: string, route: string): void {
    pages.push({ route, file, repoPath: path.relative(repositoryRoot, file).split(path.sep).join("/") });
  }

  add(path.join(entryDirectory, "SKILL.md"), "/skill/");
  const gotchas = path.join(entryDirectory, "references", "gotchas.md");
  if (existsSync(gotchas)) {
    add(gotchas, "/skill/references/gotchas");
  }

  const packagesDirectory = path.join(repositoryRoot, "packages");
  const extensions = readdirSync(packagesDirectory)
    .map((name) => declaredSkill(path.join(packagesDirectory, name)))
    .filter((file): file is string => file !== null)
    .map((file) => ({ file, name: path.basename(path.dirname(file)) }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  for (const { file, name } of extensions) {
    add(file, `/skill/${name}/`);
  }

  for (const directory of REFERENCE_DIRECTORIES) {
    for (const file of markdownFiles(path.join(entryDirectory, "references", directory))) {
      add(file, `/skill/references/${directory}/${path.basename(file, ".md")}`);
    }
  }
  return pages;
}

/**
 * Reads the URLs listed in `website/public/llms.txt`.
 *
 * @param llmsText - The generated file's contents.
 * @returns Every linked URL, in file order.
 */
export function llmsUrls(llmsText: string): readonly string[] {
  const urls: string[] = [];
  const pattern = /^- \[[^\]]*\]\((?<url>[^)]*)\)/gmu;
  for (const match of llmsText.matchAll(pattern)) {
    const url = match.groups?.["url"];
    if (url !== undefined) {
      urls.push(url);
    }
  }
  return urls;
}

/**
 * Turns one `blob/main` URL back into the repository path it names.
 *
 * @param url - An absolute GitHub URL.
 * @param blobPrefix - The `blob/main` prefix, from `site.config.ts`.
 * @returns The repository-relative path, or `null` when the URL is not one of ours.
 */
export function repoPathOf(url: string, blobPrefix: string): string | null {
  const prefix = `${blobPrefix}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}
