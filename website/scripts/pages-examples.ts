/**
 * `/examples/`, `/examples/<slug>/` and `/examples/attribution/`
 * (`03-pages-and-copy.md` §4, wireframes `02` §4.3 and §4.4, `04-examples-platform.md` §3).
 *
 * The index shows posters only — no canvas runs on it. The viewer page is the one place a canvas
 * runs, and it runs inside an `<iframe>` of the example's own build, so this module holds no
 * per-example code at all.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CATALOGUE } from "../examples/catalogue.ts";
import { blobUrl } from "../site.config.ts";
import { button, chip, controlIcons, dataTable, supportPill } from "./components.ts";
import { categoryId, categorySections, poster, readSources } from "./examples.ts";
import { exampleFrame } from "./frame.ts";
import { each, esc, h, join } from "./html.ts";
import { icon } from "./icons.ts";
import { renderMarkdown } from "./markdown.ts";
import { exampleCard } from "./pages-home.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { ExampleEntry } from "../examples/catalogue.ts";

/** Repository path of the attribution document the examples agent maintains. */
export const ATTRIBUTION_FILE = "website/examples/assets/ATTRIBUTION.md";

/**
 * Renders the examples index.
 *
 * The chips are anchor links first — they work with JavaScript off — and `src/main.ts` upgrades
 * them to an in-place filter that keeps the hash in step.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The `<main>` contents.
 */
export function examplesIndexPage(websiteRoot: string): string {
  const sections = categorySections();
  const filters = h("div", { class: "filters", "data-filters": true }, [
    h("a", { class: "chip chip-filter is-active", href: "/examples/", "data-filter": "all" }, "All"),
    each(sections, (section) =>
      h(
        "a",
        {
          class: "chip chip-filter",
          href: `#${categoryId(section.category)}`,
          "data-filter": categoryId(section.category),
        },
        esc(section.category),
      ),
    ),
  ]);

  const head = h("section", { class: "page-head" }, [
    h("div", { class: "shell" }, [
      h("h1", {}, "Examples"),
      h(
        "p",
        { class: "page-lead" },
        esc(
          "Every example runs in your browser on this site's engine build, with its source beside it and the same file on GitHub one click away. Press backtick in any example for the devtools overlay.",
        ),
      ),
      supportPill(),
      filters,
    ]),
  ]);

  const grids = each(sections, (section) =>
    h(
      "section",
      { class: "gallery", id: categoryId(section.category), "data-category": categoryId(section.category) },
      [
        h("div", { class: "shell" }, [
          h("h2", { class: "gallery-title" }, esc(section.category)),
          h(
            "div",
            { class: "grid grid-four" },
            each(section.entries, (entry) => exampleCard(entry, websiteRoot)),
          ),
        ]),
      ],
    ),
  );

  const foot = h("section", { class: "band band-quiet" }, [
    h("div", { class: "shell" }, [
      h("p", {}, [
        "Sample models and environments are credited on the ",
        h("a", { href: "/examples/attribution/" }, "attribution page"),
        ".",
      ]),
    ]),
  ]);

  return join(head, grids, foot);
}

/**
 * The previous and next entries in catalogue order.
 *
 * @param entry - The current entry.
 * @returns Its neighbours, either of which may be `undefined` at the ends of the list.
 */
function neighbours(entry: ExampleEntry): {
  readonly previous: ExampleEntry | undefined;
  readonly next: ExampleEntry | undefined;
} {
  const index = CATALOGUE.indexOf(entry);
  return { previous: CATALOGUE[index - 1], next: CATALOGUE[index + 1] };
}

/**
 * Renders one example's viewer page.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param websiteRoot - Absolute path to `website/`.
 * @param entry - The catalogue entry.
 * @param highlighter - The shared Shiki highlighter.
 * @param guideRoute - `/docs/guides/<name>/` when a guide covers the same ground.
 * @returns The `<main>` contents.
 */
export function examplePage(
  repositoryRoot: string,
  websiteRoot: string,
  entry: ExampleEntry,
  highlighter: CodeHighlighter,
  guideRoute: string | null,
): string {
  const sources = readSources(repositoryRoot, entry);
  const first = sources[0];
  const { previous, next } = neighbours(entry);

  const head = h("section", { class: "page-head page-head-tight" }, [
    h("div", { class: "shell" }, [
      h("a", { class: "back", href: "/examples/" }, [icon("chevron", "icon-back"), "All examples"]),
      h("div", { class: "viewer-head" }, [
        h("h1", {}, esc(entry.title)),
        h("p", { class: "viewer-tags" }, [chip(entry.category), chip(entry.dimension), controlIcons(entry.controls)]),
      ]),
      h("p", { class: "page-lead" }, esc(entry.paragraph)),
    ]),
  ]);

  const stage = h("section", { class: "viewer" }, [
    h("div", { class: "shell" }, [
      exampleFrame({
        slug: entry.slug,
        title: entry.title,
        poster: poster(websiteRoot, entry.slug),
        posterAlt: entry.posterAlt,
        bridge: entry.template === undefined,
        eager: true,
      }),
      supportPill("viewer-pill"),
      h("div", { class: "tries" }, [
        h("h2", { class: "tries-title" }, "Try this"),
        h(
          "ul",
          { class: "ticks" },
          each(entry.tries, (line) => h("li", {}, esc(line))),
        ),
        guideRoute === null
          ? ""
          : h("p", {}, [
              h("a", { class: "band-more", href: guideRoute }, ["Read the guide", icon("chevron", "icon-next")]),
            ]),
      ]),
    ]),
  ]);

  const tabs =
    sources.length < 2
      ? ""
      : h(
          "div",
          { class: "source-tabs js-only", role: "tablist", "data-source-tabs": true, "aria-label": "Source files" },
          each(sources, (file, index) =>
            h(
              "button",
              {
                type: "button",
                role: "tab",
                class: index === 0 ? "source-tab is-active" : "source-tab",
                "data-source-tab": file.label,
                "aria-selected": index === 0 ? "true" : "false",
              },
              esc(file.label),
            ),
          ),
        );

  const files = each(sources, (file, index) =>
    h("div", { class: index === 0 ? "source-file is-active" : "source-file", "data-source-file": file.label }, [
      file.text === null
        ? h("p", { class: "source-missing" }, esc(`${file.label} is not in the tree yet.`))
        : highlighter.render(file.text, file.language, { label: file.label }),
    ]),
  );

  const source = h("section", { class: "source" }, [
    h("div", { class: "shell" }, [
      h("details", { class: "disclosure source-disclosure" }, [
        h("summary", { class: "disclosure-summary" }, [h("span", {}, "Show source"), icon("chevron", "icon-next")]),
        h("div", { class: "disclosure-body source-body" }, [
          h("div", { class: "source-head" }, [
            h("h2", {}, "Source"),
            h("div", { class: "source-actions" }, [
              first === undefined
                ? ""
                : button({ label: "View on GitHub", variant: "secondary", icon: "github", href: first.url }),
              h("button", { type: "button", class: "btn btn-secondary js-only", "data-source-copy": true }, [
                icon("copy"),
                h("span", { class: "btn-text" }, "Copy"),
              ]),
            ]),
          ]),
          tabs,
          h("div", { class: "source-files" }, files),
        ]),
      ]),
    ]),
  ]);

  const uses =
    entry.uses.length === 0
      ? ""
      : h("p", { class: "meta-row" }, [
          h("span", { class: "meta-label" }, "Uses:"),
          each(entry.uses, (name) => h("code", { class: "meta-code" }, esc(name))),
        ]);
  const assets =
    entry.assets.length === 0
      ? h("p", { class: "meta-row" }, [
          h("span", { class: "meta-label" }, "Assets:"),
          "everything in this example is created in code.",
        ])
      : h("p", { class: "meta-row" }, [
          h("span", { class: "meta-label" }, "Assets:"),
          each(entry.assets, (asset) =>
            h("span", { class: "meta-asset" }, [
              h("a", { href: asset.source, rel: "noreferrer" }, esc(asset.name)),
              esc(` — ${asset.licence}, ${asset.author}`),
            ]),
          ),
        ]);

  const foot = h("section", { class: "band band-quiet" }, [
    h("div", { class: "shell" }, [
      uses,
      assets,
      h("nav", { class: "pager", "aria-label": "Examples" }, [
        previous === undefined
          ? h("span", {})
          : h("a", { class: "pager-prev", href: `/examples/${previous.slug}/` }, [
              icon("chevron", "icon-back"),
              h("span", {}, [h("span", { class: "pager-label" }, "Previous"), esc(previous.title)]),
            ]),
        next === undefined
          ? h("span", {})
          : h("a", { class: "pager-next", href: `/examples/${next.slug}/` }, [
              h("span", {}, [h("span", { class: "pager-label" }, "Next"), esc(next.title)]),
              icon("chevron", "icon-next"),
            ]),
      ]),
    ]),
  ]);

  return join(head, stage, source, foot);
}

/**
 * Renders the attribution page.
 *
 * The table at the top is built from the catalogue, so it says which example uses what; the prose
 * under it is `ATTRIBUTION.md` itself, rendered unchanged, because that file is where the digests
 * and the upstream copyright lines live (`CONSTITUTION.md` §11.3).
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents and whether the document was found.
 */
export function attributionPage(
  repositoryRoot: string,
  highlighter: CodeHighlighter,
): { readonly html: string; readonly found: boolean } {
  const file = path.join(repositoryRoot, ATTRIBUTION_FILE);
  const rows: string[][] = [];
  for (const entry of CATALOGUE) {
    for (const asset of entry.assets) {
      rows.push([
        `\`${asset.name}\``,
        `[${entry.title}](/examples/${entry.slug}/)`,
        asset.author,
        asset.licence,
        `[Source](${asset.source})`,
      ]);
    }
  }

  const found = existsSync(file);
  const body = found
    ? h(
        "div",
        { class: "prose" },
        renderMarkdown(highlighter, readFileSync(file, "utf8"), (href) =>
          href.startsWith("http") || href.startsWith("#") ? href : blobUrl(`website/examples/assets/${href}`),
        ).html,
      )
    : h(
        "div",
        { class: "callout callout-caution" },
        h(
          "p",
          {},
          esc(
            `${ATTRIBUTION_FILE} is not in the tree yet, so this page lists only what the catalogue records. The production build fails until the file exists.`,
          ),
        ),
      );

  const html = join(
    h("section", { class: "page-head" }, [
      h("div", { class: "shell" }, [
        h("h1", {}, "Credits"),
        h(
          "p",
          { class: "page-lead" },
          esc(
            "The examples use sample assets published under open licences. Each one is listed here with its author, licence and source. ignifx itself, the example code, and every capture on this site are Apache-2.0.",
          ),
        ),
      ]),
    ]),
    h("section", { class: "band" }, [
      h("div", { class: "shell" }, [
        rows.length === 0
          ? h("p", {}, "No example loads a sample asset yet: everything in the catalogue is created in code.")
          : dataTable(["Asset", "Used by", "Author", "Licence", "Source"], rows, "Sample assets"),
        body,
      ]),
    ]),
  );
  return { html, found };
}
