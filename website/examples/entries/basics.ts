/**
 * Examples of the kernel: the smallest apps, cameras, transforms, the frame.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Basics examples, in display order. */
export const BASICS: readonly ExampleOf<"Basics">[] = [
  {
    slug: "hello-cube",
    title: "Hello cube",
    category: "Basics",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Start with a spinning cube, a camera and lights, all created in code.",
    paragraph:
      "A small scene with a spinning cube, an orbit camera and lights. Change the cube’s speed and colour while it runs. The scene is created entirely in code, with no model or texture files to load.",
    tries: [
      "Drag the spin slider and watch the cube change pace without a reload.",
      "Change the cube's colour: one material, edited live, with no shader rebuild.",
      "Press backtick to open the devtools overlay and select the cube in the scene tree.",
    ],
    uses: ["createApp", "Script.define", "Camera", "Light", "MeshRenderer", "MeshAsset", "createMaterialAsset"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "An orange cube casting a soft shadow on a dark grey floor, lit from the upper left, seen from slightly above.",
    sourceFiles: ["main.ts"],
  },
];
