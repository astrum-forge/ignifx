/**
 * Markdown → HTML for the `/skill/` pages.
 *
 * The skill is the documentation (`docs/architecture/16-docs-harness-and-skill.md`); this module
 * renders it without changing a word. What it adds is navigation: stable heading ids, a table of
 * contents, links between skill files rewritten to site routes, links out of the skill rewritten to
 * `blob/main` on GitHub, scroll containers around tables, and a copy button on every code block.
 *
 * Raw HTML in the source is escaped rather than passed through, except for a short allow-list of
 * inline tags the repository actually uses. Skill prose contains things like `<Pointer>/position`,
 * and a Markdown parser is entitled to read that as a tag.
 */
import { Marked } from "marked";
import { each, esc, h, join } from "./html.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { Tokens } from "marked";

/** Inline tags allowed through verbatim; everything else is escaped. */
const ALLOWED_HTML = /^<\/?(?:kbd|br|sub|sup|em|strong|code)(?:\s[^<>]*)?\/?>$/iu;

const NON_SLUG = /[^\p{L}\p{N}\s-]/gu;
const SPACES = /\s+/gu;

/** One entry in a page's table of contents. */
export interface TocEntry {
  /** Heading depth, 2 or 3. */
  readonly depth: number;
  /** The heading's text, already escaped for HTML. */
  readonly html: string;
  /** The heading's `id`. */
  readonly id: string;
}

/** The result of rendering one Markdown file. */
export interface RenderedMarkdown {
  /** The page body, without its `#` title. */
  readonly html: string;
  /** The `#` title, as plain text, or `null` when the file has none. */
  readonly title: string | null;
  /** The `##`/`###` headings, in document order. */
  readonly toc: readonly TocEntry[];
}

/** How a link target found in the Markdown is turned into a URL. */
export interface LinkResolver {
  /**
   * Resolves one link target.
   *
   * @param href - The raw `href` from the Markdown.
   * @returns The URL to emit.
   */
  (href: string): string;
}

/**
 * Turns heading text into a GitHub-compatible anchor slug, so anchors written inside the skill
 * (`SKILL.md#adding-extensions`) keep working once the file is served here.
 *
 * @param text - The heading's plain text.
 * @returns The slug.
 */
export function slugify(text: string): string {
  return text.toLowerCase().trim().replaceAll(NON_SLUG, "").replaceAll(SPACES, "-");
}

/**
 * Strips a leading YAML frontmatter block.
 *
 * @param source - The file's full text.
 * @returns The text after the frontmatter, or the input unchanged.
 */
export function stripFrontmatter(source: string): string {
  if (!source.startsWith("---\n")) {
    return source;
  }
  const end = source.indexOf("\n---", 4);
  return end === -1 ? source : source.slice(end + 4).replace(/^(?:\r?\n)+/u, "");
}

/**
 * Renders one Markdown document.
 *
 * @param highlighter - The shared Shiki highlighter.
 * @param source - The file's full text, frontmatter included.
 * @param resolveLink - Rewrites every link target found in the document.
 * @param compact - Drops per-heading permalink anchors and token colouring. Set for the generated
 *   API reference pages, where the same heading text would otherwise be written three times across
 *   thousands of headings.
 * @returns The body HTML, the title, and the table of contents.
 */
export function renderMarkdown(
  highlighter: CodeHighlighter,
  source: string,
  resolveLink: LinkResolver,
  compact = false,
): RenderedMarkdown {
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();
  let title: string | null = null;

  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      code({ text, lang }: Tokens.Code): string {
        return highlighter.render(text, lang ?? "", !compact);
      },
      heading(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Heading): string {
        const inline = this.parser.parseInline(token.tokens);
        if (token.depth === 1) {
          title ??= token.text;
          return "";
        }
        const base = slugify(token.text);
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${String(seen)}`;
        if (token.depth === 2 || token.depth === 3) {
          toc.push({ depth: token.depth, html: inline, id });
        }
        if (compact) {
          return h(`h${String(token.depth)}`, { id, class: "doc-heading" }, inline);
        }
        const anchor = h(
          "a",
          { class: "heading-anchor", href: `#${id}`, "aria-label": `Permalink to ${token.text}` },
          "#",
        );
        return h(`h${String(token.depth)}`, { id, class: "doc-heading" }, join(inline, anchor));
      },
      link(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Link): string {
        const href = resolveLink(token.href);
        const external = href.startsWith("http");
        return h(
          "a",
          {
            href,
            title: token.title ?? null,
            rel: external ? "noreferrer" : null,
          },
          this.parser.parseInline(token.tokens),
        );
      },
      table(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Table): string {
        const parser = this.parser;
        const row = (cells: readonly Tokens.TableCell[], tag: string): string =>
          h(
            "tr",
            {},
            each(cells, (cell, index) =>
              h(
                tag,
                { align: token.align[index] ?? null, scope: tag === "th" ? "col" : null },
                parser.parseInline(cell.tokens),
              ),
            ),
          );
        const table = h("table", {}, [
          h("thead", {}, row(token.header, "th")),
          h(
            "tbody",
            {},
            each(token.rows, (cells) => row(cells, "td")),
          ),
        ]);
        return h("div", { class: "scroller", role: "region", tabindex: "0", "aria-label": "Table" }, table);
      },
      html({ text }: Tokens.HTML | Tokens.Tag): string {
        return ALLOWED_HTML.test(text.trim()) ? text : esc(text);
      },
    },
  });

  const html = marked.parse(stripFrontmatter(source), { async: false });
  return { html, title, toc };
}
