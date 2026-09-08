/**
 * Platform examples: saves, platform facts, the devtools overlay.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Platform examples, in display order. */
export const PLATFORM: readonly ExampleOf<"Platform">[] = [
  {
    slug: "devtools",
    title: "Devtools overlay",
    category: "Platform",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "The overlay, open on arrival, with a wave counter to watch.",
    paragraph:
      "`@ignifx/devtools` is one extension and one key. Register it, press backtick, and nine tabs appear over the " +
      "canvas: frame numbers, the entity tree, a live component inspector, asset handles, input, audio, physics, " +
      "the log and a per-phase timing graph. Every example on this site carries it; this is the one that opens it " +
      "for you, pointed at the `Director` entity, whose serialised fields are rows you can edit. Closed, it costs " +
      "nothing — no system runs and no DOM exists until `open()` — which is why a game registers it behind a " +
      "development flag and forgets about it.",
    tries: [
      "Type a new number into the Inspector's `waveSeconds` row and watch the wave clock follow it.",
      "Open Stats for draw calls and engine CPU, then Timeline for the same frame, phase by phase.",
      "Select a drone in the Scene tab: the Inspector follows, down to its live transform.",
    ],
    uses: ["devtools", "app.devtools", "app.diagnostics", "Script", "MeshRenderer"],
    assets: [],
    controls: ["mouse", "keyboard", "touch", "gamepad"],
    posterAlt:
      "A ring of small blue capsules orbiting a lit orange pylon on a grid floor, with the ignifx devtools overlay " +
      "docked down the left of the frame: a strip of nine tabs above an Inspector listing the Director entity's " +
      "transform and its wave, spawned, alive and score fields.",
    sourceFiles: ["main.ts", "director.ts", "ring.ts"],
    guide: "show-diagnostics-in-devtools",
  },
];
