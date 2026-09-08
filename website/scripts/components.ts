/**
 * The component set of `website/plan/02-design-system.md` §3, as functions that return HTML.
 *
 * There is no component framework: a component is a function, its states are classes, and
 * `src/styles/` holds the rules. Nothing here emits a `style` attribute or an inline `<script>`,
 * which is what lets the site keep a Content-Security-Policy with no `unsafe-inline`.
 */
import { each, esc, h, join, md } from "./html.ts";
import { icon } from "./icons.ts";
import type { Poster } from "./examples.ts";
import type { IconName } from "./icons.ts";

/** The three button weights of `02` §3. */
export type ButtonVariant = "primary" | "secondary" | "ghost";

/** One button or button-shaped link. */
export interface ButtonInput {
  /** The label. Rendered through {@link md}, so it may hold `code`. */
  readonly label: string;
  /** Destination; omit for a `<button>`. */
  readonly href?: string;
  /** Weight. */
  readonly variant?: ButtonVariant;
  /** Leading icon. */
  readonly icon?: IconName;
  /** Trailing icon, e.g. `external` on an outbound link. */
  readonly trailing?: IconName;
  /** Text to put on the clipboard when pressed; makes it a `<button>` that needs JavaScript. */
  readonly copy?: string;
  /** Extra class. */
  readonly className?: string;
  /** `aria-label`, when the visible label is not enough on its own. */
  readonly ariaLabel?: string;
}

/**
 * Renders a button or a button-shaped link.
 *
 * @param input - Label, destination and weight.
 * @returns The HTML.
 */
export function button(input: ButtonInput): string {
  const variant = input.variant ?? "secondary";
  const classes = `btn btn-${variant}${input.className === undefined ? "" : ` ${input.className}`}`;
  const body = join(
    input.icon === undefined ? null : icon(input.icon),
    h("span", { class: "btn-text" }, md(input.label)),
    input.trailing === undefined ? null : icon(input.trailing),
  );
  if (input.copy !== undefined) {
    return h(
      "button",
      {
        type: "button",
        class: `${classes} js-only`,
        "data-copy-text": input.copy,
        "aria-label": input.ariaLabel ?? null,
      },
      body,
    );
  }
  if (input.href === undefined) {
    return h("button", { type: "button", class: classes, "aria-label": input.ariaLabel ?? null }, body);
  }
  const external = input.href.startsWith("http") || input.href.startsWith("mailto:");
  return h(
    "a",
    {
      class: classes,
      href: input.href,
      rel: external ? "noreferrer" : null,
      "aria-label": input.ariaLabel ?? null,
    },
    body,
  );
}

/**
 * The WebGPU support pill (`02` §3, `03` §1).
 *
 * Without JavaScript it reads "WebGPU: checking…", which is honest: the page cannot know. With
 * JavaScript, `src/main.ts` asks for an adapter and rewrites the text, colours the dot, and reveals
 * the link to the support page. Colour is never the only carrier: the words change too.
 *
 * @param className - Extra class, e.g. `hero-pill`.
 * @returns The pill HTML.
 */
export function supportPill(className?: string): string {
  return h(
    "p",
    { class: className === undefined ? "pill pill-support" : `pill pill-support ${className}`, "data-support": true },
    [
      h("span", { class: "pill-dot", "aria-hidden": "true" }),
      h("span", { "data-support-text": true }, "WebGPU: checking…"),
      h("a", { class: "pill-link", href: "/docs/browser-support/", hidden: true, "data-support-link": true }, [
        "See browser support",
        icon("chevron", "icon-next"),
      ]),
    ],
  );
}

/** One page band: an optional eyebrow, a heading, an optional lead, and a body. */
export interface BandInput {
  /** The section `id`. */
  readonly id?: string;
  /** Small label above the heading. */
  readonly eyebrow?: string;
  /** The `h2` text, in the {@link md} subset. */
  readonly title: string;
  /** The lead paragraph, in the {@link md} subset. */
  readonly lead?: string;
  /** The body HTML. */
  readonly body: string;
  /** A link rendered at the end of the band's header row, e.g. "All features →". */
  readonly action?: string;
  /** Extra class on the `<section>`. */
  readonly className?: string;
}

/**
 * Renders one page band.
 *
 * @param input - Its heading, lead and body.
 * @returns The `<section>` HTML.
 */
export function band(input: BandInput): string {
  return h(
    "section",
    { class: input.className === undefined ? "band" : `band ${input.className}`, id: input.id ?? null },
    [
      h("div", { class: "shell" }, [
        h("div", { class: "band-head" }, [
          h(
            "div",
            { class: "band-head-text" },
            join(
              input.eyebrow === undefined ? null : h("p", { class: "eyebrow" }, md(input.eyebrow)),
              h("h2", { class: "band-title" }, md(input.title)),
              input.lead === undefined ? null : h("p", { class: "band-lead" }, md(input.lead)),
            ),
          ),
          input.action === undefined ? "" : h("div", { class: "band-action" }, input.action),
        ]),
        input.body,
      ]),
    ],
  );
}

/**
 * A small pill of metadata: a category, a package name, a dimension.
 *
 * @param label - The text, in the {@link md} subset.
 * @param className - Extra class.
 * @returns The HTML.
 */
export function chip(label: string, className?: string): string {
  return h("span", { class: className === undefined ? "chip" : `chip ${className}` }, md(label));
}

/**
 * A note or caution callout (`02` §3).
 *
 * @param kind - `note` uses the flame rule, `caution` the warning rule.
 * @param body - The body HTML.
 * @returns The HTML.
 */
export function callout(kind: "note" | "caution", body: string): string {
  return h("div", { class: `callout callout-${kind}` }, body);
}

/**
 * A table inside its own horizontal scroller, so a wide table never scrolls the page.
 *
 * @param headers - Column headings, in the {@link md} subset.
 * @param rows - Cell contents, in the {@link md} subset.
 * @param label - The scroller's accessible name.
 * @returns The HTML.
 */
export function dataTable(headers: readonly string[], rows: readonly (readonly string[])[], label: string): string {
  return h("div", { class: "scroller", role: "region", tabindex: "0", "aria-label": label }, [
    h("table", {}, [
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          each(headers, (cell) => h("th", { scope: "col" }, md(cell))),
        ),
      ),
      h(
        "tbody",
        {},
        each(rows, (cells) =>
          h(
            "tr",
            {},
            each(cells, (cell) => h("td", {}, md(cell))),
          ),
        ),
      ),
    ]),
  ]);
}

/**
 * A committed poster as a `<picture>` with AVIF and WebP sources and a PNG fallback.
 *
 * When a format is missing — which only happens in a development build, because the production
 * build fails first — a bordered well takes its place, so the page still lays out and the gap is
 * visible rather than a broken image.
 *
 * @param item - The resolved poster.
 * @param alt - Alt text: what is on screen, as a sentence.
 * @param eager - Set for the one above-the-fold image on a page.
 * @returns The HTML.
 */
export function posterPicture(item: Poster, alt: string, eager = false): string {
  if (!item.complete) {
    return h("div", { class: "poster poster-missing" }, h("p", {}, esc(alt)));
  }
  return h("picture", { class: "poster" }, [
    each(item.sources, (source) => h("source", { srcset: source.url, type: source.type })),
    h("img", {
      src: item.fallback,
      alt,
      width: 1280,
      height: 720,
      loading: eager ? "eager" : "lazy",
      decoding: "async",
    }),
  ]);
}

/** The four input devices an example may respond to, as icons with labels. */
const CONTROL_ICONS: Readonly<Record<string, { readonly icon: IconName; readonly label: string }>> = {
  keyboard: { icon: "keyboard", label: "Keyboard" },
  mouse: { icon: "mouse", label: "Mouse" },
  gamepad: { icon: "gamepad", label: "Gamepad" },
  touch: { icon: "touch", label: "Touch" },
};

/**
 * The control-device row shown on an example card and a template card.
 *
 * @param controls - Device names from the catalogue.
 * @returns The HTML, or an empty string when the example takes no input.
 */
export function controlIcons(controls: readonly string[]): string {
  const known = controls.filter((name) => name in CONTROL_ICONS);
  if (known.length === 0) {
    return "";
  }
  return h(
    "ul",
    { class: "controls", "aria-label": "Input devices" },
    each(known, (name) => {
      const entry = CONTROL_ICONS[name];
      return entry === undefined
        ? ""
        : h("li", { title: entry.label }, [icon(entry.icon), h("span", { class: "sr" }, entry.label)]);
    }),
  );
}
