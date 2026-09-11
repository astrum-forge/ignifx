/**
 * Lighting and environment examples: light types, shadows, image-based lighting, tone mapping.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleAsset, ExampleOf } from "../catalogue.ts";

/** The Babylon.js studio probe, which three examples in this category light themselves with. */
const STUDIO_ENVIRONMENT: ExampleAsset = {
  name: "Studio environment",
  licence: "CC-BY 4.0",
  author: "Babylon.js contributors",
  source: "https://github.com/BabylonJS/Assets/blob/master/environments/studio.env",
};

/** The Lighting examples, in display order. */
export const LIGHTING: readonly ExampleOf<"Lighting">[] = [
  {
    slug: "lights",
    title: "Light types",
    category: "Lighting",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Compare four types of light and adjust their colour, strength and reach.",
    paragraph:
      "Explore directional, point, spot and hemispheric lights. Each has a visible marker showing its position, direction or range. Turn lights on and off to see how each one changes the scene.",
    tries: [
      "Turn every lamp off but one, then bring the others back one at a time.",
      "Widen the spot light's cone angle and soften its edge; the cone gizmo follows both.",
      "Drag the point light's range and watch the ring on the floor grow with it.",
    ],
    uses: ["Light", "Light.shadows", "MeshAsset", "createMaterialAsset", "Script.define", "Camera"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Five pale primitives on a dark grid floor, lit from the upper left by a warm sun whose arrow gizmo hangs " +
      "above them, with a blue point light orbiting inside a wide range ring and an orange spot light throwing a " +
      "visible cone across the right of the frame.",
    sourceFiles: ["main.ts", "gizmos.ts", "scene.ts"],
  },
  {
    slug: "shadows",
    title: "Shadows",
    category: "Lighting",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Compare shadow techniques and adjust their softness, detail and distance.",
    paragraph:
      "Compare shadows on moving shapes and a row of distant pillars. Adjust the shadow settings to see the balance between detail, softness and visible artefacts. Changing the technique rebuilds the shadows; choosing cascades reloads the example.",
    tries: [
      "Pull the normal bias to zero and watch the sphere stripe itself with its own shadow.",
      "Raise the depth bias until the shadows detach from the shapes that threw them.",
      "Switch the technique to ESM for a softer edge, or to cascades, which reloads the frame.",
    ],
    uses: ["Light.shadows", "features.shadows", "Light.isCastingShadows", "Script.define", "MeshAsset"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A sphere, a torus, a box and a capsule standing on a pale grid floor in daylight, each with a soft shadow " +
      "stretching to the right, and a line of five pillars receding into the distance with shadows of their own.",
    sourceFiles: ["main.ts", "rebuild.ts", "scene.ts"],
  },
  {
    slug: "ibl",
    title: "Image-based lighting",
    category: "Lighting",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Light a scene with environment images and see how surfaces reflect their surroundings.",
    paragraph:
      "The lighting in this scene comes from environment images. Compare metal and painted spheres at different roughness levels. Switch environments, rotate them or add blur to see how the reflections change.",
    tries: [
      "Switch the environment from Studio to Bridge and compare the lighting.",
      "Rotate the environment and watch every reflection in the row turn with it.",
      "Raise Blur to soften the reflections on the smooth spheres.",
    ],
    uses: ["Environment", "Environment.rotation", "Environment.blur", "app.assets.load", "pbrMaterialDefinition"],
    assets: [
      STUDIO_ENVIRONMENT,
      {
        name: "San Giuseppe bridge environment",
        licence: "CC-BY 4.0",
        author: "Babylon.js contributors",
        source: "https://github.com/BabylonJS/Assets/blob/master/environments/sanGiuseppeBridge.env",
      },
      {
        name: "Ulm Minster environment",
        licence: "CC-BY 4.0",
        author: "Babylon.js contributors",
        source: "https://github.com/BabylonJS/Assets/blob/master/environments/ulmerMuenster.env",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Two staggered rows of spheres on a dark studio floor: seven metal ones in front running from a mirror that " +
      "reflects the studio's softboxes to a matte grey, and seven blue painted ones behind them doing the same.",
    sourceFiles: ["main.ts", "scene.ts"],
  },
  {
    slug: "tone-mapping",
    title: "Tone mapping and exposure",
    category: "Lighting",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Compare how tone mapping, exposure and contrast change the finished image.",
    paragraph:
      "Tone mapping turns a scene’s wide range of brightness into colours a screen can display. Compare Standard, ACES and Neutral curves, or turn tone mapping off. The glowing spheres make differences in highlights easy to see.",
    tries: [
      "Raise Exposure to three and turn on the comparison to inspect the bright spheres.",
      "Set the comparison to Neutral and flip: it keeps more of the amber than ACES does.",
      "Lower Exposure to 0.5 and compare the curves again.",
    ],
    uses: ["Environment.imageProcessing", "ToneMappingCurve", "Model", "app.assets.load", "createLightRig"],
    assets: [
      {
        name: "Corset",
        licence: "CC0 1.0",
        author: "Microsoft",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset",
      },
      STUDIO_ENVIRONMENT,
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A leather and cloth corset on a dressmaker's stand, lit from above on a dark studio floor, with a row of " +
      "six glowing amber spheres behind it climbing from near-black to a pale rolled-off yellow.",
    sourceFiles: ["main.ts", "scene.ts"],
  },
];
