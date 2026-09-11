/**
 * Post-processing examples: bloom, anti-aliasing, grading, the full stack.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Post-processing examples, in display order. */
export const POST_PROCESSING: readonly ExampleOf<"Post-processing">[] = [
  {
    slug: "bloom",
    title: "Bloom",
    category: "Post-processing",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Add a glow around bright objects and adjust its strength and spread.",
    paragraph:
      "Bloom adds a glow around bright surfaces. Compare glowing cubes loaded from a glTF model with spheres created in code. Adjust the threshold to choose which surfaces glow, then change the strength and spread of the effect.",
    tries: [
      "Pull Threshold down and watch the dim spheres join the glow; the cubes never leave it.",
      "Set Kernel to 128 for a wider glow, then lower Scale to compare its appearance.",
      "Turn Lamps off to see the glowing materials without the scene lights.",
    ],
    uses: ["PostProcessStack", "features.postProcessing", "Environment", "Model", "MeshRenderer"],
    assets: [
      {
        name: "EmissiveStrengthTest",
        licence: "CC-BY 4.0",
        author: "Ed Mackey, AGI",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/EmissiveStrengthTest",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Ten emitters on a near-black floor: a back row of five small cubes running from a white-hot glow on the left " +
      "to a plain blue one on the right, and a front row of five spheres running from near-black on the left to a " +
      "glowing amber on the right.",
    sourceFiles: ["main.ts", "rows.ts"],
  },
];
