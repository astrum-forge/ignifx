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
    line: "Inspect scene objects, edit values and watch performance while the game runs.",
    paragraph:
      "The developer tools open with this example. Explore the scene tree, edit the Director’s fields and watch the wave timing change. Use the other tabs to inspect performance, assets, input, audio and physics.",
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
