/**
 * The example frame: a 16:9 `<iframe>` of `/examples/<slug>/run/` with a poster over it and a
 * toolbar under it (`02-design-system.md` §3 and §4.4, `04-examples-platform.md` §3).
 *
 * The home page's hero and every viewer page use the same markup, so `src/viewer.ts` has one
 * contract to honour and no per-example code exists anywhere on the site. The `data-` attributes
 * below **are** that contract:
 *
 * | Attribute            | Meaning                                                                  |
 * | -------------------- | ------------------------------------------------------------------------ |
 * | `data-viewer`        | The root the script binds to.                                            |
 * | `data-slug`          | Which example, for the standalone link and for messages.                 |
 * | `data-bridge`        | `on` when the frame speaks the kit's `postMessage` protocol, `off` for a  |
 * |                      | template, whose run page is its own Vite build and has no kit bridge.    |
 * | `data-frame`         | The `<iframe>`.                                                          |
 * | `data-frame-cover`   | The poster layer, hidden once the app is ready.                           |
 * | `data-frame-start`   | The Play button reduced-motion visitors get.                             |
 * | `data-frame-toggle`  | Play/Pause.                                                              |
 * | `data-frame-full`    | Fullscreen.                                                              |
 * | `data-frame-stats`   | Where `<n> ms engine CPU · <n> draw calls` is written.                   |
 */
import { posterPicture } from "./components.ts";
import { esc, h, join } from "./html.ts";
import { icon } from "./icons.ts";
import type { Poster } from "./examples.ts";

/**
 * What the live figure means, on the element that carries it.
 *
 * The kit reports **engine CPU** milliseconds — the sum of `FrameSample.cpuMs` over a frame's
 * phases, median of the last 30 frames — not wall-clock frame time and not GPU time
 * (`website/examples/_kit/bridge.ts`, "Which millisecond `frameMs` reports"). The label says so, so
 * the number on the site and the number in `benchmarks/baselines.json` mean the same thing.
 */
export const STATS_TITLE = "Engine CPU time per frame, median of the last 30 frames";

/** One example frame. */
export interface FrameInput {
  /** The example's slug. */
  readonly slug: string;
  /** The example's title, used in the iframe's accessible name. */
  readonly title: string;
  /** The committed poster. */
  readonly poster: Poster;
  /** Alt text for the poster. */
  readonly posterAlt: string;
  /** Whether the frame speaks the kit's bridge protocol. `false` for a template. */
  readonly bridge: boolean;
  /** `loading="eager"` on the home page and the viewer page; lazy nowhere else. */
  readonly eager: boolean;
  /** A caption rendered in the toolbar, in place of the metrics, on the home page. */
  readonly caption?: string;
  /** A trailing link in the toolbar, e.g. "Open this example →". */
  readonly link?: { readonly href: string; readonly label: string };
  /** Extra class on the root. */
  readonly className?: string;
  /**
   * Kit query flags appended to the frame's `src` only — never to the standalone link, which must
   * open the whole example. The home page passes `nopanel=1` so the hero shows the running scene
   * alone (`02-design-system.md` §4.1); `src/viewer.ts` adds `autoplay=0` on top for a
   * reduced-motion visitor, which is why these are real query parameters rather than a suffix.
   */
  readonly flags?: Readonly<Record<string, string>>;
}

/**
 * Renders the frame and its toolbar.
 *
 * @param input - Which example, and how the toolbar is dressed.
 * @returns The HTML.
 */
export function exampleFrame(input: FrameInput): string {
  const runUrl = `/examples/${input.slug}/run/`;
  const flags = new URLSearchParams(input.flags ?? {}).toString();
  const frameUrl = flags === "" ? runUrl : `${runUrl}?${flags}`;
  const controls = join(
    input.bridge
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-ghost frame-btn js-only",
            "data-frame-toggle": true,
            "aria-label": "Pause the example",
          },
          [icon("pause", "icon-pause"), icon("play", "icon-play"), h("span", { class: "btn-text" }, "Pause")],
        )
      : null,
    h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost frame-btn js-only",
        "data-frame-full": true,
        "aria-label": "Show the example fullscreen",
      },
      [icon("fullscreen"), h("span", { class: "btn-text" }, "Fullscreen")],
    ),
    h("a", { class: "btn btn-ghost frame-btn", href: runUrl }, [
      icon("external"),
      h("span", { class: "btn-text" }, "Open standalone"),
    ]),
    h("p", { class: "frame-hint" }, [h("kbd", {}, "`"), " devtools"]),
  );
  const trailing = join(
    input.caption === undefined ? null : h("p", { class: "frame-caption" }, esc(input.caption)),
    input.bridge
      ? h("p", { class: "frame-stats js-only", "data-frame-stats": true, "aria-live": "off", title: STATS_TITLE }, "")
      : null,
    input.link === undefined
      ? null
      : h("a", { class: "frame-link", href: input.link.href }, [esc(input.link.label), icon("chevron", "icon-next")]),
  );
  return h(
    "div",
    {
      class: input.className === undefined ? "frame" : `frame ${input.className}`,
      "data-viewer": true,
      "data-slug": input.slug,
      "data-bridge": input.bridge ? "on" : "off",
    },
    [
      h("div", { class: "frame-box" }, [
        h("iframe", {
          class: "frame-app",
          "data-frame": true,
          src: frameUrl,
          title: `Interactive example: ${input.title}`,
          loading: input.eager ? "eager" : "lazy",
          allow: "fullscreen; gamepad; pointer-lock",
        }),
        h("div", { class: "frame-cover", "data-frame-cover": true }, [
          posterPicture(input.poster, input.posterAlt, input.eager),
          h(
            "button",
            { type: "button", class: "btn btn-primary frame-play js-only", "data-frame-start": true, hidden: true },
            [icon("play"), h("span", { class: "btn-text" }, "Play")],
          ),
        ]),
      ]),
      h("div", { class: input.caption === undefined ? "frame-bar" : "frame-bar frame-bar-stacked" }, [
        h("div", { class: "frame-controls" }, controls),
        h("div", { class: "frame-meta" }, trailing),
      ]),
    ],
  );
}
