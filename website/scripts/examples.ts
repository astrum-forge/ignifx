/**
 * Everything the site needs to read out of `examples/catalogue.ts`: the category sections, the
 * committed posters, the source files a viewer page shows, and the link resolution that lets copy
 * name an example that has not been built yet.
 *
 * The catalogue's types are fixed (`08-execution.md` §5): this module reads them and never changes
 * them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CATALOGUE, CATEGORIES, findExample } from "../examples/catalogue.ts";
import { blobUrl } from "../site.config.ts";
import type { ExampleCategory, ExampleEntry } from "../examples/catalogue.ts";

/** The three formats every poster is committed in, best first (`08-execution.md` §2). */
export const POSTER_FORMATS = ["avif", "webp", "png"] as const;

/** Directories under `website/examples/` that are not examples. */
export const NON_EXAMPLE_DIRECTORIES: ReadonlySet<string> = new Set(["_kit", "_tools", "assets", "entries"]);

/** One poster, resolved against `website/public/`. */
export interface Poster {
  /** `/examples/<slug>.avif` and friends, best format first. */
  readonly sources: readonly { readonly url: string; readonly type: string }[];
  /** The `<img>` fallback, always the PNG. */
  readonly fallback: string;
  /** Whether every format was found on disk. */
  readonly complete: boolean;
}

/**
 * Turns a category name into the `id` of its section on `/examples/`.
 *
 * @param category - One of `CATEGORIES`.
 * @returns A lowercase, hyphenated id, e.g. `post-processing`.
 */
export function categoryId(category: ExampleCategory): string {
  return category.toLowerCase().replaceAll(/[^a-z\d]+/gu, "-");
}

/**
 * The catalogue grouped into the sections `/examples/` renders, empty categories dropped.
 *
 * @returns Category and entries, in `CATEGORIES` order.
 */
export function categorySections(): readonly {
  readonly category: ExampleCategory;
  readonly entries: readonly ExampleEntry[];
}[] {
  return CATEGORIES.map((category) => ({
    category,
    entries: CATALOGUE.filter((entry) => entry.category === category),
  })).filter((section) => section.entries.length > 0);
}

/**
 * Where a "See it" link points.
 *
 * The copy in `03-pages-and-copy.md` names every example the catalogue will eventually hold, and
 * the catalogue grows one wave at a time. Rather than let a feature card 404, an unbuilt slug falls
 * back to its category section on `/examples/`, and — when that category has no examples yet
 * either — to the gallery itself.
 *
 * @param target - A catalogue slug, or a site route when the copy points at a page (`/docs/…`).
 * @param fallbackCategory - The category section to fall back to.
 * @returns A site route that always resolves.
 */
export function exampleHref(target: string, fallbackCategory: ExampleCategory): string {
  if (target.startsWith("/")) {
    return target;
  }
  if (findExample(target) !== undefined) {
    return `/examples/${target}/`;
  }
  const hasSection = CATALOGUE.some((entry) => entry.category === fallbackCategory);
  return hasSection ? `/examples/#${categoryId(fallbackCategory)}` : "/examples/";
}

/**
 * Resolves an example's poster.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @param slug - The example's slug.
 * @returns The `<picture>` sources and whether all three formats exist.
 */
export function poster(websiteRoot: string, slug: string): Poster {
  const directory = path.join(websiteRoot, "public", "examples");
  const found = POSTER_FORMATS.filter((format) => existsSync(path.join(directory, `${slug}.${format}`)));
  return {
    sources: found
      .filter((format) => format !== "png")
      .map((format) => ({ url: `/examples/${slug}.${format}`, type: `image/${format}` })),
    fallback: `/examples/${slug}.png`,
    complete: found.length === POSTER_FORMATS.length,
  };
}

/** One source file, ready for the viewer's tab strip. */
export interface SourceFile {
  /** The tab label: the path as `sourceFiles` writes it. */
  readonly label: string;
  /** The file's text, or `null` when it is missing. */
  readonly text: string | null;
  /** The fence info string Shiki should highlight it as. */
  readonly language: string;
  /** The `blob/main` URL of the same file. */
  readonly url: string;
}

/**
 * The directory an entry's sources and its run page are built from.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param entry - The catalogue entry.
 * @returns An absolute path, plus the repository-relative prefix its files are linked under.
 */
export function sourceRoot(
  repositoryRoot: string,
  entry: ExampleEntry,
): { readonly absolute: string; readonly repoPrefix: string } {
  if (entry.template !== undefined) {
    return {
      absolute: path.join(repositoryRoot, "templates", entry.template),
      repoPrefix: `templates/${entry.template}`,
    };
  }
  return {
    absolute: path.join(repositoryRoot, "website", "examples", entry.slug),
    repoPrefix: `website/examples/${entry.slug}`,
  };
}

/**
 * Maps a file extension onto a Shiki fence info string.
 *
 * @param file - The file name.
 * @returns The language name, or an empty string for plain text.
 */
function languageOf(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".ts") {
    return "ts";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "js";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".html") {
    return "html";
  }
  return "";
}

/**
 * Reads every source file a viewer page shows.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param entry - The catalogue entry.
 * @returns One record per `sourceFiles` entry, in order.
 */
export function readSources(repositoryRoot: string, entry: ExampleEntry): readonly SourceFile[] {
  const { absolute, repoPrefix } = sourceRoot(repositoryRoot, entry);
  return entry.sourceFiles.map((file) => {
    const full = path.join(absolute, file);
    return {
      label: file,
      text: existsSync(full) ? readFileSync(full, "utf8") : null,
      language: languageOf(file),
      url: blobUrl(`${repoPrefix}/${file}`),
    };
  });
}

/** One problem found while checking the catalogue against the tree. */
export interface CatalogueProblem {
  /** The slug it concerns. */
  readonly slug: string;
  /** What is wrong, as a sentence an engineer can act on. */
  readonly message: string;
}

/**
 * Checks the catalogue against the tree: a directory, a first source file and three posters per
 * entry, and no example directory without an entry (`06-engineering.md` §3).
 *
 * The caller decides what a problem means: the production build fails, a development build warns,
 * so the site can be worked on before the examples agent has captured its posters.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param websiteRoot - Absolute path to `website/`.
 * @returns Every problem found, in catalogue order.
 */
export function checkCatalogue(repositoryRoot: string, websiteRoot: string): readonly CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  for (const entry of CATALOGUE) {
    const { absolute, repoPrefix } = sourceRoot(repositoryRoot, entry);
    if (!existsSync(absolute)) {
      problems.push({ slug: entry.slug, message: `no directory at ${repoPrefix}/` });
      continue;
    }
    const first = entry.sourceFiles[0];
    if (first === undefined || !existsSync(path.join(absolute, first))) {
      problems.push({ slug: entry.slug, message: `no first source file at ${repoPrefix}/${first ?? "<none listed>"}` });
    }
    const missing = POSTER_FORMATS.filter(
      (format) => !existsSync(path.join(websiteRoot, "public", "examples", `${entry.slug}.${format}`)),
    );
    if (missing.length > 0) {
      problems.push({
        slug: entry.slug,
        message: `no poster at website/public/examples/${entry.slug}.{${missing.join(",")}}`,
      });
    }
  }
  return problems;
}

/**
 * Lists the example directories on disk, `_kit`, `_tools`, `assets` and loose files excluded.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns Directory names, sorted.
 */
export function exampleDirectories(websiteRoot: string): readonly string[] {
  const root = path.join(websiteRoot, "examples");
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((name) => !NON_EXAMPLE_DIRECTORIES.has(name))
    .filter((name) => statSync(path.join(root, name)).isDirectory())
    .toSorted((left, right) => left.localeCompare(right));
}
