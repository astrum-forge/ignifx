/**
 * The icon set as one inline SVG sprite (`website/plan/02-design-system.md` §2.7).
 *
 * Nineteen icons, drawn on a 20-unit grid with a 1.5-unit stroke in `currentColor`, plus the two
 * brand marks (GitHub, npm), which have no stroked form and are filled paths on a 24-unit grid.
 * They are `<symbol>`s in a hidden `<svg>` at the top of `<body>`, referenced with
 * `<svg><use href="#icon-…"></svg>`: one definition per document, no external file, no `data:` URI,
 * and nothing for the Content-Security-Policy to refuse.
 */
import { each, h } from "./html.ts";

/** Every icon the pages may reference, in the order the sprite defines them. */
export const ICON_NAMES = [
  "github",
  "npm",
  "external",
  "copy",
  "check",
  "play",
  "pause",
  "fullscreen",
  "code",
  "download",
  "moon",
  "sun",
  "menu",
  "close",
  "chevron",
  "gamepad",
  "keyboard",
  "touch",
  "mouse",
] as const;

/** One of {@link ICON_NAMES}. */
export type IconName = (typeof ICON_NAMES)[number];

/** One symbol: its viewBox and the geometry inside it. */
interface IconShape {
  /** The symbol's `viewBox`. */
  readonly viewBox: string;
  /** Whether the geometry is filled (brand marks) rather than stroked. */
  readonly filled: boolean;
  /** The child elements. */
  readonly body: string;
}

/** `d` attribute helper, so the table below stays a table. */
const p = (d: string): string => h("path", { d });

/** The nineteen shapes, keyed by name. */
const SHAPES: Readonly<Record<IconName, IconShape>> = {
  github: {
    viewBox: "0 0 24 24",
    filled: true,
    body: p(
      "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
    ),
  },
  npm: {
    viewBox: "0 0 24 24",
    filled: true,
    body: p(
      "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
    ),
  },
  external: {
    viewBox: "0 0 20 20",
    filled: false,
    body: p(
      "M11.5 3.5h5v5M16.5 3.5 9 11M13 12v3.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7H8",
    ),
  },
  copy: {
    viewBox: "0 0 20 20",
    filled: false,
    body:
      h("path", {
        d: "M3.25 7.75A1.5 1.5 0 0 1 4.75 6.25h6.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5z",
      }) + p("M6.75 3.75h8a1.5 1.5 0 0 1 1.5 1.5v8"),
  },
  check: { viewBox: "0 0 20 20", filled: false, body: p("m4 10.5 4 4 8-9") },
  play: { viewBox: "0 0 20 20", filled: true, body: p("M6.5 3.9 16 10l-9.5 6.1z") },
  pause: { viewBox: "0 0 20 20", filled: true, body: p("M6 4h2.75v12H6zM11.25 4H14v12h-2.75z") },
  fullscreen: {
    viewBox: "0 0 20 20",
    filled: false,
    body: p("M3.25 7.5v-4.25H7.5M16.75 7.5V3.25H12.5M3.25 12.5v4.25H7.5M16.75 12.5v4.25H12.5"),
  },
  code: { viewBox: "0 0 20 20", filled: false, body: p("M7.5 5.5 3.25 10l4.25 4.5M12.5 5.5 16.75 10l-4.25 4.5") },
  download: { viewBox: "0 0 20 20", filled: false, body: p("M10 3v9m-4-4 4 4 4-4M3.5 16.5h13") },
  moon: {
    viewBox: "0 0 20 20",
    filled: false,
    body: p("M16.25 12.6A6.85 6.85 0 0 1 7.4 3.75a6.9 6.9 0 1 0 8.85 8.85Z"),
  },
  sun: {
    viewBox: "0 0 20 20",
    filled: false,
    body:
      h("circle", { cx: 10, cy: 10, r: 3.4 }) +
      p(
        "M10 1.75v1.9M10 16.35v1.9M1.75 10h1.9M16.35 10h1.9M4.16 4.16 5.5 5.5M14.5 14.5l1.34 1.34M15.84 4.16 14.5 5.5M5.5 14.5l-1.34 1.34",
      ),
  },
  menu: { viewBox: "0 0 20 20", filled: false, body: p("M3 5.5h14M3 10h14M3 14.5h14") },
  close: { viewBox: "0 0 20 20", filled: false, body: p("m5 5 10 10M15 5 5 15") },
  chevron: { viewBox: "0 0 20 20", filled: false, body: p("m5.5 8 4.5 4.5L14.5 8") },
  gamepad: {
    viewBox: "0 0 20 20",
    filled: false,
    body:
      h("path", {
        d: "M6.5 6.25h7a3.75 3.75 0 0 1 3.75 3.75 3.75 3.75 0 0 1-6.4 2.65l-.6-.6h-.5l-.6.6A3.75 3.75 0 0 1 2.75 10 3.75 3.75 0 0 1 6.5 6.25Z",
      }) + p("M5.15 8.8v2.4M3.95 10h2.4M13.2 9.4h.01M14.9 11h.01"),
  },
  keyboard: {
    viewBox: "0 0 20 20",
    filled: false,
    body:
      h("path", {
        d: "M2.75 5.75a1.5 1.5 0 0 1 1.5-1.5h11.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z",
      }) +
      p(
        "M5.25 8h.01M8 8h.01M10.75 8h.01M13.5 8h.01M5.25 10.6h.01M8 10.6h.01M10.75 10.6h.01M13.5 10.6h.01M6.75 13.1h6.5",
      ),
  },
  touch: {
    viewBox: "0 0 20 20",
    filled: false,
    body: h("circle", { cx: 10, cy: 10, r: 2.5 }) + p("M5.4 14.6a6.5 6.5 0 0 1 0-9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2"),
  },
  mouse: {
    viewBox: "0 0 20 20",
    filled: false,
    body: h("path", { d: "M6.25 6.75a3.75 3.75 0 0 1 7.5 0v6.5a3.75 3.75 0 0 1-7.5 0z" }) + p("M10 3.25v4"),
  },
};

/**
 * Renders the sprite: every symbol once, in a document-hidden `<svg>`.
 *
 * @returns The sprite HTML, to place first inside `<body>`.
 */
export function iconSprite(): string {
  const symbols = each(ICON_NAMES, (name) => {
    const shape = SHAPES[name];
    return h(
      "symbol",
      {
        id: `icon-${name}`,
        viewBox: shape.viewBox,
        fill: shape.filled ? "currentColor" : "none",
        "fill-rule": shape.filled ? "evenodd" : null,
        stroke: shape.filled ? null : "currentColor",
        "stroke-width": shape.filled ? null : 1.5,
        "stroke-linecap": shape.filled ? null : "round",
        "stroke-linejoin": shape.filled ? null : "round",
      },
      shape.body,
    );
  });
  return h("svg", { class: "sprite", "aria-hidden": "true", focusable: "false" }, h("defs", {}, symbols));
}

/**
 * References one icon from the sprite.
 *
 * Icons are decorative: they sit beside a text label, or inside a control that carries an
 * `aria-label`. They are therefore always `aria-hidden` (`02-design-system.md` §6: colour and
 * shape never carry meaning alone).
 *
 * @param name - The icon.
 * @param className - Extra class, e.g. `"icon-lg"`.
 * @returns The `<svg>` HTML.
 */
export function icon(name: IconName, className?: string): string {
  return h(
    "svg",
    { class: className === undefined ? "icon" : `icon ${className}`, "aria-hidden": "true", focusable: "false" },
    h("use", { href: `#icon-${name}` }),
  );
}

/** The brand-mark PNG sizes generated by `website/brand/build.ts`. */
const MARK_SIZES = [32, 64, 96, 128, 256, 512] as const;

/** One of {@link MARK_SIZES}. */
export type MarkSize = (typeof MARK_SIZES)[number];

/**
 * The ignifx mark.
 *
 * The vector master stays sharp on high-density displays.
 * The mark is above the fold, so it is not lazy-loaded.
 *
 * It is decorative: the lockup's link carries `aria-label="ignifx home"` and the wordmark sits beside
 * it as real text, so the image is hidden from assistive technology rather than described twice.
 *
 * @param size - Intrinsic width and height in pixels.
 * @param className - Extra class.
 * @returns The `<img>` HTML.
 */
export function markImg(size: MarkSize, className = "mark"): string {
  return h("img", {
    class: className,
    src: "/brand/mark.svg",
    width: size,
    height: size,
    alt: "",
    "aria-hidden": "true",
    decoding: "async",
  });
}
