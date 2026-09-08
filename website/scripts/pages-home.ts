/**
 * The home page (`03-pages-and-copy.md` §2, wireframe `02-design-system.md` §4.1).
 *
 * Eight bands: the hero with the running example, the five pillars, the complete app, the twelve
 * subsystems, the four templates, the examples teaser, the studio, and the install block. The copy
 * is pasted from the plan; the code sample is sliced out of the entry skill at build time, so it
 * cannot drift from the code the docs harness compiles.
 */
import { CATALOGUE, findExample } from "../examples/catalogue.ts";
import { site } from "../site.config.ts";
import { band, button, chip, controlIcons, posterPicture, supportPill } from "./components.ts";
import { CODE_BULLETS, FEATURE_CARDS, HOME_EXAMPLE_SLUGS, PILLARS, SUPPORT_LINE, TEMPLATE_CARDS } from "./copy.ts";
import { exampleHref, poster } from "./examples.ts";
import { exampleFrame } from "./frame.ts";
import { each, esc, h, join, md } from "./html.ts";
import { icon } from "./icons.ts";
import { readFirstAppSample } from "./repo-content.ts";
import type { CodeHighlighter } from "./highlight.ts";
import type { ExampleEntry } from "../examples/catalogue.ts";

/** The example the hero runs (`04-examples-platform.md` §7.2). */
const HERO_SLUG = "pbr-model";

/** The hero's caption (`03` §2). */
const HERO_CAPTION =
  "Physically based rendering — a glTF model lit by an image-based environment, with bloom and tone mapping. Drag to orbit.";

/**
 * Renders one example card: poster, title, category chip, one line. The whole card is the link.
 *
 * @param entry - The catalogue entry.
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The HTML.
 */
export function exampleCard(entry: ExampleEntry, websiteRoot: string): string {
  return h("a", { class: "card card-example", href: `/examples/${entry.slug}/` }, [
    posterPicture(poster(websiteRoot, entry.slug), entry.posterAlt),
    h("div", { class: "card-body" }, [
      h("h3", { class: "card-title" }, esc(entry.title)),
      h("p", { class: "card-line" }, esc(entry.line)),
      h("div", { class: "card-foot" }, [chip(entry.category), controlIcons(entry.controls)]),
    ]),
  ]);
}

/**
 * The six examples the teaser shows: the slugs `03` §2 names that exist, then the rest of the
 * catalogue in order, so the band is full of real cards from the first wave onwards.
 *
 * @returns Up to six entries.
 */
function teaserEntries(): readonly ExampleEntry[] {
  const chosen: ExampleEntry[] = [];
  for (const slug of HOME_EXAMPLE_SLUGS) {
    const entry = findExample(slug);
    if (entry !== undefined) {
      chosen.push(entry);
    }
  }
  for (const entry of CATALOGUE) {
    if (chosen.length >= HOME_EXAMPLE_SLUGS.length) {
      break;
    }
    if (!chosen.includes(entry)) {
      chosen.push(entry);
    }
  }
  return chosen.slice(0, HOME_EXAMPLE_SLUGS.length);
}

/**
 * Renders one template card. A template with a catalogue entry is playable and shows its capture;
 * one without is still copyable, and says so, rather than showing an image that does not exist.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @param template - The template's copy.
 * @returns The HTML.
 */
function templateCard(websiteRoot: string, template: (typeof TEMPLATE_CARDS)[number]): string {
  const entry = findExample(template.name);
  const create = site.published
    ? button({
        label: "Create",
        variant: "secondary",
        icon: "copy",
        copy: `npx @ignifx/cli@latest my-game --template ${template.name}`,
        ariaLabel: `Copy the create command for the ${template.title} template`,
      })
    : button({
        label: "Copy dev command",
        variant: "secondary",
        icon: "copy",
        copy: `pnpm --filter ignifx-template-${template.name} dev`,
        ariaLabel: `Copy the dev command for the ${template.title} template`,
      });
  const media =
    entry === undefined
      ? h(
          "div",
          { class: "poster poster-missing" },
          h("p", {}, esc(`${template.title} — capture coming with the template's example page.`)),
        )
      : posterPicture(poster(websiteRoot, entry.slug), entry.posterAlt);
  return h("div", { class: "card card-template" }, [
    media,
    h("div", { class: "card-body" }, [
      h("h3", { class: "card-title" }, esc(template.title)),
      h("p", { class: "card-line" }, esc(template.line)),
      h("div", { class: "card-foot" }, [
        entry === undefined ? controlIcons(["keyboard", "gamepad", "touch"]) : controlIcons(entry.controls),
      ]),
      h(
        "div",
        { class: "card-actions" },
        join(
          entry === undefined
            ? null
            : button({ label: "Play", variant: "primary", icon: "play", href: `/examples/${template.name}/` }),
          create,
        ),
      ),
    ]),
  ]);
}

/**
 * Renders the home page body.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param websiteRoot - Absolute path to `website/`.
 * @param highlighter - The shared Shiki highlighter.
 * @returns The `<main>` contents.
 */
export function homePage(repositoryRoot: string, websiteRoot: string, highlighter: CodeHighlighter): string {
  const hero = h("section", { class: "hero" }, [
    h("div", { class: "hero-glow", "aria-hidden": "true" }),
    h("div", { class: "shell hero-shell" }, [
      h("div", { class: "hero-copy" }, [
        h("p", { class: "eyebrow" }, "Open source · TypeScript · WebGPU"),
        h("h1", { class: "hero-title" }, "Ignite your next game."),
        h(
          "p",
          { class: "hero-lead" },
          esc(
            "ignifx is an open-source TypeScript game engine built on WebGPU. Write your game as code, run it in the browser or on the desktop, and ship with physics, audio, input, UI and animation already in the box.",
          ),
        ),
        h("div", { class: "hero-actions" }, [
          button({ label: "Get started", variant: "primary", href: "/docs/getting-started/" }),
          button({ label: "See the examples", variant: "secondary", href: "/examples/" }),
        ]),
        supportPill("hero-pill"),
        h("p", { class: "hero-support" }, esc(SUPPORT_LINE)),
      ]),
      exampleFrame({
        slug: HERO_SLUG,
        title: "Physically based rendering",
        poster: poster(websiteRoot, HERO_SLUG),
        posterAlt:
          findExample(HERO_SLUG)?.posterAlt ?? "A physically based glTF model lit by an image-based environment.",
        bridge: true,
        eager: true,
        caption: HERO_CAPTION,
        link: { href: `/examples/${HERO_SLUG}/`, label: "Open this example" },
        className: "frame-hero",
        // The hero shows the running scene alone; the viewer page keeps the parameter panel.
        flags: { nopanel: "1" },
      }),
    ]),
  ]);

  const pillars = band({
    title: "Why ignifx",
    className: "band-pillars",
    body: h(
      "ul",
      { class: "grid grid-pillars" },
      each(PILLARS, (pillar) =>
        h("li", { class: "pillar" }, [
          h("span", { class: "pillar-icon" }, icon(pillar.icon)),
          h("h3", { class: "pillar-title" }, esc(pillar.title)),
          h("p", {}, md(pillar.body)),
        ]),
      ),
    ),
  });

  const code = band({
    title: "This is a complete ignifx app",
    className: "band-code",
    body: h("div", { class: "split" }, [
      h("div", { class: "split-copy" }, [
        h(
          "p",
          {},
          esc(
            "A camera, a shadow-casting light, a ground plane and a spinning cube, every asset created in code. There is no hidden project file behind it. This sample is compiled and run by the engine's documentation checks, so it cannot go stale.",
          ),
        ),
        h(
          "ul",
          { class: "ticks" },
          each(CODE_BULLETS, (bullet) => h("li", {}, [h("strong", {}, esc(bullet.title)), " ", md(bullet.body)])),
        ),
      ]),
      h(
        "div",
        { class: "split-code" },
        highlighter.render(readFirstAppSample(repositoryRoot), "ts", {
          label: "main.ts",
          caption: "compiled by the docs harness",
        }),
      ),
    ]),
  });

  const features = band({
    title: "Everything a game needs",
    lead: "Twelve subsystems, one API style, one version number. Add the ones you use.",
    className: "band-features",
    action: h("a", { class: "band-more", href: "/features/" }, ["All features", icon("chevron", "icon-next")]),
    body: h(
      "ul",
      { class: "grid grid-three" },
      each(FEATURE_CARDS, (card) =>
        h("li", { class: "card card-feature" }, [
          chip(`\`${card.chip}\``, "chip-pkg"),
          h("h3", { class: "card-title" }, esc(card.title)),
          h("p", { class: "card-line" }, esc(card.line)),
          h("a", { class: "card-more", href: exampleHref(card.seeIt, card.fallback) }, [
            "See it",
            icon("chevron", "icon-next"),
          ]),
        ]),
      ),
    ),
  });

  const templates = band({
    id: "templates",
    title: "Start from a playable game",
    lead: "Four templates, each a small finished game: title screen, pause menu, settings, rebinding, saves, and keyboard, gamepad and touch controls. Copy one and replace the game.",
    className: "band-templates",
    body: h(
      "div",
      { class: "grid grid-four" },
      each(TEMPLATE_CARDS, (template) => templateCard(websiteRoot, template)),
    ),
  });

  const teaser = band({
    title: "See it running",
    lead: "Every example runs in your browser, with its source beside it.",
    className: "band-teaser",
    action: h("a", { class: "band-more", href: "/examples/" }, ["All examples", icon("chevron", "icon-next")]),
    body: h(
      "div",
      { class: "grid grid-three" },
      each(teaserEntries(), (entry) => exampleCard(entry, websiteRoot)),
    ),
  });

  const studio = band({
    title: "Built by a studio that ships with it",
    className: "band-studio",
    body: h("div", { class: "studio" }, [
      h(
        "p",
        { class: "studio-copy" },
        esc(
          "ignifx is developed by Astrum Forge Studios, an independent game studio, and it is the engine behind the studio's own games and projects. Features arrive because a game needed them, and they stay because a game still does.",
        ),
      ),
      h("a", { class: "band-more", href: site.studio, rel: "noreferrer" }, [
        "astrumforge.com",
        icon("external", "icon-ext"),
      ]),
    ]),
  });

  const installCode = site.published
    ? "npx @ignifx/cli@latest my-game\ncd my-game && npm install && npm run dev"
    : "git clone https://github.com/astrum-forge/ignifx.git\ncd ignifx && pnpm install && pnpm build\npnpm --filter ignifx-template-3d-third-person dev";
  const installNote = site.published
    ? h(
        "p",
        { class: "install-note" },
        md(
          "The default is the top-down template; pass `--template 3d-third-person` for another. Add `--desktop` for an Electron build.",
        ),
      )
    : h("p", { class: "install-note" }, [
        "ignifx is not on npm yet. Until the first release, clone the repository and run a template from the workspace. ",
        h("a", { href: site.repo, rel: "noreferrer" }, h("strong", {}, "Watch the repository")),
        " to hear when the packages ship.",
      ]);

  const install = band({
    title: "Get started in a minute",
    className: "band-install",
    body: h("div", { class: "install" }, [
      h("div", { class: "install-code" }, [highlighter.render(installCode, "sh", { label: "shell" }), installNote]),
      h("div", { class: "install-side" }, [
        button({ label: "Read the guide", variant: "primary", href: "/docs/getting-started/" }),
        h("p", { class: "install-support" }, esc(SUPPORT_LINE)),
      ]),
    ]),
  });

  return join(hero, pillars, code, features, templates, teaser, studio, install);
}
