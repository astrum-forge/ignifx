/**
 * Rendering examples: the PBR hero, picking, scale, text, timings.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Rendering examples, in display order. */
export const RENDERING: readonly ExampleOf<"Rendering">[] = [
  {
    slug: "pbr-model",
    title: "Physically based rendering",
    category: "Rendering",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Explore the ignifx ship with realistic metal, reflections and glowing engines.",
    paragraph:
      "Explore a 3D ship rendered with physically based materials. Environment lighting creates reflections on the hull, while bloom gives the engines their glow. Adjust the lighting and materials in the panel, or switch models to compare the results.",
    tries: [
      "Drag to orbit and scroll to zoom. Watch the reflections change as you move.",
      "Choose Corset in the Model menu to compare a different model.",
      "Rotate the environment or add blur to change the reflections on the ship.",
    ],
    uses: ["Model", "Environment", "PostProcessStack", "app.assets.load", "Light.exclude", "Camera"],
    assets: [
      {
        name: "ignifx mascot ship",
        licence: "© 2026 Astrum Forge Studios Pty Ltd",
        author: "Astrum Forge Studios",
        source: "https://astrumforge.com",
      },
      {
        name: "Corset",
        licence: "CC0 1.0",
        author: "Microsoft",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset",
      },
      {
        name: "Studio environment",
        licence: "CC-BY 4.0",
        author: "Babylon.js contributors",
        source: "https://github.com/BabylonJS/Assets/blob/master/environments/studio.env",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A detailed metal spaceship crossing the frame nose-down, seen from slightly below and in front: a warm key " +
      "light picks out its worn hull plating, a rim light behind it burns the wing edges, its engines glow, and " +
      "behind it a faint pool of light falls away to black at the corners.",
    sourceFiles: ["main.ts", "shot.ts"],
    guide: "load-a-model",
  },
  {
    slug: "picking",
    title: "Picking",
    category: "Rendering",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Click a shape and compare object selection using the GPU and CPU.",
    paragraph:
      "Select shapes on a grid using two methods: GPU picking and CPU raycasting. The panel shows which object each method finds and how long it takes. Toggle whether the floor can be selected, then try again.",
    tries: [
      "Click a shape, then the floor between two of them: both paths report the same hit and the same miss.",
      "Read the two timings. The CPU row is the ray test alone; the GPU row includes the readback.",
      "Turn on “Ground is pickable” and click the grid — one flag, and both paths start finding it.",
    ],
    uses: ["app.renderer.pickAsync", "world.raycastRender", "Camera", "MeshRenderer", "MeshAsset", "Script"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Seven grey shapes — a box, a sphere, a cylinder, a capsule, a torus, a cone and a slab — standing in two " +
      "rows on a lit grid floor, with the cylinder at the centre of the frame picked out in orange.",
    sourceFiles: ["main.ts", "scene.ts", "click-to-pick.ts"],
  },
];
