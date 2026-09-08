/**
 * UI examples: the overlay, menus, loading screens, translations.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The UI examples, in display order. */
export const UI: readonly ExampleOf<"UI">[] = [
  {
    slug: "ui-overlay",
    title: "UI overlay",
    category: "UI",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A HUD, a dialog and toasts in HTML, over a scene you can still see.",
    paragraph:
      "Game UI in ignifx is HTML. `@ignifx/ui` puts one positioned element over the canvas and hands your game " +
      "named layers inside it, so a HUD is a `div`, a modal is a `Dialog` and a message is a `Toast` — real fonts, " +
      "real layout, screen readers, any framework you already know. The score in the corner is the exception: " +
      "`HudText` is drawn by the GPU in backing-store pixels, for text that has to line up with a screenshot. The " +
      "Scaling select decides what a UI unit is, and the notch toggle shows a desktop what a phone reports.",
    tries: [
      "Switch Scaling to fit: every HTML part of the overlay rescales together, and the GPU score does not.",
      "Turn on “Simulate a notch” and watch the HUD move inside the four safe-area insets.",
      "Open the dialog. It pauses the game, and the toast it raises still expires — that script runs while paused.",
    ],
    uses: ["app.ui", "Dialog", "Toast", "HudText", "UI_CSS_VARIABLES", "Script"],
    assets: [
      {
        name: "Share Tech Mono",
        licence: "OFL-1.1",
        author: "Carrois Type Design, Ralph du Carrois",
        source: "https://github.com/google/fonts/tree/main/ofl/sharetechmono",
      },
    ],
    controls: ["mouse", "keyboard", "touch", "gamepad"],
    posterAlt:
      "Three copper shapes turning on a grid floor, with an orange pixel-font score reading SCORE 001200 in the " +
      "top-left corner and a small readout panel below it listing the overlay's scaling mode, unit, size and scale.",
    sourceFiles: ["main.ts", "hud.ts", "props.ts", "hud.css"],
  },
];
