/**
 * Model and material examples: loading, material grids, overrides, skinning.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleAsset, ExampleOf } from "../catalogue.ts";

/**
 * The prefiltered probe three of these examples are lit by.
 *
 * @remarks
 * Written once and shared, because a licence line copied three times is a licence line that goes
 * out of date twice. `assets/ATTRIBUTION.md` is the record.
 */
const STUDIO_ENVIRONMENT: ExampleAsset = {
  name: "Studio environment",
  licence: "CC-BY 4.0",
  author: "Babylon.js contributors",
  source: "https://github.com/BabylonJS/Assets/blob/master/environments/studio.env",
};

/** The Models examples, in display order. */
export const MODELS: readonly ExampleOf<"Models">[] = [
  {
    slug: "model-loading",
    title: "Model loading",
    category: "Models",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Load and switch 3D models, track their progress and release unused assets.",
    paragraph:
      "Load three glTF models and inspect their loading state, progress and memory estimates. Switch between models, then release the ones you no longer need. The panel shows which assets the example still holds.",
    tries: [
      "Switch models and watch the loading status in the panel.",
      "Press Release the others and watch the Held count decrease.",
      "Turn the grid off to read the silhouette, then drag to orbit and scroll to zoom.",
    ],
    uses: ["app.assets.load", "AssetHandle", "Model", "Environment", "MeshAsset.ground", "app.assets.gc"],
    assets: [
      {
        name: "Lantern",
        licence: "CC0 1.0",
        author: "sbtron for Microsoft, and Frank Galligan",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern",
      },
      {
        name: "Avocado",
        licence: "CC0 1.0",
        author: "Microsoft",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado",
      },
      {
        name: "Water Bottle",
        licence: "CC0 1.0",
        author: "Microsoft",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle",
      },
      STUDIO_ENVIRONMENT,
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A wooden street lamp with a glass lantern hanging from its arm, standing on a dark grid floor and " +
      "casting a long soft shadow to the right.",
    sourceFiles: ["main.ts", "subjects.ts"],
    guide: "load-a-model",
  },
  {
    slug: "material-grid",
    title: "Roughness and metalness",
    category: "Models",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Compare smooth, rough, painted and metallic surfaces on a grid of spheres.",
    paragraph:
      "See how roughness and metalness change a material. Metalness increases from left to right, and roughness from bottom to top. Adjust each range or rotate the environment to compare the reflections.",
    tries: [
      "Set both metalness ends to one: every sphere becomes a metal, and the base colour now tints the reflection instead of the surface.",
      "Set Top row to 0.3 to compare only the smoother end of the roughness range.",
      "Rotate the environment, then add blur to soften the reflections.",
    ],
    uses: [
      "pbrMaterialDefinition",
      "createMaterialAsset",
      "MaterialAsset.setMetallicRoughness",
      "MeshAsset.sphere",
      "Environment",
    ],
    assets: [STUDIO_ENVIRONMENT],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A six-by-six grid of spheres on a dark blue-grey ground: mirror-like spheres reflecting two " +
      "soft studio panels along the bottom row, evenly diffuse ones along the top, pale plastic on the " +
      "left and dark metal on the right.",
    sourceFiles: ["main.ts"],
  },
  {
    slug: "skinned-animation",
    title: "Skinned animation",
    category: "Models",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Blend a fox’s walk and run animations, change playback speed and inspect individual poses.",
    paragraph:
      "A rigged fox demonstrates animation playback and blending. Move between walking and running, change the playback speed or drag the playhead to inspect a pose. Switch to Survey to see a transition into a different animation.",
    tries: [
      "Drag Gait from walk to run. The Mix line shows how much each animation contributes.",
      "Set Speed to zero, then drag the Playhead to inspect individual poses.",
      "Switch State to Survey and watch the animations crossfade.",
    ],
    uses: ["Model", "Animator", "defineAnimator", "AnimatorStateMachine", "Model.animations", "features.skeletons"],
    assets: [
      {
        name: "Fox",
        licence: "CC0 1.0 (model), CC-BY 4.0 (rig and glTF conversion)",
        author: "PixelMannen; rig and animation by tomkranis; conversion by @AsoboStudio and @scurest",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox",
      },
      STUDIO_ENVIRONMENT,
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A low-polygon orange fox at full stretch mid-run, fore legs forward and hind legs back, on a dark " +
      "grid floor with its shadow beneath it.",
    sourceFiles: ["main.ts", "playhead.ts"],
  },
];
