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
    line: "Emissive surfaces bleed light; threshold, weight, kernel and scale.",
    paragraph:
      "Two rows of emitters under one bloom pass. Behind: Khronos's emissive-strength test, five cubes whose glTF " +
      "materials declare the same blue at 1x, 2x, 4x, 8x and 16x, so the brightest of them sit far above white. In " +
      "front: five spheres built in code, one hue ramped over the 0-1 range an ignifx material's `emissive` field " +
      "accepts. Both rows bleed, and only the cubes reach past white — which is the difference between a glTF " +
      "extension and a hand-written material, on screen. The pass is two lines of settings and one callback: " +
      "`features.postProcessing` renders the scene into an offscreen target so an effect has something to sample, " +
      "and the effect is switched on after `app.start()`.",
    tries: [
      "Pull Threshold down and watch the dim spheres join the glow; the cubes never leave it.",
      "Widen Kernel to 128, then drop Scale to 0.1: nearly the same glow for a quarter of the blur.",
      "Turn the Lamps off. What is left is the light the emitters make, which is all bloom reads.",
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
