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
    line: "Load a glTF, watch it arrive, swap it for another, and hand the memory back.",
    paragraph:
      "Three sample models of wildly different sizes, on one metre of grid per metre of world. " +
      "`app.assets.load` answers with a handle straight away — still loading, with a progress between " +
      "zero and one — and the Handle group is that handle's own fields, read four times a second: its " +
      "address, its state, its progress, how many holders it has, and how many bytes the models it is " +
      "holding weigh. Every load needs one release, and Release the others is what that looks like.",
    tries: [
      "Switch the model: a handle asked for the first time is still loading when it is assigned, so the model lands a frame or two later.",
      "Press Release the others and watch the Held readout drop: the bytes go back when the last holder lets go.",
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
    line: "Thirty-six spheres from one mesh: metalness across, roughness up, every value live.",
    paragraph:
      "The two numbers that decide what a physically based surface looks like, laid out so the whole " +
      "parameter space is on screen at once. Metalness runs left to right and roughness bottom to top; " +
      "the sliders move each axis's two ends, so you can compress the grid onto any patch of the space " +
      "and compare. The light is a prefiltered studio probe with a modest key and fill behind it, " +
      "because a metal has no diffuse term and shows only its surroundings — the soft highlights down " +
      "the right-hand column are the probe's own softboxes, and roughness is what blurs them. Nothing " +
      "else is loaded: the mesh is `MeshAsset.sphere` and the thirty-six materials are " +
      "`pbrMaterialDefinition` records edited live, which costs uniform writes and no shader work.",
    tries: [
      "Set both metalness ends to one: every sphere becomes a metal, and the base colour now tints the reflection instead of the surface.",
      "Pull Top row down to 0.3 and the roughness axis compresses onto the range a real product is authored in.",
      "Rotate the probe, then blur it: a metal has nothing to show but what is around it, so blurring the probe is what turns the bottom-right mirror into satin.",
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
    line: "A rigged fox with three clips: pick one, blend two, change the rate, drag the playhead.",
    paragraph:
      "The Khronos Fox ships three animations — Survey, Walk and Run — and core does not play them: " +
      "`ModelAsset` strips the clips off the loaded glTF and `Animator`, from `@ignifx/3d`, runs a state " +
      "machine document over them. The document here is the smallest one that means anything: one float, " +
      "one layer, two states and a one-dimensional blend tree. Gait moves along the tree and weights Walk " +
      "against Run on one shared cursor; the Mix readout is those weights, live.",
    tries: [
      "Drag Gait from walk to run and read the Mix line: two clips at once, phase-locked, with no call to blend them.",
      "Set Speed to zero and drag the Playhead: the pose is recomputed from the state machine's cursor every frame, so seeking is moving the cursor.",
      "Switch the State to Survey: a crossfade does not care that the two clips are 1.16 and 3.42 seconds long.",
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
