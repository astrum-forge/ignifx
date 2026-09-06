/**
 * `/getting-started/` and `/docs/`.
 *
 * The getting-started page is deliberately honest about the state of the project: the packages are
 * unpublished, so the working path is a clone and the `create-ignifx` flow is shown as what it will
 * be. The docs page indexes the repository's own documents by reading their `#` titles, so a new
 * architecture note or ADR appears here without anyone remembering to add it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { each, esc, h, join } from "./html.ts";
import { md, outbound, section } from "./pieces.ts";
import { BLOB_URL, REPOSITORY_URL } from "./repo.ts";
import { SECTION_TITLES } from "./skill-tree.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { RepositoryFacts } from "./repo.ts";
import type { SkillPage, SkillSection } from "./skill-tree.ts";

/**
 * Renders `/getting-started/`.
 *
 * @param facts - The repository facts.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents.
 */
export function gettingStartedPage(facts: RepositoryFacts, highlighter: CodeHighlighter): string {
  const clone = [
    `git clone ${REPOSITORY_URL}.git`,
    "cd ignifx",
    "nvm use          # Node 24, from .nvmrc",
    "pnpm install",
    "pnpm build       # required: a template imports @ignifx/* from the workspace",
    "",
    "# One template in a dev server on http://localhost:5173",
    "pnpm --filter ignifx-template-2d-topdown dev",
  ].join("\n");

  const future = [
    "# Not possible yet: no @ignifx package is published.",
    "npx @ignifx/cli my-game --template 2d-topdown",
    "npx @ignifx/cli my-game --template 3d-third-person --desktop",
    "",
    "cd my-game && pnpm install && pnpm dev",
  ].join("\n");

  const templates = h(
    "div",
    { class: "scroller", role: "region", tabindex: "0", "aria-label": "Templates" },
    h("table", { class: "data" }, [
      h(
        "thead",
        {},
        h("tr", {}, [
          h("th", { scope: "col" }, "Template"),
          h("th", { scope: "col" }, "What it is"),
          h("th", { scope: "col" }, "Dev command"),
        ]),
      ),
      h(
        "tbody",
        {},
        each(
          facts.showcases.filter((showcase) => showcase.group === "templates"),
          (showcase) =>
            h("tr", {}, [
              h("th", { scope: "row" }, h("code", {}, esc(showcase.name))),
              h("td", {}, md(showcase.blurb)),
              h("td", {}, h("code", {}, esc(`pnpm --filter ignifx-template-${showcase.name} dev`))),
            ]),
        ),
      ),
    ]),
  );

  return join(
    h("div", { class: "page-head" }, [
      h("p", { class: "eyebrow" }, "Getting started"),
      h("h1", { class: "page-title" }, "There is no install command yet. There is a clone."),
      h("p", { class: "page-lead" }, [
        "ignifx is ",
        h("code", {}, facts.version),
        " and unpublished, so the honest path today is the repository itself: four playable templates and two ",
        "examples, two commands from a clone (",
        h("code", {}, "pnpm install"),
        " then ",
        h("code", {}, "pnpm build"),
        "). The scaffolder below is real code — it simply has nothing to install from until 0.1 ships.",
      ]),
    ]),
    section({
      id: "browser",
      gutter: "IGX-0701",
      title: "Check your browser first",
      lead:
        "There is no WebGL fallback, by decision (ADR-0001). Without WebGPU, `createApp` rejects with `IGX-0701` " +
        "and a template shows the fallback panel in its `index.html`.",
      body: join(
        h("p", { class: "callout" }, md(facts.browserSupport)),
        h("p", { class: "prose" }, [
          "The skill ships a probe you can run in a page: ",
          h("code", {}, "node scripts/check-webgpu.mjs"),
          " under ",
          outbound(`${BLOB_URL}/skills/ignifx/scripts/check-webgpu.mjs`, "`skills/ignifx/scripts/`"),
          ". On Linux and on older integrated GPUs, expect to enable WebGPU explicitly; the engine reports what the ",
          "adapter said through ",
          h("code", {}, "app.platform.webgpu"),
          ".",
        ]),
      ),
    }),
    section({
      id: "clone",
      gutter: "Node 24 · pnpm 11",
      title: "The path that works today",
      lead:
        "Node 24 comes from `.nvmrc`; pnpm 11.17.0 comes from `packageManager`, so `corepack` or a matching pnpm is " +
        "all the setup there is. `pnpm build` is **not** optional in a fresh clone: the templates depend on " +
        "`@ignifx/vite-plugin` through `workspace:*`, and Vite cannot load a template's `vite.config.ts` until that " +
        "package has a `dist/`.",
      body: join(
        highlighter.render(clone, "bash"),
        templates,
        h("p", { class: "callout" }, [
          "Verified on 2026-09-06 by running exactly these commands in a throw-away clone: ",
          h("code", {}, "pnpm install --frozen-lockfile"),
          " took 5 s against a warm store, ",
          h("code", {}, "pnpm build"),
          " built 21 workspace tasks in 12.6 s, and the dev server answered ",
          h("code", {}, "http://localhost:5173/"),
          " with 200 after 178 ms. Skipping ",
          h("code", {}, "pnpm build"),
          " fails with ",
          h("code", {}, 'Failed to resolve entry for package "@ignifx/vite-plugin"'),
          ".",
        ]),
        h("p", { class: "prose" }, [
          "Add ",
          h("code", {}, "pnpm --filter ignifx-template-2d-topdown build"),
          " for a production bundle, and ",
          h("code", {}, "dev:desktop"),
          " / ",
          h("code", {}, "build:desktop"),
          " / ",
          h("code", {}, "dist:desktop"),
          " for the Electron variant of any template. ",
          h("code", {}, "pnpm dev"),
          " from the root runs every package's dev task at once.",
        ]),
      ),
    }),
    section({
      id: "scaffold",
      gutter: "when 0.1 ships",
      title: "The scaffolder, for later",
      lead:
        "`create-ignifx` copies a template into a new directory and rewrites its workspace dependency ranges. It is " +
        "written, tested and documented — it just cannot resolve `@ignifx/cli` from a registry yet.",
      body: join(
        highlighter.render(future, "bash"),
        h("p", { class: "prose" }, [
          h("code", {}, "--desktop"),
          " also copies the template's Electron variant; without it the scaffold is browser-only and the Electron ",
          "dependencies are stripped, so a browser game never downloads a runtime it does not run. ",
          outbound(`${BLOB_URL}/packages/cli/README.md`, "The CLI's README"),
          " has the full flag list.",
        ]),
      ),
    }),
    section({
      id: "hardware",
      gutter: "notes",
      title: "What to expect from the machine",
      body: h("ul", { class: "prose-list" }, [
        h(
          "li",
          {},
          md(
            "**Headless is real.** `createApp({ headless: true })` plus `app.step(dt)` runs the whole engine on " +
              "Node 24 with no GPU, which is how the test suites drive it.",
          ),
        ),
        h(
          "li",
          {},
          md(
            "**A 2D template ships a physics engine.** Rapier inlines its WebAssembly as base64, which is most of " +
              "the 2D templates' entry chunk; the 3D templates are a third of the size because Havok's `.wasm` is " +
              "copied as a file instead.",
          ),
        ),
        h(
          "li",
          {},
          md(
            "**Electron needs a flag.** `--enable-unsafe-webgpu` is set for you by `@ignifx/electron`; packaging " +
              "for macOS, Windows or Linux still needs that operating system or a CI runner for it.",
          ),
        ),
        h(
          "li",
          {},
          md(
            '**Audio starts locked.** In a browser `app.audio.state` is `"locked"` until a user gesture; plays ' +
              "made before then are queued, not lost.",
          ),
        ),
      ]),
    }),
  );
}

/**
 * Reads a directory of Markdown documents and their `#` titles.
 *
 * @param root - Absolute path to the repository root.
 * @param relative - Repository-relative directory.
 * @returns File name and title pairs, sorted by file name.
 */
function documentTitles(root: string, relative: string): readonly { readonly file: string; readonly title: string }[] {
  const directory = path.join(root, relative);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => {
      const source = readFileSync(path.join(directory, name), "utf8");
      const title = /^#\s+(?<title>.+)$/mu.exec(source)?.groups?.["title"] ?? name;
      return { file: `${relative}/${name}`, title };
    });
}

/**
 * Renders a list of repository documents as `path — title` rows linking to GitHub.
 *
 * @param relative - The directory the files live in, stripped from the visible label.
 * @param entries - File paths and their `#` titles.
 * @returns The `<ul>` HTML.
 */
function linkTable(relative: string, entries: readonly { readonly file: string; readonly title: string }[]): string {
  return h(
    "ul",
    { class: "doc-list" },
    each(entries, (entry) =>
      h("li", {}, [
        outbound(`${BLOB_URL}/${entry.file}`, `\`${entry.file.slice(relative.length + 1)}\``),
        h("span", { class: "doc-note" }, esc(entry.title)),
      ]),
    ),
  );
}

/**
 * Renders `/docs/`.
 *
 * @param root - Absolute path to the repository root.
 * @param pages - The skill pages, for the per-section counts.
 * @returns The `<main>` contents.
 */
export function docsPage(root: string, pages: readonly SkillPage[]): string {
  const bySection = new Map<SkillSection, SkillPage[]>();
  for (const page of pages) {
    const list = bySection.get(page.section) ?? [];
    list.push(page);
    bySection.set(page.section, list);
  }

  const skillGroups = h(
    "ul",
    { class: "grid grid-cards" },
    each([...bySection.entries()], ([sectionKey, sectionPages]) => {
      const first = sectionPages[0];
      const title = SECTION_TITLES[sectionKey];
      return h("li", { class: "card" }, [
        h("p", { class: "card-pkg" }, `${String(sectionPages.length)} page${sectionPages.length === 1 ? "" : "s"}`),
        h("h3", { class: "card-title" }, h("a", { href: first?.route ?? "/skill/" }, esc(title))),
        h(
          "ul",
          { class: "card-links" },
          each(sectionPages.slice(0, 6), (page) => h("li", {}, h("a", { href: page.route }, esc(page.label)))),
        ),
      ]);
    }),
  );

  return join(
    h("div", { class: "page-head" }, [
      h("p", { class: "eyebrow" }, "Docs"),
      h("h1", { class: "page-title" }, "The documentation is the skill"),
      h("p", { class: "page-lead" }, [
        "ignifx does not keep a separate manual. The Agent Skill that ships with the engine is the documentation, ",
        "and this site renders it — the same files, at stable URLs, indexed for agents at ",
        h("a", { href: "/llms.txt" }, "/llms.txt"),
        ". Everything below that is not a skill page is a design document in the repository.",
      ]),
    ]),
    section({
      id: "skill",
      gutter: `${String(pages.length)} pages`,
      title: "The skill, rendered here",
      lead:
        "Start at the entry skill; each extension adds one. Every URL below is exactly what `llms.txt` lists, and " +
        "the build fails if one of them does not resolve.",
      body: join(
        skillGroups,
        h("p", { class: "band-after" }, [
          h("a", { href: "/skill/", class: "arrow-link" }, "Entry skill"),
          " · ",
          h("a", { href: "/skill/references/gotchas" }, "Gotchas"),
          " · ",
          h("a", { href: "/llms.txt" }, "llms.txt"),
        ]),
      ),
    }),
    section({
      id: "architecture",
      gutter: "docs/architecture",
      title: "Architecture",
      lead: "One document per area, written before the code and corrected by it.",
      body: linkTable("docs/architecture", documentTitles(root, "docs/architecture")),
    }),
    section({
      id: "adr",
      gutter: "docs/adr",
      title: "Decision records",
      lead: "Why the engine is shaped the way it is, including the choices that turned out to be wrong.",
      body: linkTable("docs/adr", documentTitles(root, "docs/adr")),
    }),
    section({
      id: "rules",
      gutter: "CONSTITUTION.md",
      title: "Rules and process",
      body: h("ul", { class: "doc-list" }, [
        h("li", {}, [
          outbound(`${BLOB_URL}/CONSTITUTION.md`, "`CONSTITUTION.md`"),
          h(
            "span",
            { class: "doc-note" },
            "Numbered clauses: principles, architecture tenets, versioning, security, licensing.",
          ),
        ]),
        h("li", {}, [
          outbound(`${BLOB_URL}/docs/standards/coding-standards.md`, "`docs/standards/coding-standards.md`"),
          h("span", { class: "doc-note" }, "Toolchain, TypeScript configuration, lint, naming, testing, CI."),
        ]),
        h("li", {}, [
          outbound(`${BLOB_URL}/docs/plan/engineering-plan.md`, "`docs/plan/engineering-plan.md`"),
          h(
            "span",
            { class: "doc-note" },
            "The phased plan from an empty repository to 1.0, with each phase's recorded status.",
          ),
        ]),
        h("li", {}, [
          outbound(`${BLOB_URL}/AGENTS.md`, "`AGENTS.md`"),
          h("span", { class: "doc-note" }, "The entry point for contributors and for coding agents."),
        ]),
        h("li", {}, [
          outbound(`${BLOB_URL}/CONTRIBUTING.md`, "`CONTRIBUTING.md`"),
          h("span", { class: "doc-note" }, "Commands, commit conventions, and what a pull request has to carry."),
        ]),
      ]),
    }),
  );
}
