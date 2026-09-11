/**
 * `/docs/`, `/docs/getting-started/`, `/docs/guides/`, `/docs/guides/<name>/` and
 * `/docs/browser-support/` (`03-pages-and-copy.md` §5–§7, wireframes `02` §4.5–§4.7).
 *
 * The docs hub points visitors to setup, guides and reference material. A guide page is a recipe from
 * `skills/ignifx/references/recipes/`, rendered unchanged with its links rewritten — the site
 * serves no other skill page (`01-strategy-and-ia.md` §10).
 */
import { CATALOGUE } from "../examples/catalogue.ts";
import { blobUrl, site, treeUrl } from "../site.config.ts";
import { button, chip, dataTable, supportPill } from "./components.ts";
import { BROWSER_SUPPORT, TEMPLATE_CARDS } from "./copy.ts";
import { each, esc, h, join, md } from "./html.ts";
import { icon, markImg } from "./icons.ts";
import { renderMarkdown } from "./markdown.ts";
import { GUIDE_GROUPS, resolveGuideLink } from "./repo-content.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { Guide } from "./repo-content.ts";

/** One card on the docs hub. */
interface HubCard {
  /** The heading. */
  readonly title: string;
  /** One line. */
  readonly line: string;
  /** Destination. */
  readonly href: string;
  /** Whether the destination leaves the site. */
  readonly external: boolean;
}

/**
 * The six hub cards (`03` §5).
 *
 * @param guideCount - How many guides exist, so the card can say the number rather than claim one.
 * @returns The cards, in display order.
 */
function hubCards(guideCount: number): readonly HubCard[] {
  return [
    {
      title: "Getting started",
      line: "Create a project and run your first game.",
      href: "/docs/getting-started/",
      external: false,
    },
    {
      title: `Guides (${String(guideCount)})`,
      line: "Learn one task at a time with practical code examples.",
      href: "/docs/guides/",
      external: false,
    },
    {
      title: "API reference",
      line: "Look up components, methods and options for each package.",
      href: treeUrl("skills/ignifx/references/api"),
      external: true,
    },
    {
      title: "Templates",
      line: "Four playable starting points for your own game.",
      href: "/#templates",
      external: false,
    },
    {
      title: "Browser support",
      line: "What WebGPU is, where it runs, and how to check.",
      href: "/docs/browser-support/",
      external: false,
    },
    {
      title: "Contributing",
      line: "Set up the repository and contribute a change.",
      href: blobUrl("CONTRIBUTING.md"),
      external: true,
    },
  ];
}

/**
 * Renders the grouped guide list shared by the docs hub and the guides index.
 *
 * @param guides - Every guide.
 * @returns The HTML.
 */
function guideGroups(guides: readonly Guide[]): string {
  return each(GUIDE_GROUPS, (group) => {
    const rows = guides.filter((guide) => guide.group === group.title);
    if (rows.length === 0) {
      return "";
    }
    return h("div", { class: "guide-group" }, [
      h("h3", { class: "guide-group-title" }, esc(group.title)),
      h(
        "ul",
        { class: "guide-list" },
        each(rows, (guide) =>
          h("li", {}, [
            h("a", { class: "guide-link", href: guide.route }, esc(guide.title)),
            guide.line === "" ? "" : h("span", { class: "guide-line" }, esc(guide.line)),
          ]),
        ),
      ),
    ]);
  });
}

/**
 * Renders the docs hub.
 *
 * @param guides - Every guide.
 * @returns The `<main>` contents.
 */
export function docsPage(guides: readonly Guide[]): string {
  return join(
    h("section", { class: "page-head" }, [
      h("div", { class: "shell" }, [
        h("h1", {}, "Docs"),
        h("p", { class: "page-lead" }, "Create your first project, learn a new feature or look up an API."),
        h("div", { class: "page-actions" }, [
          button({ label: "Get started", variant: "primary", href: "/docs/getting-started/" }),
          button({ label: "View on GitHub", variant: "secondary", icon: "github", href: site.repo }),
        ]),
      ]),
    ]),
    h("section", { class: "band" }, [
      h("div", { class: "shell" }, [
        h(
          "ul",
          { class: "grid grid-three" },
          each(hubCards(guides.length), (card) =>
            h("li", { class: "card card-hub" }, [
              h(
                "a",
                { class: "card-title", href: card.href, rel: card.external ? "noreferrer" : null },
                join(esc(card.title), card.external ? icon("external", "icon-ext") : null),
              ),
              h("p", { class: "card-line" }, esc(card.line)),
            ]),
          ),
        ),
      ]),
    ]),
    h("section", { class: "band", id: "guides" }, [
      h("div", { class: "shell" }, [h("h2", { class: "band-title" }, "Guides"), guideGroups(guides)]),
    ]),
  );
}

/**
 * Renders the guides index.
 *
 * @param guides - Every guide.
 * @returns The `<main>` contents.
 */
export function guidesIndexPage(guides: readonly Guide[]): string {
  return join(
    h("section", { class: "page-head" }, [
      h("div", { class: "shell" }, [
        h("h1", {}, "Guides"),
        h(
          "p",
          { class: "page-lead" },
          esc(
            "Follow practical examples for common game tasks, from moving a character to loading a scene and saving progress.",
          ),
        ),
      ]),
    ]),
    h("section", { class: "band" }, [h("div", { class: "shell" }, guideGroups(guides))]),
  );
}

/**
 * Renders one guide page.
 *
 * @param guide - The guide.
 * @param guides - Every guide, for the previous/next pair.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents.
 */
export function guidePage(guide: Guide, guides: readonly Guide[], highlighter: CodeHighlighter): string {
  const rendered = renderMarkdown(highlighter, guide.source, resolveGuideLink);
  const index = guides.indexOf(guide);
  const previous = guides[index - 1];
  const next = guides[index + 1];
  const example = CATALOGUE.find((entry) => entry.guide === guide.name);

  return join(
    h("section", { class: "page-head page-head-tight" }, [
      h("div", { class: "shell" }, [
        h("a", { class: "back", href: "/docs/guides/" }, [icon("chevron", "icon-back"), "All guides"]),
        h("h1", {}, esc(rendered.title ?? guide.title)),
        h("p", { class: "guide-tags" }, [chip(guide.group)]),
        h("div", { class: "page-actions" }, [
          example === undefined
            ? ""
            : button({
                label: "Run this example",
                variant: "primary",
                icon: "play",
                href: `/examples/${example.slug}/`,
              }),
          button({ label: "Open on GitHub", variant: "secondary", icon: "github", href: guide.url }),
        ]),
      ]),
    ]),
    h("section", { class: "band" }, [h("div", { class: "shell" }, h("div", { class: "prose" }, rendered.html))]),
    h("section", { class: "band band-quiet" }, [
      h("div", { class: "shell" }, [
        h("nav", { class: "pager", "aria-label": "Guides" }, [
          previous === undefined
            ? h("span", {})
            : h("a", { class: "pager-prev", href: previous.route }, [
                icon("chevron", "icon-back"),
                h("span", {}, [h("span", { class: "pager-label" }, "Previous"), esc(previous.title)]),
              ]),
          next === undefined
            ? h("span", {})
            : h("a", { class: "pager-next", href: next.route }, [
                h("span", {}, [h("span", { class: "pager-label" }, "Next"), esc(next.title)]),
                icon("chevron", "icon-next"),
              ]),
        ]),
      ]),
    ]),
  );
}

/**
 * Renders one numbered step of the getting-started page.
 *
 * @param number - The step number.
 * @param title - The step heading.
 * @param body - The step body HTML.
 * @param id - Optional `id` for a deep link.
 * @returns The HTML.
 */
function step(number: number, title: string, body: string, id?: string): string {
  return h("section", { class: "step", id: id ?? null }, [
    h("h2", { class: "step-title" }, [h("span", { class: "step-number" }, String(number)), h("span", {}, esc(title))]),
    body,
  ]);
}

/**
 * Renders the getting-started page.
 *
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents.
 */
export function gettingStartedPage(highlighter: CodeHighlighter): string {
  const sh = (code: string): string => highlighter.render(code, "sh", { label: "shell" });

  const stepOne = site.published
    ? join(
        sh("npx @ignifx/cli@latest my-game"),
        h(
          "p",
          {},
          md("This creates a `2d-topdown` project. To start with a different template instead, use its name:"),
        ),
        sh("npx @ignifx/cli@latest my-game --template 3d-third-person"),
      )
    : join(
        h("p", {}, "ignifx is not on npm yet, so the first step is the repository:"),
        sh("git clone https://github.com/astrum-forge/ignifx.git\ncd ignifx\npnpm install\npnpm build"),
        h("p", {}, md("`pnpm build` compiles every package once; the templates import them from the workspace.")),
      );

  const picker = h(
    "ul",
    { class: "grid grid-four picker" },
    each(TEMPLATE_CARDS, (template) =>
      h("li", { class: "card card-picker" }, [
        h("h3", { class: "card-title" }, esc(template.title)),
        h("p", { class: "card-line" }, esc(template.line)),
        h("p", { class: "card-code" }, h("code", {}, esc(template.name))),
      ]),
    ),
  );

  const stepThree = site.published
    ? sh("cd my-game\nnpm install\nnpm run dev")
    : sh("pnpm --filter ignifx-template-3d-third-person dev");

  const stepFive = site.published
    ? h(
        "p",
        {},
        md(
          "Run `npm run build` to create the `dist/` folder. Upload its contents to a static web host or a browser-game platform such as itch.io.",
        ),
      )
    : join(
        h("p", {}, md("`pnpm --filter ignifx-template-3d-third-person build` writes a static `dist/`.")),
        h("p", {}, "Host it anywhere: Cloudflare Pages, Netlify, GitHub Pages, an S3 bucket, itch.io."),
      );

  return join(
    h("section", { class: "page-head" }, [
      h("div", { class: "shell" }, [
        h("h1", {}, "Getting started"),
        h(
          "p",
          { class: "page-lead" },
          esc(
            "Create a project, run a template and start changing the game. You’ll need Node 24, npm and a browser with WebGPU.",
          ),
        ),
        supportPill(),
      ]),
    ]),
    h("div", { class: "band band-steps" }, [
      h("div", { class: "shell shell-narrow" }, [
        step(
          1,
          "Choose a template",
          join(
            picker,
            h(
              "p",
              {},
              esc(
                "Each template includes a title screen, pause menu, audio and graphics settings, control rebinding and checkpoint saves. Use it as a starting point, then add your own gameplay and art.",
              ),
            ),
          ),
        ),
        step(2, "Create a project", stepOne),
        step(
          3,
          "Run it",
          join(
            stepThree,
            h(
              "p",
              {},
              md(
                "Open `http://localhost:5173`. Press backtick for the devtools overlay. Press Escape for the pause menu.",
              ),
            ),
          ),
        ),
        step(
          4,
          "Change something",
          h(
            "p",
            {},
            md(
              "Open `src/scripts/` and find a `Script`. Change a speed, save, and watch the game update without a reload. Every field you declare with `Script.define` shows up in the devtools inspector.",
            ),
          ),
        ),
        step(5, "Build", stepFive),
        h("section", { class: "step", id: "desktop" }, [
          h("h2", { class: "step-title" }, h("span", {}, "Desktop")),
          h(
            "p",
            {},
            md(
              "Add `--desktop` when creating your project to include an Electron desktop app. Use `npm run dev:desktop` during development and `npm run dist:desktop` to package it. The template configures the window and build tools for you.",
            ),
          ),
          site.published
            ? sh("npx @ignifx/cli@latest my-game --template 3d-first-person --desktop")
            : h(
                "p",
                {},
                md(
                  "Before the first release, run the desktop variant of a template from the workspace: `pnpm --filter ignifx-template-3d-first-person-desktop dev`.",
                ),
              ),
        ]),
        h("section", { class: "step" }, [
          h("h2", { class: "step-title" }, h("span", {}, "What next")),
          h("ul", { class: "ticks" }, [
            h("li", {}, [h("a", { href: "/docs/guides/" }, "Guides"), " — one task each."]),
            h("li", {}, [h("a", { href: "/examples/" }, "Examples"), " — see a feature running and read its source."]),
            h("li", {}, [
              h("a", { href: treeUrl("skills/ignifx/references/api"), rel: "noreferrer" }, "API reference"),
              icon("external", "icon-ext"),
              " — every export.",
            ]),
            h("li", {}, [
              "Something wrong? ",
              h("a", { href: `${site.repo}/issues`, rel: "noreferrer" }, "Open an issue"),
              icon("external", "icon-ext"),
              ".",
            ]),
          ]),
        ]),
      ]),
    ]),
  );
}

/**
 * Renders the browser-support page.
 *
 * @returns The `<main>` contents.
 */
export function browserSupportPage(): string {
  return join(
    h("section", { class: "page-head" }, [
      h("div", { class: "shell" }, [
        h("h1", {}, "Browser support"),
        h(
          "p",
          { class: "page-lead" },
          esc(
            "ignifx uses WebGPU to draw your game. Players need a browser and device that support it; there is no WebGL fallback.",
          ),
        ),
        supportPill(),
      ]),
    ]),
    h("div", { class: "band" }, [
      h("div", { class: "shell shell-narrow" }, [
        dataTable(
          ["Browser", "WebGPU since"],
          BROWSER_SUPPORT.map(([browser, since]) => [browser, since]),
          "WebGPU support by browser",
        ),
        h("h2", { class: "band-title" }, "If WebGPU is unavailable"),
        h(
          "p",
          {},
          md(
            "Update your browser and graphics drivers, then try again. Support depends on your operating system and GPU as well as the browser version. If WebGPU is still unavailable, ignifx templates show a message instead of starting the game.",
          ),
        ),
        h("h2", { class: "band-title" }, "Check from the command line"),
        h(
          "p",
          {},
          md(
            "Run `node scripts/check-webgpu.mjs` in your project to check whether the test browser can access a WebGPU adapter.",
          ),
        ),
      ]),
    ]),
  );
}

/**
 * Renders the 404 page (`03` §9, wireframe `02` §4.9).
 *
 * @returns The `<main>` contents.
 */
export function notFoundPage(): string {
  return h("section", { class: "page-head page-head-center" }, [
    h("div", { class: "shell shell-narrow" }, [
      markImg(128, "mark mark-lg"),
      h("h1", {}, "Page not found"),
      h("p", { class: "page-lead" }, "This address may have changed. Choose a page below to continue."),
      h("ul", { class: "notfound-links" }, [
        h("li", {}, h("a", { href: "/" }, "Home")),
        h("li", {}, h("a", { href: "/features/" }, "Features")),
        h("li", {}, h("a", { href: "/examples/" }, "Examples")),
        h("li", {}, h("a", { href: "/docs/" }, "Docs")),
      ]),
    ]),
  ]);
}
