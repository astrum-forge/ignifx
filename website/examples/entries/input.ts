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
    line: "Every device and every action, live: one document binds them, a board shows what they resolved.",
    paragraph:
      "Nothing in this program names a key. `player.input.json` beside `main.ts` is the whole input " +
      "configuration — two maps, three control schemes, all three composites (`2DVector` for WASD, `1DAxis` for Q " +
      "and E, `ButtonWithModifier` for shift-W) and the processors that make a stick and a keyboard agree. The " +
      "board behind the rover is that document made visible: key caps light from the `move` action, the two dials " +
      "are its `vector2` values inside their dead-zone rings, the bars are its axes, and the strip along the " +
      "bottom shows which device produced input last, which control scheme that selected, and whether the " +
      "`Player` map is enabled. The rover in front reads the same actions and drives on them.",
    tries: [
      "Hold W and A together: the dot sits on the ring, not past it, because a normalise processor keeps a diagonal at one.",
      "Squeeze a gamepad trigger slowly and watch the boost bar fill before the action counts as pressed.",
      "Press Escape: the Player map switches off, every gate and lamp on it goes dead, and the device row keeps reading.",
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
    line: "Press a control, rebind an action, and keep it: the override is saved and survives a reload.",
    paragraph:
      "The three steps a settings screen has. `performInteractiveRebind` listens for the next control the player " +
      "touches and writes it onto one binding as an override; `saveOverrides()` produces a small " +
      "`ignifx.inputoverrides` document — the overrides only, not the whole action document — and `app.storage` " +
      "keeps it, so a rebind is still there when the page is reloaded. Each cap on the rack takes the colour of " +
      "the device family its binding names, so rebinding one to a gamepad button turns it from orange to green " +
      "without a word of text, and the puck in front is what the four actions actually do.",
    tries: [
      "Press Rebind hop, then press any key: the cap goes orange for a keyboard, and the panel says which key.",
      "Rebind one to a gamepad button and watch that cap turn green while the other three stay orange.",
      "Reload the page: the rebinding is still there, because it went to app.storage. Reset to defaults clears it.",
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
