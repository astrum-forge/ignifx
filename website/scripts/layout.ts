/**
 * The page shell: `<head>`, the sticky header, the footer, the icon sprite and the skip link.
 *
 * Every route is a complete HTML document written here at build time. There is no client-side
 * router and no hydration: `src/main.ts` only enhances what is already on the page. Three things in
 * the shell are load-bearing for the Content-Security-Policy the build emits from `headers.txt`:
 *
 * - `/theme.js` is a **classic, synchronous** script, so the stored theme is applied before the
 *   first paint. An inline script would be the usual fix and `script-src 'self'` forbids it.
 * - The one exception is the JSON-LD block, whose SHA-256 the build substitutes into `script-src`
 *   (`08-execution.md` §4.5). It is byte-identical on every page, so one hash covers the site.
 * - Controls that do nothing without JavaScript are marked `js-only` and revealed by CSS once
 *   `/theme.js` has set `data-js` on `<html>`, rather than being hidden with a `style` attribute.
 */
import { createHash } from "node:crypto";
import { blobUrl, site, treeUrl, versionLabel } from "../site.config.ts";
import { each, esc, h, join } from "./html.ts";
import { icon, iconSprite, markImg } from "./icons.ts";

/** The production origin, used for canonical links, the sitemap and Open Graph. */
export const SITE_ORIGIN = site.origin;

/** The Open Graph card, produced by the press kit (`05-press-kit.md` §3). */
const SOCIAL_IMAGE = "/press/ignifx-social-1200x630.png";

/** Asset URLs the shell links to, filled in once Rollup has named the emitted files. */
export interface Assets {
  /** The site stylesheet. */
  readonly css: string;
  /** The generated stylesheet: `@font-face` rules and Shiki token classes. */
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
  /** The complete `<title>`, already including the site name. */
  readonly title: string;
  /** The meta description. */
  readonly description: string;
  /** The `<main>` contents. */
  readonly main: string;
  /** Extra class on `<body>`. */
  readonly bodyClass?: string;
  /** The emitted asset URLs. */
  readonly assets: Assets;
}

/**
 * The structured-data block: who publishes ignifx and what it is
 * (`06-engineering.md` §2.5, decision 6 of `08-execution.md` §2).
 *
 * Written with a stable key order and no interpolation, because its bytes are hashed into the site
 * Content-Security-Policy and must be identical on every page and between builds.
 */
export const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://ignifx.com/#studio",
      name: "Astrum Forge Studios Pty Ltd",
      url: "https://astrumforge.com",
      email: "info@astrumforge.com",
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "https://ignifx.com/#ignifx",
      name: "ignifx",
      description:
        "An open-source TypeScript game engine built on WebGPU, for 2D and 3D games that run in the browser and on the desktop.",
      url: "https://ignifx.com",
      codeRepository: "https://github.com/astrum-forge/ignifx",
      programmingLanguage: "TypeScript",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      author: { "@id": "https://ignifx.com/#studio" },
      publisher: { "@id": "https://ignifx.com/#studio" },
    },
  ],
});

/**
 * The `script-src` source expression for {@link JSON_LD}.
 *
 * @returns `'sha256-<base64>'`, ready to paste into a Content-Security-Policy.
 */
export function jsonLdHash(): string {
  return `'sha256-${createHash("sha256").update(JSON_LD, "utf8").digest("base64")}'`;
}

/** The four top-level destinations, in header order (`01-strategy-and-ia.md` §8). */
const NAV: readonly { readonly href: string; readonly label: string }[] = [
  { href: "/features/", label: "Features" },
  { href: "/examples/", label: "Examples" },
  { href: "/docs/", label: "Docs" },
  { href: "/press/", label: "Press" },
];

/**
 * Renders the header: lockup, the four links, GitHub, npm, the theme toggle.
 *
 * The four links live in a `<details>` so the small-screen menu needs no JavaScript. Above 800 px
 * the summary is hidden and the list is laid out as a row (`src/styles/shell.css`).
 *
 * @param route - The current route, for the active nav item.
 * @returns The `<header>` HTML.
 */
function header(route: string): string {
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
  const npmButton = site.published
    ? h("a", { class: "btn btn-ghost btn-icon", href: site.npm, rel: "noreferrer" }, [
        icon("npm"),
        h("span", { class: "btn-text" }, "npm"),
      ])
    : h(
        "span",
        { class: "btn btn-ghost btn-icon is-disabled", title: "First release coming to npm", "aria-disabled": "true" },
        [icon("npm"), h("span", { class: "btn-text" }, "npm · soon")],
      );
  return h("header", { class: "masthead" }, [
    h("div", { class: "masthead-row" }, [
      h("a", { class: "lockup", href: "/", "aria-label": "ignifx home" }, [
        markImg(64),
        h("span", { class: "lockup-word" }, "ignifx"),
      ]),
      h("details", { class: "nav-disclosure" }, [
        h("summary", { class: "nav-summary", "aria-label": "Menu" }, [
          icon("menu", "icon-menu"),
          icon("close", "icon-close"),
        ]),
        h("nav", { class: "nav", "aria-label": "Main" }, h("ul", { class: "nav-list" }, links)),
      ]),
      h("div", { class: "masthead-tools" }, [
        h("a", { class: "btn btn-ghost btn-icon", href: site.repo, rel: "noreferrer" }, [
          icon("github"),
          h("span", { class: "btn-text" }, "GitHub"),
        ]),
        npmButton,
        h(
          "button",
          {
            type: "button",
            class: "btn btn-ghost btn-square js-only",
            "data-theme-toggle": true,
            "aria-label": "Switch theme",
          },
          [icon("sun", "icon-sun"), icon("moon", "icon-moon")],
        ),
      ]),
    ]),
  ]);
}

/** One footer column: a heading and its links. */
type FooterColumn = readonly [string, readonly (readonly [string, string])[]];

/**
 * The three footer columns (`01-strategy-and-ia.md` §8). The npm row appears only once the
 * packages are published (`03-pages-and-copy.md` §8).
 *
 * @returns The columns, in display order.
 */
function footerColumns(): readonly FooterColumn[] {
  const product: (readonly [string, string])[] = [
    ["Features", "/features/"],
    ["Examples", "/examples/"],
    ["Templates", "/#templates"],
    ["Changelog", blobUrl("packages/core/CHANGELOG.md")],
  ];
  if (site.published) {
    product.push(["npm", site.npm]);
  }
  return [
    ["Product", product],
    [
      "Learn",
      [
        ["Getting started", "/docs/getting-started/"],
        ["Guides", "/docs/guides/"],
        ["Browser support", "/docs/browser-support/"],
        ["API reference", treeUrl("skills/ignifx/references/api")],
        ["Contributing", blobUrl("CONTRIBUTING.md")],
      ],
    ],
    [
      "Company",
      [
        ["Astrum Forge Studios", site.studio],
        ["Press kit", "/press/"],
        [site.contactEmail, `mailto:${site.contactEmail}`],
        ["Security policy", blobUrl("SECURITY.md")],
        ["Licence: Apache-2.0", blobUrl("LICENSE")],
      ],
    ],
  ];
}

/**
 * Renders the footer.
 *
 * @returns The `<footer>` HTML.
 */
function footer(): string {
  const columns = each(footerColumns(), ([heading, items]) =>
    h("div", { class: "foot-col" }, [
      h("h2", { class: "foot-head" }, esc(heading)),
      h(
        "ul",
        {},
        each(items, ([label, href]) =>
          h("li", {}, h("a", { href, rel: href.startsWith("http") ? "noreferrer" : null }, esc(label))),
        ),
      ),
    ]),
  );
  return h("footer", { class: "site-foot" }, [
    h("div", { class: "shell" }, [
      h("div", { class: "foot-grid" }, [
        h("div", { class: "foot-brand" }, [
          h("span", { class: "lockup" }, [markImg(64), h("span", { class: "lockup-word" }, "ignifx")]),
          h("p", { class: "foot-tagline" }, "The TypeScript game engine for WebGPU."),
          h("p", { class: "chip chip-version" }, esc(versionLabel())),
        ]),
        columns,
      ]),
      h("p", { class: "foot-legal" }, [
        "© 2026 Astrum Forge Studios Pty Ltd. ignifx is a trademark of Astrum Forge Studios. Apache-2.0. Building with an AI agent? Start at ",
        h("a", { href: "/llms.txt" }, "/llms.txt"),
        ".",
      ]),
      h(
        "p",
        { class: "foot-fonts" },
        [
          "Typeset in Archivo, Public Sans and JetBrains Mono, self-hosted under the ",
          h("a", { href: "/licenses/archivo-OFL.txt" }, "SIL Open Font Licence"),
          " (",
          h("a", { href: "/licenses/public-sans-OFL.txt" }, "Public Sans"),
          ", ",
          h("a", { href: "/licenses/jetbrains-mono-OFL.txt" }, "JetBrains Mono"),
          "). No third-party request is made from this site.",
        ].join(""),
      ),
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
  const canonical = `${SITE_ORIGIN}${page.route}`;
  const head = join(
    h("meta", { charset: "utf-8" }),
    h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    h("title", {}, esc(page.title)),
    h("meta", { name: "description", content: page.description }),
    h("link", { rel: "canonical", href: canonical }),
    h("meta", { property: "og:type", content: "website" }),
    h("meta", { property: "og:site_name", content: "ignifx" }),
    h("meta", { property: "og:title", content: page.title }),
    h("meta", { property: "og:description", content: page.description }),
    h("meta", { property: "og:url", content: canonical }),
    h("meta", { property: "og:image", content: `${SITE_ORIGIN}${SOCIAL_IMAGE}` }),
    h("meta", { name: "twitter:card", content: "summary_large_image" }),
    h("meta", { name: "twitter:title", content: page.title }),
    h("meta", { name: "twitter:description", content: page.description }),
    h("meta", { name: "twitter:image", content: `${SITE_ORIGIN}${SOCIAL_IMAGE}` }),
    h("link", { rel: "icon", href: "/favicon.ico", sizes: "48x48" }),
    h("link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" }),
    h("link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" }),
    h("link", { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }),
    each(assets.preloadFonts, (href) =>
      h("link", { rel: "preload", as: "font", type: "font/woff2", href, crossorigin: "anonymous" }),
    ),
    h("link", { rel: "stylesheet", href: assets.css }),
    h("link", { rel: "stylesheet", href: assets.codeCss }),
    h("script", { src: "/theme.js" }, ""),
    h("script", { type: "module", src: assets.script }, ""),
    h("script", { type: "application/ld+json" }, JSON_LD),
    h("meta", { name: "generator", content: "ignifx website build" }),
  );
  const body = join(
    h("a", { class: "skip", href: "#main" }, "Skip to content"),
    iconSprite(),
    header(page.route),
    h("main", { id: "main", class: "site-main" }, page.main),
    footer(),
  );
  const bodyClass = page.bodyClass ?? "";
  return `<!doctype html>\n${h("html", { lang: "en" }, join(h("head", {}, head), h("body", { class: bodyClass === "" ? null : bodyClass }, body)))}\n`;
}
