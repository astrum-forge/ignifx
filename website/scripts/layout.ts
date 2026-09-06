/**
 * The page shell: `<head>`, the masthead, the footer, and the skip link.
 *
 * Every route is a complete HTML document written here at build time. There is no client-side
 * router and no hydration: `src/main.ts` only enhances what is already on the page. Two things in
 * the shell are load-bearing for the Content-Security-Policy in `public/_headers`:
 *
 * - `/theme.js` is a **classic, synchronous** script, so the stored theme is applied before the
 *   first paint. An inline script would be the usual fix and `script-src 'self'` forbids it.
 * - Controls that do nothing without JavaScript are marked `js-only` and revealed by CSS once
 *   `/theme.js` has set `data-js` on `<html>`, rather than being hidden with a `style` attribute.
 */
import { each, esc, h, join } from "./html.ts";
import { REPOSITORY_URL, TREE_URL } from "./repo.ts";

/** The production origin, used for canonical links and the sitemap. */
export const SITE_ORIGIN = "https://ignifx.com";

/** Asset URLs the shell links to, filled in once Rollup has named the emitted files. */
export interface Assets {
  /** The site stylesheet. */
  readonly css: string;
  /** The generated syntax-highlighting stylesheet. */
  readonly codeCss: string;
  /** The enhancement module. */
  readonly script: string;
  /** Font files that are preloaded. */
  readonly preloadFonts: readonly string[];
}

/** One page to render. */
export interface PageInput {
  /** Route, e.g. `/features/`. Used for the canonical link and the active nav item. */
  readonly route: string;
  /** The `<title>`, without the site suffix. */
  readonly title: string;
  /** The meta description. */
  readonly description: string;
  /** The `<main>` contents. */
  readonly main: string;
  /** Extra class on `<body>`. */
  readonly bodyClass?: string;
  /** Whether search and the rest of the shell chrome are shown. */
  readonly assets: Assets;
}

/** The five top-level destinations, in header order. */
const NAV: readonly { readonly href: string; readonly label: string }[] = [
  { href: "/features/", label: "Features" },
  { href: "/getting-started/", label: "Get started" },
  { href: "/gallery/", label: "Gallery" },
  { href: "/docs/", label: "Docs" },
  { href: "/skill/", label: "Skill" },
];

/**
 * Renders the masthead.
 *
 * @param route - The current route, for the active nav item.
 * @returns The `<header>` HTML.
 */
function masthead(route: string): string {
  const links = each(NAV, (item) => {
    const active = route === item.href || (item.href !== "/" && route.startsWith(item.href));
    return h(
      "li",
      {},
      h(
        "a",
        { href: item.href, class: active ? "nav-link is-active" : "nav-link", "aria-current": active ? "page" : null },
        esc(item.label),
      ),
    );
  });
  return h("header", { class: "masthead" }, [
    h("div", { class: "masthead-row" }, [
      h("a", { class: "wordmark", href: "/" }, [h("span", { class: "wordmark-mark" }, "ignifx")]),
      h("span", { class: "chip" }, "0.x · unpublished"),
      h("div", { class: "tools" }, [
        h("button", { type: "button", class: "tool js-only", "data-search": true, "aria-haspopup": "dialog" }, [
          h("span", { class: "tool-label" }, "Search"),
          h("kbd", { class: "tool-key" }, "s"),
        ]),
        h(
          "button",
          { type: "button", class: "tool js-only", "data-theme-toggle": true, "aria-live": "polite" },
          h("span", { class: "tool-label", "data-theme-label": true }, "Theme"),
        ),
        h("a", { class: "tool", href: REPOSITORY_URL, rel: "noreferrer" }, "GitHub"),
      ]),
    ]),
    h("nav", { class: "nav", "aria-label": "Main" }, h("ul", { class: "nav-list" }, links)),
  ]);
}

/**
 * Renders one footer column.
 *
 * @param heading - The column heading.
 * @param items - Label and destination pairs.
 * @returns The column HTML.
 */
function column(heading: string, items: readonly (readonly [string, string])[]): string {
  return h("div", { class: "foot-col" }, [
    h("h2", { class: "foot-head" }, esc(heading)),
    h(
      "ul",
      {},
      each(items, ([label, href]) =>
        h("li", {}, h("a", { href, rel: href.startsWith("http") ? "noreferrer" : null }, esc(label))),
      ),
    ),
  ]);
}

/**
 * Renders the footer.
 *
 * @returns The `<footer>` HTML.
 */
function footer(): string {
  return h("footer", { class: "site-foot" }, [
    h("div", { class: "foot-grid" }, [
      column(
        "Site",
        NAV.map((item) => [item.label, item.href] as const),
      ),
      column("Repository", [
        ["GitHub", REPOSITORY_URL],
        ["CONSTITUTION.md", `${REPOSITORY_URL}/blob/main/CONSTITUTION.md`],
        ["Architecture", `${TREE_URL}/docs/architecture`],
        ["Decision records", `${TREE_URL}/docs/adr`],
        ["Engineering plan", `${REPOSITORY_URL}/blob/main/docs/plan/engineering-plan.md`],
      ]),
      column("For agents", [
        ["llms.txt", "/llms.txt"],
        ["sitemap.xml", "/sitemap.xml"],
        ["Gotchas", "/skill/references/gotchas"],
      ]),
      column("Licences", [
        ["Apache-2.0 (ignifx)", `${REPOSITORY_URL}/blob/main/LICENSE`],
        ["Archivo — OFL", "/licenses/archivo-OFL.txt"],
        ["Public Sans — OFL", "/licenses/public-sans-OFL.txt"],
        ["JetBrains Mono — OFL", "/licenses/jetbrains-mono-OFL.txt"],
      ]),
    ]),
    h("p", { class: "foot-legal" }, [
      "ignifx is ",
      h("span", { class: "mono" }, "0.x"),
      " and unpublished. Apache-2.0 · ",
      h("a", { href: "https://astrumforge.com", rel: "noreferrer" }, "Astrum Forge Studios"),
      ". The site makes no third-party requests and stores nothing but your theme choice.",
    ]),
  ]);
}

/**
 * Renders one complete HTML document.
 *
 * @param page - The route, metadata, and body.
 * @returns The document text, starting at the doctype.
 */
export function renderDocument(page: PageInput): string {
  const { assets } = page;
  const head = join(
    h("meta", { charset: "utf-8" }),
    h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    h("title", {}, `${esc(page.title)} · ignifx`),
    h("meta", { name: "description", content: page.description }),
    h("link", { rel: "canonical", href: `${SITE_ORIGIN}${page.route}` }),
    h("link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }),
    each(assets.preloadFonts, (href) =>
      h("link", { rel: "preload", as: "font", type: "font/woff2", href, crossorigin: "anonymous" }),
    ),
    h("link", { rel: "stylesheet", href: assets.css }),
    h("link", { rel: "stylesheet", href: assets.codeCss }),
    h("script", { src: "/theme.js" }, ""),
    h("script", { type: "module", src: assets.script }, ""),
    h("meta", { name: "generator", content: "ignifx website build" }),
  );
  const body = join(
    h("a", { class: "skip", href: "#main" }, "Skip to content"),
    masthead(page.route),
    h("main", { id: "main", class: "site-main" }, page.main),
    footer(),
  );
  const bodyClass = page.bodyClass ?? "";
  return `<!doctype html>\n${h("html", { lang: "en" }, join(h("head", {}, head), h("body", { class: bodyClass === "" ? null : bodyClass }, body)))}\n`;
}
