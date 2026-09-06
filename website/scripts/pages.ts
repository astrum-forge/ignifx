/**
 * `/` and `/features/`.
 *
 * Everything factual here comes from `repo.ts` (which reads the repository) or from `content.ts`
 * (editorial copy whose claims are traceable to `AGENTS.md`, the architecture documents, and the
 * skills). The hero's code sample is sliced out of a real recipe under `examples/recipes/`, so it
 * cannot drift from code that the documentation harness compiles and runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SUBSYSTEMS } from "./content.ts";
import { each, esc, h, join } from "./html.ts";
import { formatKilobytes, frameTimeline, md, measure, outbound, section } from "./pieces.ts";
import { BLOB_URL } from "./repo.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { RepositoryFacts } from "./repo.ts";

/** The recipe the home page quotes, and the skill route that documents it. */
const HERO_RECIPE = {
  file: "examples/recipes/spawn-a-prefab-on-click/main.ts",
  marker: "class Spawner",
  route: "/skill/references/recipes/spawn-a-prefab-on-click",
} as const;

/**
 * Slices a top-level block out of a TypeScript file: the declaration that starts with `marker`,
 * plus the TSDoc comment above it, up to the first line that is exactly `}`.
 *
 * @param source - The file's text.
 * @param marker - The prefix of the declaration's first line.
 * @returns The block, or an empty string when the marker is gone.
 */
function extractBlock(source: string, marker: string): string {
  const lines = source.split("\n");
  let start = lines.findIndex((line) => line.startsWith(marker));
  if (start === -1) {
    return "";
  }
  let end = start;
  while (end < lines.length && lines[end] !== "}") {
    end += 1;
  }
  while (start > 0) {
    const previous = lines[start - 1] ?? "";
    if (previous.startsWith("/**") || previous.startsWith(" *")) {
      start -= 1;
      continue;
    }
    break;
  }
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Renders the home page body.
 *
 * @param facts - The repository facts.
 * @param highlighter - The shared Shiki highlighter.
 * @param root - Absolute path to the repository root.
 * @returns The `<main>` contents.
 * @throws When the quoted recipe no longer holds the block the hero shows.
 */
export function homePage(facts: RepositoryFacts, highlighter: CodeHighlighter, root: string): string {
  const recipeSource = readFileSync(path.join(root, HERO_RECIPE.file), "utf8");
  const snippet = extractBlock(recipeSource, HERO_RECIPE.marker);
  if (snippet === "") {
    throw new Error(`website: ${HERO_RECIPE.file} no longer declares '${HERO_RECIPE.marker}'.`);
  }

  const hero = h("div", { class: "hero" }, [
    h("p", { class: "eyebrow" }, [
      esc(`@ignifx/core ${facts.version}`),
      h("span", { class: "eyebrow-dot" }, "·"),
      esc(`Babylon Lite ${facts.liteVersion}`),
      h("span", { class: "eyebrow-dot" }, "·"),
      "WebGPU only",
    ]),
    h("h1", { class: "hero-title" }, "A game engine you write, on a frame you can measure."),
    h("p", { class: "hero-lead" }, [
      "ignifx is a code-first TypeScript engine for browsers and Electron. It renders exclusively through WebGPU ",
      "via Babylon Lite, and it is built for indie 2D and 3D games — a Unity-style script lifecycle, Godot-style ",
      "scenes and signals, and documentation written for the coding agent as well as for you.",
    ]),
    h("p", { class: "hero-actions" }, [
      h("a", { class: "button button-primary", href: "/getting-started/" }, "Get started"),
      h("a", { class: "button", href: "/skill/" }, "Read the skill"),
    ]),
    h("p", { class: "hero-status" }, [
      h("span", { class: "dot" }, ""),
      h(
        "span",
        {},
        md(
          `Version \`${facts.version}\`. Nothing is published to npm yet, so the way in is a clone — not \`npm install\`.`,
        ),
      ),
    ]),
  ]);

  return join(
    hero,
    section({
      id: "frame",
      gutter: "Phase 0 – 5",
      title: "One fixed loop, six phases, one budget",
      lead:
        "The engine owns the loop; Babylon Lite draws when it is told to. Every phase runs every frame, in this " +
        "order, and a script's callbacks are dispatched from them by name.",
      body: frameTimeline(facts),
    }),
    section({
      id: "code",
      gutter: "examples/recipes/",
      title: "This is what a script looks like",
      lead:
        "No decorators and no reflection: `Script.define` declares the fields, which is what makes the component " +
        "serializable, editable in the inspector, and patchable on hot reload. This one is lifted unedited from a " +
        "recipe the documentation harness compiles and runs.",
      body: join(
        highlighter.render(snippet, "ts"),
        h("p", { class: "band-after" }, [
          h("a", { href: HERO_RECIPE.route, class: "arrow-link" }, "Read the whole recipe"),
          " · ",
          outbound(`${BLOB_URL}/${HERO_RECIPE.file}`, "View the source on GitHub"),
        ]),
      ),
    }),
    section({
      id: "subsystems",
      gutter: "@ignifx/*",
      title: "What is in the box",
      lead: "Eleven subsystems, each an optional extension with its own skill page.",
      body: h(
        "ul",
        { class: "grid grid-cards" },
        each(SUBSYSTEMS, (subsystem) =>
          h("li", { class: "card" }, [
            h("p", { class: "card-pkg" }, md(subsystem.pkg)),
            h("h3", { class: "card-title" }, h("a", { href: subsystem.skill }, esc(subsystem.title))),
            h("p", { class: "card-text" }, md(subsystem.short)),
          ]),
        ),
      ),
    }),
    section({
      id: "measured",
      gutter: "baselines.json",
      title: "Numbers this repository actually recorded",
      lead: `Measured on ${facts.baselineMachine}. Frame times are reported, not asserted; the bundle ceilings are asserted by \`bundle-size.test.ts\`.`,
      body: h("div", { class: "grid grid-measures" }, [
        measure(
          String(facts.thousandEntityMs),
          "ms",
          `whole-scheduler CPU time for ${facts.thousandEntityCount.toLocaleString("en-GB")} entities`,
          "frameTime.thousand-entities",
        ),
        measure(
          formatKilobytes(
            facts.bundles.find((bundle) => bundle.target === "templates/3d-third-person")?.gzipBytes ?? 0,
          ),
          "KB",
          "entry chunk of the 3D third-person template, gzipped",
          "bundles.templates/3d-third-person",
        ),
        measure(
          formatKilobytes(facts.bundles.find((bundle) => bundle.target === "examples/hello-cube")?.gzipBytes ?? 0),
          "KB",
          "entry chunk of `hello-cube`, gzipped — 20 KB over the plan's 250 KB target",
          "bundles.examples/hello-cube",
        ),
        measure(facts.liteVersion, "", "Babylon Lite, pinned exactly", "pnpm-workspace.yaml"),
      ]),
    }),
    section({
      id: "status",
      gutter: "AGENTS.md",
      title: "Where the project actually is",
      body: join(
        h("p", { class: "prose" }, md(facts.statusSentence)),
        h("p", { class: "prose" }, [
          "The engine is pre-1.0 and the public API is not frozen. There are no published packages, no migration ",
          "path, and no compatibility promise yet — ",
          outbound(`${BLOB_URL}/CONSTITUTION.md`, "the constitution"),
          " says what will change and what will not.",
        ]),
      ),
    }),
  );
}

/**
 * Renders `/features/`.
 *
 * @returns The `<main>` contents.
 */
export function featuresPage(): string {
  const intro = h("div", { class: "page-head" }, [
    h("p", { class: "eyebrow" }, "Features"),
    h("h1", { class: "page-title" }, "Eleven subsystems, one app object"),
    h("p", { class: "page-lead" }, [
      "Every subsystem below is an extension: you pass it to ",
      h("code", {}, "createApp"),
      " and it adds one service to the app plus the components that go with it. Nothing is registered that you did ",
      "not ask for, and each one links to the skill page an agent would read.",
    ]),
  ]);
  return join(
    intro,
    each(SUBSYSTEMS, (subsystem) =>
      section({
        id: subsystem.id,
        gutter: subsystem.pkg,
        title: subsystem.title,
        body: join(
          h("p", { class: "prose" }, md(subsystem.body)),
          h(
            "ul",
            { class: "api-list" },
            each(subsystem.api, (name) => h("li", {}, h("code", {}, esc(name)))),
          ),
          h(
            "p",
            { class: "band-after" },
            h("a", { href: subsystem.skill, class: "arrow-link" }, `Skill: ${esc(subsystem.title)}`),
          ),
        ),
      }),
    ),
  );
}
