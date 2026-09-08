/**
 * `/press/` — the press kit page (structure `05-press-kit.md` §1, copy §2, files §3, badges §4,
 * screenshots §5).
 *
 * The files live under `website/public/press/` and are written by the press-kit generator, which
 * belongs to another owner. This page reads that directory at build time: it shows what exists, and
 * `scripts/site.ts` fails the production build when a file the table names is absent — so the page
 * can never offer a download that 404s.
 */
import { site } from "../site.config.ts";
import { button, callout, dataTable } from "./components.ts";
import { BOILERPLATE, BRAND_COLOURS, USAGE_DO, USAGE_DONT } from "./copy.ts";
import { each, esc, h, join, md } from "./html.ts";
import { icon } from "./icons.ts";
import { BADGES, PRESS_FILES, pressImageSize, presentPressFiles, pressScreenshots } from "./press-files.ts";
import type { CodeHighlighter } from "./highlight.ts";

/**
 * One logo preview: what it is called, the file shown on each ground, and the CSS class that sets
 * its rendered height.
 *
 * The colour SVGs embed the 1024 px master PNG, so the page previews the **PNG** derivatives and
 * links the SVGs from the file list instead of displaying them inline (`08-execution.md` §9).
 */
const LOGO_PREVIEWS: readonly {
  readonly label: string;
  readonly light: string;
  readonly dark: string;
  readonly kind: string;
}[] = [
  { label: "Mark", light: "ignifx-mark-256.png", dark: "ignifx-mark-256.png", kind: "mark" },
  {
    label: "Silhouette",
    light: "ignifx-mark-silhouette-black-256.png",
    dark: "ignifx-mark-silhouette-white-256.png",
    kind: "mark",
  },
  { label: "Wordmark", light: "ignifx-wordmark.svg", dark: "ignifx-wordmark-white.svg", kind: "word" },
  {
    label: "Horizontal lockup",
    light: "ignifx-lockup-horizontal-1x.png",
    dark: "ignifx-lockup-horizontal-dark-1x.png",
    kind: "word",
  },
  {
    label: "Stacked lockup",
    light: "ignifx-lockup-stacked-1x.png",
    dark: "ignifx-lockup-stacked-dark-1x.png",
    kind: "stack",
  },
];

/**
 * The fact sheet (`05` §2), release-gated where the value depends on npm.
 *
 * @returns Item and value pairs, in display order.
 */
function factSheet(): readonly (readonly [string, string])[] {
  return [
    ["Name", "ignifx"],
    ["What it is", "An open-source TypeScript game engine for WebGPU"],
    ["Developer", "Astrum Forge Studios Pty Ltd, Australia"],
    ["Licence", "Apache-2.0"],
    ["Language", "TypeScript"],
    ["Renderer", "WebGPU, through Babylon Lite"],
    ["Physics", "Havok (3D), Rapier (2D)"],
    ["Platforms", "Chrome and Edge 113+, Safari 26+, Firefox 141+/145+; Windows, macOS and Linux via Electron"],
    ["Website", "ignifx.com"],
    ["Source", "github.com/astrum-forge/ignifx"],
    [
      "Packages",
      site.published ? "`ignifx` and `@ignifx/*` on npm" : "`ignifx` and `@ignifx/*` — first release coming to npm",
    ],
    ["First release", site.published ? site.version : "Not yet released"],
    ["Contact", site.contactEmail],
  ];
}

/**
 * Renders one badge block: the badge at 1× and 2× on both grounds, and its two snippets.
 *
 * @param present - The press files that exist.
 * @param highlighter - The shared Shiki highlighter.
 * @param badge - The badge.
 * @returns The HTML.
 */
function badgeBlock(
  present: ReadonlySet<string>,
  highlighter: CodeHighlighter,
  badge: (typeof BADGES)[number],
): string {
  const markdown = `[![${badge.label}](${site.origin}/press/${badge.light})](${site.origin})`;
  const html = `<a href="${site.origin}"><img src="${site.origin}/press/${badge.light}" alt="${badge.label}" height="20"></a>`;
  const preview = (file: string, ground: "light" | "dark", scale: 1 | 2): string =>
    present.has(file)
      ? h("div", { class: `badge-swatch badge-${ground}` }, [
          h("img", {
            src: `/press/${file}`,
            alt: `${badge.label} badge on a ${ground} ground, ${String(scale)}×`,
            width: 150 * scale,
            height: 20 * scale,
            loading: "lazy",
            decoding: "async",
            class: `badge-img badge-${String(scale)}x`,
          }),
        ])
      : "";
  return h("div", { class: "badge-block" }, [
    h("div", { class: "badge-head" }, [
      h("h3", {}, esc(badge.label)),
      h("p", { class: "badge-for" }, esc(badge.intendedFor)),
    ]),
    h("div", { class: "badge-previews" }, [
      preview(badge.light, "light", 1),
      preview(badge.light, "light", 2),
      preview(badge.dark, "dark", 1),
      preview(badge.dark, "dark", 2),
    ]),
    highlighter.render(markdown, "", { label: "Markdown" }),
    highlighter.render(html, "html", { label: "HTML" }),
  ]);
}

/**
 * Renders the press page.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents.
 */
export function pressPage(websiteRoot: string, highlighter: CodeHighlighter): string {
  const present = presentPressFiles(websiteRoot);
  const screenshots = pressScreenshots(websiteRoot);
  const hasZip = present.has("ignifx-press-kit.zip");

  const head = h("section", { class: "page-head" }, [
    h("div", { class: "shell" }, [
      h("h1", {}, "Press kit"),
      h(
        "p",
        { class: "page-lead" },
        esc(
          "Everything you need to write about ignifx, or to say that your game runs on it. The logos and badges below are free to use under the rules in the usage section; no permission is needed.",
        ),
      ),
      h("div", { class: "page-actions" }, [
        hasZip
          ? button({
              label: "Download the logo package (.zip)",
              variant: "primary",
              icon: "download",
              href: "/press/ignifx-press-kit.zip",
            })
          : "",
        button({
          label: site.contactEmail,
          variant: "secondary",
          href: `mailto:${site.contactEmail}`,
        }),
      ]),
      hasZip
        ? ""
        : callout(
            "caution",
            h("p", {}, esc("The logo package is not in the tree yet; the production build fails until it is.")),
          ),
    ]),
  ]);

  const about = h("section", { class: "band", id: "about" }, [
    h("div", { class: "shell" }, [
      h("h2", { class: "band-title" }, "About ignifx"),
      h(
        "div",
        { class: "boilerplates" },
        each(BOILERPLATE, (item) =>
          h("div", { class: "boilerplate" }, [
            h("div", { class: "boilerplate-head" }, [
              h("h3", {}, esc(item.label)),
              button({ label: "Copy", variant: "ghost", icon: "copy", copy: item.text }),
            ]),
            h("p", {}, esc(item.text)),
          ]),
        ),
      ),
    ]),
  ]);

  const name = h("section", { class: "band band-quiet", id: "the-name" }, [
    h("div", { class: "shell shell-narrow" }, [
      h("h2", { class: "band-title" }, "The name"),
      h(
        "p",
        {},
        md(
          "ignifx is a blend of **ignite** and **effects**, the “fx” a game developer writes on a folder of particle systems and post-processing. It began as the internal engine at Astrum Forge Studios, used for the studio's own games and projects, before being released as open source. The flame in the mark is the ignition; the crystal it burns inside is the effect it leaves behind.",
        ),
      ),
      h("p", {}, md("Say it “ig-ni-fix”. Write it `ignifx`, always lowercase, even at the start of a sentence.")),
    ]),
  ]);

  const facts = h("section", { class: "band", id: "fact-sheet" }, [
    h("div", { class: "shell shell-narrow" }, [
      h("h2", { class: "band-title" }, "Fact sheet"),
      dataTable(
        ["Item", "Value"],
        factSheet().map(([item, value]) => [item, value]),
        "Fact sheet",
      ),
    ]),
  ]);

  const logos = h("section", { class: "band", id: "logos" }, [
    h("div", { class: "shell" }, [
      h("h2", { class: "band-title" }, "Logos"),
      h(
        "div",
        { class: "grid grid-two" },
        each(LOGO_PREVIEWS, (logo) => {
          const swatch = (file: string, ground: "light" | "dark"): string => {
            const size = pressImageSize(websiteRoot, file);
            if (size === null) {
              return h("div", { class: `logo-swatch logo-${ground} is-missing` }, h("p", {}, esc(file)));
            }
            return h("div", { class: `logo-swatch logo-${ground}` }, [
              h("img", {
                src: `/press/${file}`,
                alt: `The ignifx ${logo.label.toLowerCase()} on a ${ground} ground`,
                width: size.width,
                height: size.height,
                loading: "lazy",
                decoding: "async",
                class: `logo-img logo-img-${logo.kind}`,
              }),
            ]);
          };
          return h("div", { class: "card card-logo" }, [
            h("h3", { class: "card-title" }, esc(logo.label)),
            h("div", { class: "logo-swatches" }, [swatch(logo.light, "light"), swatch(logo.dark, "dark")]),
          ]);
        }),
      ),
      h("h3", { class: "files-title" }, "Every file in the kit"),
      h(
        "div",
        { class: "grid grid-three" },
        each(PRESS_FILES, (group) => {
          const files = group.files.filter((file) => present.has(file));
          return h("div", { class: "file-group" }, [
            h("h4", {}, esc(group.group)),
            files.length === 0
              ? h("p", { class: "file-empty" }, "Not built yet.")
              : h(
                  "ul",
                  { class: "file-list" },
                  each(files, (file) =>
                    h("li", {}, h("a", { href: `/press/${file}`, download: true }, [icon("download"), esc(file)])),
                  ),
                ),
          ]);
        }),
      ),
    ]),
  ]);

  const badges = h("section", { class: "band band-quiet", id: "badges" }, [
    h("div", { class: "shell" }, [
      h("h2", { class: "band-title" }, "Badges"),
      h(
        "p",
        { class: "band-lead" },
        esc(
          "Hot-link them straight from this site: the URLs below are stable and served with a permissive CORS header.",
        ),
      ),
      h(
        "div",
        { class: "grid grid-two" },
        each(BADGES, (badge) => badgeBlock(present, highlighter, badge)),
      ),
    ]),
  ]);

  const usage = h("section", { class: "band", id: "usage" }, [
    h("div", { class: "shell" }, [
      h("h2", { class: "band-title" }, "Usage"),
      h("div", { class: "grid grid-two" }, [
        h("div", { class: "usage-col" }, [
          h("h3", {}, "Do"),
          h(
            "ul",
            { class: "ticks" },
            each(USAGE_DO, (line) => h("li", {}, md(line))),
          ),
        ]),
        h("div", { class: "usage-col" }, [
          h("h3", {}, "Do not"),
          h(
            "ul",
            { class: "crosses" },
            each(USAGE_DONT, (line) => h("li", {}, md(line))),
          ),
        ]),
      ]),
      h("h3", { class: "files-title" }, "Minimum sizes"),
      h("p", {}, esc("Mark 16 px. Horizontal lockup 96 px wide. Stacked lockup 64 px wide. Badges 20 px high.")),
      h("h3", { class: "files-title" }, "Colours"),
      h(
        "ul",
        { class: "swatches" },
        each(BRAND_COLOURS, (colour) =>
          h("li", { class: `swatch swatch-${colour.hex.slice(1).toLowerCase()}` }, [
            h("span", { class: "swatch-chip", "aria-hidden": "true" }),
            h("span", { class: "swatch-name" }, esc(colour.name)),
            h("code", { class: "swatch-hex" }, esc(colour.hex)),
            h("span", { class: "swatch-note" }, esc(colour.note)),
          ]),
        ),
      ),
      callout(
        "note",
        h("p", {}, [
          md(
            "**Permission.** The ignifx name and mark are trademarks of Astrum Forge Studios Pty Ltd. You may use them as described here to refer to ignifx. For anything else, email ",
          ),
          h("a", { href: `mailto:${site.contactEmail}` }, esc(site.contactEmail)),
          ".",
        ]),
      ),
    ]),
  ]);

  const shots = h("section", { class: "band", id: "screenshots" }, [
    h("div", { class: "shell" }, [
      h("h2", { class: "band-title" }, "Screenshots"),
      h(
        "p",
        { class: "band-lead" },
        esc(
          "Captures at 1280×720, produced by the visual test suite. Apache-2.0; sample assets credited at ignifx.com/examples/attribution/.",
        ),
      ),
      screenshots.length === 0
        ? h("p", {}, "The screenshot set is not built yet.")
        : h(
            "div",
            { class: "grid grid-three" },
            each(screenshots, (file) =>
              h("figure", { class: "shot" }, [
                h("img", {
                  src: `/press/screenshots/${file}`,
                  alt: `An ignifx app running: ${file.replace(/\.png$/u, "").replaceAll("-", " ")}`,
                  width: 1280,
                  height: 720,
                  loading: "lazy",
                  decoding: "async",
                }),
                h("figcaption", {}, [
                  h("a", { href: `/press/screenshots/${file}`, download: true }, [icon("download"), esc(file)]),
                ]),
              ]),
            ),
          ),
    ]),
  ]);

  const contact = h("section", { class: "band band-quiet", id: "contact" }, [
    h("div", { class: "shell shell-narrow" }, [
      h("h2", { class: "band-title" }, "Contact"),
      h("p", {}, [
        "Press and partnership enquiries: ",
        h("a", { href: `mailto:${site.contactEmail}` }, h("strong", {}, esc(site.contactEmail))),
        " · Astrum Forge Studios · ",
        h("a", { href: site.studio, rel: "noreferrer" }, "astrumforge.com"),
      ]),
    ]),
  ]);

  return join(head, about, name, facts, logos, badges, usage, shots, contact);
}
