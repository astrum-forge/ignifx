// The website is an application, not a published library, so `CONSTITUTION.md` §3.5 (no import-time
// side effects) does not apply here: the `render()` call at the bottom is this module's only side
// effect. It exports nothing; `moduleDetection: "force"` in `tsconfig.json` keeps it a module anyway.

type Attributes = Readonly<Record<string, string>>;

type Child = Node | string;

interface ProjectLink {
  readonly label: string;
  readonly href: string;
}

const REPOSITORY_URL = "https://github.com/astrum-forge/ignifx";

const DESCRIPTION =
  "A code-first TypeScript game engine for the web, built on Babylon Lite (WebGPU only). Runs in " +
  "WebGPU-capable browsers and in Electron. Designed for indie 2D (top-down, side-scrolling) and 3D " +
  "(third-person, first-person) games, with a Unity-style script lifecycle, Godot-style scenes and " +
  "signals, and first-class documentation for AI coding agents.";

const STATUS = "Planning phase — no packages are published yet.";

const FOOTER = "Apache-2.0 · Astrum Forge Studios";

const LINKS: readonly ProjectLink[] = [
  { label: "GitHub repository", href: REPOSITORY_URL },
  { label: "CONSTITUTION.md", href: `${REPOSITORY_URL}/blob/main/CONSTITUTION.md` },
  { label: "docs/", href: `${REPOSITORY_URL}/tree/main/docs` },
  { label: "skills/ignifx/SKILL.md", href: `${REPOSITORY_URL}/blob/main/skills/ignifx/SKILL.md` },
  { label: "Astrum Forge Studios", href: "https://astrumforge.com" },
  { label: "llms.txt (index for agents)", href: "/llms.txt" },
];

/**
 * Creates an element with static attributes and children. Every string passed in is a literal from
 * this module, so it is appended as text — no `innerHTML`, nothing interpolated from the outside.
 *
 * @param tag - The element name to create.
 * @param attributes - Attribute name/value pairs to set.
 * @param children - Nodes and text to append, in order.
 * @returns The new element.
 */
function el(tag: string, attributes: Attributes = {}, children: readonly Child[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/**
 * Creates an anchor. External destinations get `rel="noreferrer"` so no referrer leaves the site
 * (`CONSTITUTION.md` §9.1: the site makes no third-party requests and reports nothing anywhere).
 *
 * @param entry - The label and destination to render.
 * @returns The new anchor element.
 */
function anchor(entry: ProjectLink): HTMLAnchorElement {
  const node = document.createElement("a");
  node.href = entry.href;
  node.textContent = entry.label;
  if (!entry.href.startsWith("/")) {
    node.rel = "noreferrer";
  }
  return node;
}

/**
 * Replaces the contents of the container with the Phase 0 placeholder page.
 *
 * @param root - The `#app` container from `index.html`.
 */
function render(root: Element): void {
  root.replaceChildren(
    el("header", {}, [el("h1", {}, ["ignifx"]), el("p", { class: "tagline" }, [DESCRIPTION])]),
    el("p", { class: "status" }, [STATUS]),
    el("nav", { "aria-label": "Project links" }, [
      el(
        "ul",
        {},
        LINKS.map((entry) => el("li", {}, [anchor(entry)])),
      ),
    ]),
    el("footer", {}, [FOOTER]),
  );
}

const container = document.querySelector("#app");
if (container === null) {
  throw new Error("ignifx website: the #app container is missing from index.html");
}
render(container);
