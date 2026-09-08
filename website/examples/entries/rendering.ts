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
    line: "The ignifx ship under image-based lighting, with bloom and ACES tone mapping.",
    paragraph:
      "The ignifx ship, banked in flight: a glTF model with physically based metal, lit by a prefiltered " +
      "environment probe, then bloom, anti-aliasing and ACES tone mapping as a post-process stack. This is the " +
      "render path every 3D ignifx game uses, and the parameters on the right are the ones a game puts in its " +
      "settings screen. `shot.ts` beside it holds the composition — the lens, the pose, the grading — so `main.ts` " +
      "is only the engine.",
    tries: [
      "Drag to orbit and scroll to zoom; the reflections on the hull follow the probe as you move.",
      "Switch the Model select to Corset: one assignment swaps a loaded glTF for another.",
      "Rotate the environment, or blur it: one number moves every reflection on the ship at once.",
    ],
    uses: ["Model", "Environment", "PostProcessStack", "app.assets.load", "Light.exclude", "Camera"],
    assets: [
      {
        name: "ignifx mascot ship",
        licence: "© 2026 Astrum Forge Studios Pty Ltd",
        author: "Astrum Forge Studios",
        source: "https://ignifx.com/press/",
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
    line: "Click to select: the GPU pick and the CPU raycast, at the same pixel.",
    paragraph:
      "Seven generated shapes on a grid, and every click resolves the same pixel twice. " +
      "`app.renderer.pickAsync` draws an id buffer and reads one pixel back from the device; " +
      "`world.raycastRender` walks the scene's meshes on the CPU and answers in the same call. Both report the " +
      "entity they hit, both skip a renderer whose `pickable` is false, and the two rows in the panel agree on " +
      "every click — while their timings do not, because one of them waits for the device. Both take " +
      "backing-store pixels, which is why the click arrives as an `@ignifx/input` action rather than as a DOM event.",
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
