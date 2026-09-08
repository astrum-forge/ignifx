/**
 * `/features/` — the complete capability list (`03-pages-and-copy.md` §3, wireframe `02` §4.2).
 *
 * Fifteen sections in the plan's order, each with its package chip, one paragraph, a two-column
 * capability list and a row of "See it" chips. The jump bar is a `<details>` so it works without
 * JavaScript; above 1040 px CSS lays it out as a sticky row (`src/styles/pages.css`).
 */
import { button, chip } from "./components.ts";
import { FEATURE_SECTIONS } from "./copy-features.ts";
import { exampleHref } from "./examples.ts";
import { each, esc, h, join, md } from "./html.ts";
import { icon } from "./icons.ts";

/**
 * Renders the features page body.
 *
 * @returns The `<main>` contents.
 */
export function featuresPage(): string {
  const head = h("section", { class: "page-head" }, [
    h("div", { class: "shell" }, [
      h("h1", {}, "Features"),
      h(
        "p",
        { class: "page-lead" },
        esc(
          "Everything in the box, grouped the way you will use it. Each section links to an example that runs in your browser.",
        ),
      ),
      h("div", { class: "page-actions" }, [
        button({ label: "Get started", variant: "primary", href: "/docs/getting-started/" }),
        button({ label: "Read the guides", variant: "secondary", href: "/docs/guides/" }),
      ]),
    ]),
  ]);

  const jump = h("div", { class: "jump" }, [
    h("div", { class: "shell" }, [
      h("details", { class: "jump-disclosure" }, [
        h("summary", { class: "jump-summary" }, [h("span", {}, "Jump to a section"), icon("chevron", "icon-next")]),
        h(
          "nav",
          { class: "jump-nav", "aria-label": "Sections" },
          h(
            "ul",
            { class: "jump-list" },
            each(FEATURE_SECTIONS, (section) =>
              h("li", {}, h("a", { class: "jump-link", href: `#${section.id}` }, esc(section.title))),
            ),
          ),
        ),
      ]),
    ]),
  ]);

  const sections = each(FEATURE_SECTIONS, (section) =>
    h("section", { class: "feature", id: section.id }, [
      h("div", { class: "shell" }, [
        h("div", { class: "feature-head" }, [
          h("h2", {}, esc(section.title)),
          section.packages === "" ? "" : chip(`\`${section.packages}\``, "chip-pkg"),
        ]),
        section.body === "" ? "" : h("p", { class: "feature-body" }, md(section.body)),
        section.bullets.length === 0
          ? ""
          : h(
              "ul",
              { class: "feature-list" },
              each(section.bullets, (bullet) => h("li", {}, md(bullet))),
            ),
        section.chips.length === 0
          ? ""
          : h("p", { class: "feature-chips" }, [
              h("span", { class: "feature-chips-label" }, "See it:"),
              each(section.chips, (item) =>
                h("a", { class: "chip chip-link", href: exampleHref(item.target, item.fallback) }, esc(item.label)),
              ),
            ]),
      ]),
    ]),
  );

  return join(head, jump, sections);
}
