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
    line: "Directional, point, spot and hemispheric, each drawn with a gizmo you can see.",
    paragraph:
      "A light is invisible, so each of the four here carries a small unlit shape that shows what it is: an arrow " +
      "for the directional light's direction, a glowing orb and a ring at its range for the point light, a cone " +
      "for the spot, and a two-tone marker for the hemispheric light's sky and ground colours. Every gizmo is a " +
      "child entity of the light, so it inherits the pose and nothing keeps the two in step by hand. Switch a lamp " +
      "off and change its colour, its intensity, its range and its cone, and watch which parts of the scene answer.",
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
    line: "PCF, ESM and cascades over a long floor, with the map size, the biases and the distance live.",
    paragraph:
      "Four shapes turning over a floor that receives, and five pillars receding to forty metres so a cascade " +
      "split and a shadow distance have somewhere to show. Shadows are two decisions in ignifx: the " +
      "`rendering.features.shadows` opt-in, which is read once when the scene is registered, and each light's own " +
      "`shadows` record. Only `enabled` in that record is live — everything else is read when the shadow generator " +
      "is built — so the panel drops the generator and builds another, and counts them while it does.",
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
    line: "Three prefiltered environments, switched at runtime, with rotation and blur.",
    paragraph:
      "There is no `Light` component in this example. Every highlight and every reflection comes from a " +
      "prefiltered `.env` — a cube map convolved offline into one mip per roughness, plus the harmonics that carry " +
      "the diffuse term. The front row is metal and the back row is painted, and both run from mirror-smooth to " +
      "fully rough, so you can see what the same probe does to each. Switching probes is one assignment: all three " +
      "are loaded before the app starts, and the handles stay retained so switching back costs nothing.",
    tries: [
      "Switch the probe from Studio to Bridge and back; the whole frame changes temperature.",
      "Rotate the environment and watch every reflection in the row turn with it.",
      "Raise the blur and the sharp softboxes soften into a wash the rough spheres already show.",
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
    line: "Standard, ACES, Neutral and none, with exposure and contrast, flipped A against B.",
    paragraph:
      "A renderer works in linear light with no ceiling and a display has a ceiling of one; a tone-mapping curve " +
      "is the function between them, and in ignifx it lives on `Environment.imageProcessing` and is compiled into " +
      "the PBR shaders. The ramp of six emissive spheres is the instrument: raising the exposure walks them past " +
      "the ceiling from the right, and what each curve does with the ones that went past is the whole difference. " +
      "A world renders through one camera, so this is an A-against-B flip rather than a split screen.",
    tries: [
      "Raise the exposure to three and flip the comparison on: none clips the ramp flat, ACES rolls it off.",
      "Set the comparison to Neutral and flip: it keeps more of the amber than ACES does.",
      "Drop the exposure to a half and the curves converge, because nothing is near the ceiling any more.",
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
