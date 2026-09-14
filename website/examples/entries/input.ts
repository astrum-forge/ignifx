/**
 * Input examples: actions, rebinding, touch controls.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Input examples, in display order. */
export const INPUT: readonly ExampleOf<"Input">[] = [
  {
    slug: "input-actions",
    title: "Input actions",
    category: "Input",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Drive a rover and watch keyboard, gamepad and touch input appear on a live dashboard.",
    paragraph:
      "Control a rover through named input actions. The dashboard shows movement values, button presses and the active device. Keyboard, gamepad and touch controls share the same configuration file, shown in the source below.",
    tries: [
      "Hold W and A together. The movement display keeps diagonal input at the same strength as a single direction.",
      "Squeeze a gamepad trigger slowly and watch the boost bar fill before the action counts as pressed.",
      "Press Escape to disable player controls. The device display keeps tracking input.",
    ],
    uses: [
      "app.input.loadActions",
      "validateInputActions",
      "InputAction",
      "ActionMap",
      "app.input.events",
      "app.input.currentScheme",
      "Camera.screenToRay",
    ],
    assets: [],
    controls: ["keyboard", "mouse", "gamepad", "touch"],
    posterAlt:
      "A small orange rover with four black wheels and a dark canopy stands on a grey grid floor in front of a " +
      "wide dark instrument panel on two legs. The panel carries a cluster of unlit key caps on the left, two " +
      "round dials with a dot at the centre of each, two narrow vertical tracks, four square lamps, and a row of " +
      "small status lamps along the bottom, four of them lit green and one orange.",
    sourceFiles: ["main.ts", "player.input.json", "board.ts", "rover.ts"],
    guide: "bind-an-action-and-read-it",
  },
  {
    slug: "rebinding",
    title: "Rebinding",
    category: "Input",
    dimension: "3D",
    priority: "P1",
    status: "ready",
    line: "Change a control binding and keep it after reloading the page.",
    paragraph:
      "Rebind an action to a key or gamepad button, then try the new control. The rack shows each binding and its device type. Your changes are saved locally, so they remain after a page reload.",
    tries: [
      "Press Rebind hop, then press any key: the cap goes orange for a keyboard, and the panel says which key.",
      "Rebind one to a gamepad button and watch that cap turn green while the other three stay orange.",
      "Reload the page to check that your bindings were saved. Choose Reset to defaults to clear them.",
    ],
    uses: [
      "app.input.performInteractiveRebind",
      "app.input.saveOverrides",
      "app.input.loadOverrides",
      "app.input.clearOverrides",
      "app.storage",
      "Binding.effectivePath",
      "formatBindingPath",
    ],
    assets: [],
    controls: ["keyboard", "gamepad", "mouse"],
    posterAlt:
      "Four dark plinths stand in a row on a grey grid floor, each capped with a bright orange block, and an " +
      "orange ball rests on a long dark track in front of them.",
    sourceFiles: ["main.ts", "player.input.json", "rack.ts"],
    guide: "rebind-a-key-at-runtime",
  },
];
