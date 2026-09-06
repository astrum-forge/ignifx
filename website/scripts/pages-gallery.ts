/**
 * `/gallery/` and the not-found page.
 *
 * Every image is a golden capture from `tests/visual/`, copied into `public/gallery/`. The cards are
 * sized by aspect ratio rather than by pixels, so replacing a 512x288 capture with a 1280x720 one
 * needs no change here.
 */
import { each, esc, h, join } from "./html.ts";
import { formatKilobytes, md, outbound, section } from "./pieces.ts";
import { REPOSITORY_URL, TREE_URL } from "./repo.ts";
import type { RepositoryFacts, Showcase } from "./repo.ts";

/** Alt text per showcase. Written from each README, because a screenshot needs a description. */
const ALT_TEXT: Readonly<Record<string, string>> = {
  "2d-topdown": "A top-down tilemap level with a character on a Y-sorted layer of props.",
  "2d-sidescroller": "A pixel-art side-scrolling level with parallax bands behind a tiled platform.",
  "3d-third-person": "A third-person character in a lit courtyard, seen over the shoulder by an orbit camera.",
  "3d-first-person": "A first-person view of a lit room with pedestals and a view-model prop in hand.",
  "hello-cube": "A single PBR cube above a ground plane, lit by one directional light.",
  "gltf-viewer": "A glTF box model lit by an image-based environment probe.",
};

/**
 * Renders one gallery card.
 *
 * @param showcase - The template or example.
 * @returns The `<li>` HTML.
 */
function showcaseCard(showcase: Showcase): string {
  const controls =
    showcase.controls.length === 0
      ? ""
      : h("dl", { class: "controls" }, [
          each(showcase.controls.slice(0, 6), ([action, keyboard]) =>
            join(h("dt", {}, md(action)), h("dd", {}, md(keyboard))),
          ),
        ]);
  return h("li", { class: "shot" }, [
    h("img", {
      class: "shot-image",
      src: `/gallery/${showcase.name}.png`,
      width: 1280,
      height: 720,
      loading: "lazy",
      decoding: "async",
      alt: ALT_TEXT[showcase.name] ?? `A frame from the ${showcase.name} ${showcase.group.slice(0, -1)}.`,
    }),
    h("div", { class: "shot-body" }, [
      h("p", { class: "card-pkg" }, [
        esc(showcase.group),
        showcase.gzipBytes === null
          ? ""
          : h("span", { class: "shot-size" }, esc(`${formatKilobytes(showcase.gzipBytes)} KB gzipped`)),
      ]),
      h("h3", { class: "card-title" }, esc(showcase.name)),
      h("p", { class: "card-text" }, md(showcase.blurb)),
      controls,
      h("p", { class: "band-after" }, outbound(`${TREE_URL}/${showcase.repoPath}`, "Source on GitHub", "arrow-link")),
    ]),
  ]);
}

/**
 * Renders `/gallery/`.
 *
 * @param facts - The repository facts.
 * @returns The `<main>` contents.
 */
export function galleryPage(facts: RepositoryFacts): string {
  const templates = facts.showcases.filter((showcase) => showcase.group === "templates");
  const examples = facts.showcases.filter((showcase) => showcase.group === "examples");
  return join(
    h("div", { class: "page-head" }, [
      h("p", { class: "eyebrow" }, "Gallery"),
      h("h1", { class: "page-title" }, "Four templates and two examples, as they render"),
      h("p", { class: "page-lead" }, [
        "Every image on this page is a golden screenshot from ",
        outbound(`${TREE_URL}/tests/visual`, "`tests/visual/`"),
        " — the same frames the visual suite compares against on every change, captured in Chromium. They are not ",
        "art direction; they are what the code produces. Running any of them needs a WebGPU browser.",
      ]),
    ]),
    section({
      id: "templates",
      gutter: "templates/*",
      title: "Templates",
      lead:
        "Each one is a complete small game and the starting point `create-ignifx` copies. The figure on each card " +
        "is its entry chunk, gzipped: a 2D template carries Rapier's WebAssembly inlined as base64, which is most " +
        "of its size, while the 3D templates load Havok's `.wasm` as a separate file.",
      body: h(
        "ul",
        { class: "shots" },
        each(templates, (showcase) => showcaseCard(showcase)),
      ),
    }),
    section({
      id: "examples",
      gutter: "examples/*",
      title: "Examples",
      lead: "Smaller than a template: one idea each, with the engine defects they still expose written down in their READMEs.",
      body: h(
        "ul",
        { class: "shots" },
        each(examples, (showcase) => showcaseCard(showcase)),
      ),
    }),
  );
}

/**
 * Renders the not-found page.
 *
 * @returns The `<main>` contents.
 */
export function notFoundPage(): string {
  return join(
    h("div", { class: "page-head" }, [
      h("p", { class: "eyebrow" }, "404"),
      h("h1", { class: "page-title" }, "That page is not here"),
      h("p", { class: "page-lead" }, [
        "The site is a fixed set of prerendered pages, so a missing URL is a missing URL — there is no router that ",
        "could have gone wrong. Agents: the complete index is at ",
        h("a", { href: "/llms.txt" }, "/llms.txt"),
        " and every route is in ",
        h("a", { href: "/sitemap.xml" }, "/sitemap.xml"),
        ".",
      ]),
    ]),
    section({
      id: "elsewhere",
      gutter: "try",
      title: "Five ways in",
      body: h("ul", { class: "doc-list" }, [
        h("li", {}, [
          h("a", { href: "/" }, "Home"),
          h("span", { class: "doc-note" }, "What ignifx is, in one screen."),
        ]),
        h("li", {}, [
          h("a", { href: "/getting-started/" }, "Getting started"),
          h("span", { class: "doc-note" }, "The clone-and-run path that works today."),
        ]),
        h("li", {}, [
          h("a", { href: "/features/" }, "Features"),
          h("span", { class: "doc-note" }, "The eleven subsystems and their API names."),
        ]),
        h("li", {}, [
          h("a", { href: "/skill/" }, "The skill"),
          h("span", { class: "doc-note" }, "The documentation an agent reads, rendered here."),
        ]),
        h("li", {}, [
          outbound(REPOSITORY_URL, "The repository"),
          h("span", { class: "doc-note" }, "Source, issues, decision records."),
        ]),
      ]),
    }),
  );
}
