/**
 * The `/skill/` pages: a section rail, the rendered Markdown, a contents rail, and a previous/next
 * pair across the whole skill.
 *
 * The rail and the pager are plain links and `<details>` disclosures, so the whole documentation
 * set is navigable with JavaScript disabled. The contents rail lists `###` headings only on pages
 * small enough for that to be a list rather than a wall: the generated API reference for
 * `@ignifx/core` alone carries thousands of headings.
 */
import { each, esc, h } from "./html.ts";
import { renderMarkdown, slugify } from "./markdown.ts";
import { BLOB_URL } from "./repo.ts";
import { SECTION_TITLES } from "./skill-tree.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { RenderedMarkdown } from "./markdown.ts";
import type { SkillPage, SkillSection } from "./skill-tree.ts";

/** Above this many headings, the contents rail lists `##` only. */
const DEEP_TOC_LIMIT = 60;

/**
 * Markdown files larger than this ship uncoloured code blocks. Only the generated API reference for
 * `@ignifx/core` and the `ignifx` umbrella are over it.
 */
export const LARGE_PAGE_BYTES = 250_000;

/** Shown at the top of a page above {@link LARGE_PAGE_BYTES}. */
const LARGE_PAGE_NOTE =
  "This is a generated API reference for a whole package barrel, and it is a large page — several " +
  "megabytes of HTML. Code blocks on it are not syntax-coloured and headings carry no permalink " +
  "anchor. The contents rail and the search dialog are the fast way in.";

/** Headings kept per page in the search index. */
const INDEX_HEADING_LIMIT = 30;

/** One entry of the client-side search index. */
export interface SearchEntry {
  /** The route to open. */
  readonly u: string;
  /** The page title. */
  readonly t: string;
  /** The section label. */
  readonly s: string;
  /** The lead sentence, trimmed. */
  readonly d: string;
  /** Heading text and slug pairs. */
  readonly h: readonly (readonly [string, string])[];
}

/** A skill page after rendering. */
export interface RenderedSkillPage {
  /** The route. */
  readonly route: string;
  /** The `<main>` contents. */
  readonly main: string;
  /** The `<title>`. */
  readonly title: string;
  /** The meta description. */
  readonly description: string;
  /** Its search-index entry. */
  readonly index: SearchEntry;
}

/**
 * Builds the URL a repository path is served at, or `null` when the site does not serve it.
 *
 * @param repoPath - Repository-relative path.
 * @param pages - Every skill page.
 * @returns The route, or `null`.
 */
function routeFor(repoPath: string, pages: readonly SkillPage[]): string | null {
  return pages.find((page) => page.repoPath === repoPath)?.route ?? null;
}

/**
 * Rewrites one Markdown link target found inside a skill file.
 *
 * @param href - The raw target.
 * @param fromRepoPath - Repository-relative path of the file the link is in.
 * @param pages - Every skill page.
 * @returns The URL to emit.
 */
export function resolveSkillLink(href: string, fromRepoPath: string, pages: readonly SkillPage[]): string {
  if (href === "" || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith("//")) {
    return href;
  }
  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (target === "") {
    return hash;
  }
  const base = fromRepoPath.split("/").slice(0, -1);
  const parts = target.split("/");
  const resolved: string[] = [...base];
  for (const part of parts) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  const repoPath = resolved.join("/");
  const route = routeFor(repoPath, pages);
  if (route !== null) {
    return `${route}${hash}`;
  }
  const prefix = repoPath.includes(".") ? BLOB_URL : BLOB_URL.replace("/blob/", "/tree/");
  return `${prefix}/${repoPath}${hash}`;
}

/**
 * Renders the section rail shared by every skill page.
 *
 * @param pages - Every skill page.
 * @param current - The page being rendered.
 * @returns The `<nav>` HTML.
 */
function rail(pages: readonly SkillPage[], current: SkillPage): string {
  const sections = new Map<SkillSection, SkillPage[]>();
  for (const page of pages) {
    const list = sections.get(page.section) ?? [];
    list.push(page);
    sections.set(page.section, list);
  }
  return h(
    "nav",
    { class: "rail", "aria-label": "Skill sections" },
    each([...sections.entries()], ([key, group]) =>
      h("details", { class: "rail-group", open: key === current.section }, [
        h("summary", { class: "rail-head" }, [
          esc(SECTION_TITLES[key]),
          h("span", { class: "rail-count" }, String(group.length)),
        ]),
        h(
          "ul",
          { class: "rail-list" },
          each(group, (page) =>
            h(
              "li",
              {},
              h(
                "a",
                {
                  href: page.route,
                  class: page.route === current.route ? "rail-link is-current" : "rail-link",
                  "aria-current": page.route === current.route ? "page" : null,
                },
                esc(page.label),
              ),
            ),
          ),
        ),
      ]),
    ),
  );
}

/**
 * Renders the per-page contents rail.
 *
 * @param rendered - The rendered Markdown, for its headings.
 * @returns The `<nav>` HTML, or an empty string when the page has no headings.
 */
function contents(rendered: RenderedMarkdown): string {
  if (rendered.toc.length === 0) {
    return "";
  }
  const deep = rendered.toc.length <= DEEP_TOC_LIMIT;
  const entries = rendered.toc.filter((entry) => deep || entry.depth === 2);
  if (entries.length === 0) {
    return "";
  }
  return h("nav", { class: "toc", "aria-labelledby": "toc-head" }, [
    h("h2", { class: "toc-head", id: "toc-head" }, "On this page"),
    h(
      "ul",
      { class: "toc-list" },
      each(entries, (entry) =>
        h(
          "li",
          { class: entry.depth === 3 ? "toc-item toc-deep" : "toc-item" },
          h("a", { href: `#${entry.id}` }, entry.html),
        ),
      ),
    ),
  ]);
}

/**
 * Renders the previous/next pair.
 *
 * @param pages - Every skill page, in rail order.
 * @param position - Index of the current page.
 * @returns The `<nav>` HTML.
 */
function pager(pages: readonly SkillPage[], position: number): string {
  return h("nav", { class: "pager", "aria-label": "Skill pages" }, [
    pagerSlot(pages[position - 1] ?? null, "Previous"),
    pagerSlot(pages[position + 1] ?? null, "Next"),
  ]);
}

/**
 * Renders one half of the previous/next pair.
 *
 * @param page - The page to link to, or `null` at either end of the skill.
 * @param direction - The label above the page name.
 * @returns The link, or an empty placeholder that keeps the grid two columns wide.
 */
function pagerSlot(page: SkillPage | null, direction: "Previous" | "Next"): string {
  if (page === null) {
    return h("span", { class: "pager-slot" }, "");
  }
  return h("a", { class: `pager-slot pager-${direction.toLowerCase()}`, href: page.route }, [
    h("span", { class: "pager-dir" }, direction),
    h("span", { class: "pager-label" }, esc(page.label)),
  ]);
}

/**
 * Extracts the lead sentence of a rendered page for its meta description and search entry.
 *
 * @param source - The Markdown source.
 * @returns One line of plain text, at most 200 characters.
 */
function leadSentence(source: string): string {
  const withoutFrontmatter = source.startsWith("---\n") ? source.slice(source.indexOf("\n---", 4) + 4) : source;
  for (const block of withoutFrontmatter.split("\n\n")) {
    const line = block.trim().replaceAll(/\s+/gu, " ");
    if (
      line === "" ||
      line.startsWith("#") ||
      line.startsWith("|") ||
      line.startsWith("```") ||
      line.startsWith("<!--")
    ) {
      continue;
    }
    const plain = line.replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, "$1").replaceAll("`", "");
    return plain.length > 200 ? `${plain.slice(0, plain.lastIndexOf(" ", 200))}…` : plain;
  }
  return "";
}

/**
 * Renders one skill page.
 *
 * @param page - The page to render.
 * @param pages - Every skill page, in rail order.
 * @param source - The Markdown file's text.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The rendered page and its search-index entry.
 */
export function renderSkillPage(
  page: SkillPage,
  pages: readonly SkillPage[],
  source: string,
  highlighter: CodeHighlighter,
): RenderedSkillPage {
  const large = source.length > LARGE_PAGE_BYTES;
  const rendered = renderMarkdown(highlighter, source, (href) => resolveSkillLink(href, page.repoPath, pages), large);
  const title = rendered.title ?? page.label;
  const description = leadSentence(source);
  const position = pages.findIndex((candidate) => candidate.route === page.route);

  const main = h("div", { class: "doc" }, [
    h("div", { class: "doc-rail" }, rail(pages, page)),
    h("article", { class: "doc-body" }, [
      h("header", { class: "doc-head" }, [
        h("p", { class: "eyebrow" }, [
          esc(SECTION_TITLES[page.section]),
          h("span", { class: "eyebrow-dot" }, "·"),
          h("a", { class: "doc-source", href: `${BLOB_URL}/${page.repoPath}`, rel: "noreferrer" }, esc(page.repoPath)),
        ]),
        h("h1", { class: "doc-title" }, esc(title)),
      ]),
      large ? h("p", { class: "callout doc-large" }, LARGE_PAGE_NOTE) : "",
      h("div", { class: "prose doc-prose" }, rendered.html),
      pager(pages, position),
    ]),
    h("div", { class: "doc-aside" }, contents(rendered)),
  ]);

  return {
    route: page.route,
    main,
    title,
    description: description === "" ? `${title} — the ignifx Agent Skill.` : description,
    index: {
      u: page.route,
      t: title,
      s: SECTION_TITLES[page.section],
      d: description.slice(0, 160),
      h: rendered.toc.slice(0, INDEX_HEADING_LIMIT).map((entry) => [stripTags(entry.html), entry.id] as const),
    },
  };
}

const TAG = /<[^>]*>/gu;

/**
 * Strips HTML tags from an inline fragment.
 *
 * @param html - The fragment.
 * @returns Its text.
 */
function stripTags(html: string): string {
  return html.replaceAll(TAG, "");
}

/** Re-exported for the tests, which check the slug rule against GitHub's. */
export { slugify };
