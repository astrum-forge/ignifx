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
  {
    slug: "instancing",
    title: "Instancing",
    category: "Rendering",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Twenty thousand asteroids, one mesh, one draw call.",
    paragraph:
      "A ring of 20,000 rocks drawn by a single `InstancedMeshRenderer`. `setMatrices` hands Babylon Lite a " +
      "reference to the example's own `Float32Array` — sixteen floats per instance, column-major — and Lite never " +
      "copies it, so a foliage scatterer or a particle system can write into its own memory and call `markDirty()` " +
      "with nothing allocating in between. `setCount` draws fewer of them without re-uploading anything. The two " +
      "settings Lite fixes when the scene is registered, GPU culling and the LOD partner, are what the toggles on " +
      "the right rebuild the renderer for: change one on a live component and it logs `IGX-0717` and writes the " +
      "applied value back, so what the component reports is always what is being drawn.",
    tries: [
      "Pull Drawn down to two thousand and back up. The draw-call count never moves.",
      "Turn the LOD partner off and orbit out: the far side of the belt is suddenly the full-detail mesh.",
      "Turn GPU culling off. The renderer is rebuilt, because Lite bakes that flag into the renderable.",
    ],
    uses: ["InstancedMeshRenderer", "setMatrices", "setCount", "MeshAsset.sphere", "app.renderer.drawCalls"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A wide ring of thousands of small pale-grey rocks seen at a shallow angle against black, thousands deep, with " +
      "an empty hole at its centre and the far side of the ring receding towards the top of the frame.",
    sourceFiles: ["main.ts", "belt.ts"],
    heavy: true,
  },
];
