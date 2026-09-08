/**
 * The four templates, each embedded as its own build.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Templates examples, in display order. */
export const TEMPLATES: readonly ExampleOf<"Templates">[] = [
  {
    slug: "2d-topdown",
    title: "Top-down 2D game",
    category: "Templates",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "A tilemap with a collision layer, a Y-sorted character, a camera follow and the full front end.",
    paragraph:
      "One of the four templates `create-ignifx` scaffolds, running here exactly as it runs on a developer's " +
      "machine. A Tiled-style tilemap with a collision layer becomes colliders; props and the character sort by " +
      "their Y position so they overlap correctly; the camera follows through a dead zone; and the title screen, " +
      "pause menu, settings, key rebinding and save file are all real. Everything but the camera is spawned from " +
      "the map's objects layer, so moving a spawn needs no TypeScript.",
    tries: [
      "Walk onto a shrine pad with WASD or the arrows to light it; the game autosaves when you do. Press E to see what is within reach.",
      "Press Escape for the pause menu, then Settings to move the audio and render-scale sliders.",
      "Open Settings, then Rebind controls, and give a key a new binding — the override persists across a reload.",
    ],
    uses: ["Tilemap", "TilemapRenderer", "Camera2DFollow", "CharacterController2D", "Menu", "MenuStack", "app.storage"],
    assets: [
      {
        name: "Template art and audio",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/tree/main/templates/2d-topdown/assets",
      },
    ],
    controls: ["keyboard", "gamepad", "touch", "mouse"],
    posterAlt:
      "A top-down pixel-art courtyard with stone paths and grass, a character in the centre and lit shrines, with " +
      "a heads-up display along the top.",
    sourceFiles: ["src/main.ts"],
    template: "2d-topdown",
  },
  {
    slug: "2d-sidescroller",
    title: "Side-scrolling 2D game",
    category: "Templates",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Three parallax bands, a tilemap with slopes and one-way platforms, coins, and a pixel-perfect camera.",
    paragraph:
      "One of the four templates `create-ignifx` scaffolds, running here exactly as it runs on a developer's " +
      "machine. Three parallax bands slide behind a tilemap that carries 45-degree slopes and one-way planks; the " +
      "reference platformer controller has coyote time, a jump buffer, a variable jump height and drop-through; " +
      "the coins are trigger colliders that score a point and autosave when they are taken; and the camera is " +
      "pixel-perfect against a 320 by 180 reference resolution, so one source texel covers a whole number of " +
      "screen pixels. The title screen, pause menu, settings, key rebinding and save file are all real.",
    tries: [
      "Run with WASD or the arrows and jump with Space; taking a coin scores a point and autosaves.",
      "Hold S or the down arrow and press Space on one of the planks to drop through it.",
      "Press Escape for the pause menu, then Settings and Rebind controls, and give jump a new key.",
    ],
    uses: [
      "Tilemap",
      "TilemapRenderer",
      "ParallaxLayer",
      "SpriteAnimator",
      "Camera2D",
      "CharacterController2D",
      "Menu",
      "MenuStack",
      "app.storage",
    ],
    assets: [
      {
        name: "Template art and audio",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/tree/main/templates/2d-sidescroller/assets",
      },
    ],
    controls: ["keyboard", "gamepad", "touch", "mouse"],
    posterAlt:
      "A pixel-art dusk landscape: a hill and a treeline behind a grass-topped dirt tilemap, a wooden plank and " +
      "a brick platform with gold coins hanging above them, the character standing on the left, and a chip in " +
      "the top corner that reads No coins.",
    sourceFiles: ["src/main.ts", "src/scripts/platformer-controller.ts", "src/scripts/collectible.ts"],
    template: "2d-sidescroller",
  },
  {
    slug: "3d-third-person",
    title: "Third-person 3D game",
    category: "Templates",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A character on a capsule, an orbit camera that avoids walls, an animated rig, and a companion that paths.",
    paragraph:
      "One of the four templates `create-ignifx` scaffolds, running here exactly as it runs on a developer's " +
      "machine. The character is a `CharacterController` capsule driven by `ThirdPersonController`; the orbit " +
      "camera sweeps a sphere along its boom, so geometry in the way pulls the camera in rather than letting it " +
      "sit inside a wall; an `Animator` state machine blends idle, walk and run on a rigged model and triggers " +
      "the jump; the companion is a `NavMeshAgent` on a surface baked from the geometry the level builds in " +
      "code; and the crates are rigid bodies you can push. Walking up to a beacon lights it, scores a point and " +
      "autosaves. The title screen, pause menu, settings, key rebinding and save file are all real.",
    tries: [
      "Click the frame to take the pointer, then walk with WASD, look with the mouse and hold Shift to sprint; the rig blends idle, walk and run.",
      "Walk into one of the three beacons to light it — that scores a point and autosaves the run.",
      "Press Escape, then Settings, and turn shadows or post-processing off while the game runs.",
    ],
    uses: [
      "CharacterController",
      "ThirdPersonController",
      "ThirdPersonCamera",
      "Animator",
      "NavMeshSurface",
      "NavMeshAgent",
      "PostProcessStack",
      "Menu",
      "MenuStack",
      "app.storage",
    ],
    assets: [
      {
        name: "Template rig, textures and audio",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/tree/main/templates/3d-third-person/assets",
      },
    ],
    controls: ["keyboard", "gamepad", "touch", "mouse"],
    posterAlt:
      "A grey tiled courtyard ringed by dark panelled walls under a pale sky: the rigged character stands in the " +
      "middle among scattered wooden crates, three beacon posts sit around the floor, and a chip in the top " +
      "corner reads the player's speed and the companion's distance.",
    sourceFiles: ["src/main.ts", "src/level.ts", "src/scripts/hero-animation.ts"],
    template: "3d-third-person",
  },
  {
    slug: "3d-first-person",
    title: "First-person 3D game",
    category: "Templates",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Walk, sprint, crouch and jump with pointer lock, a view model on the hand, and things to push.",
    paragraph:
      "One of the four templates `create-ignifx` scaffolds, running here exactly as it runs on a developer's " +
      "machine. `FirstPersonController` walks, sprints, crouches and jumps on a `CharacterController` capsule, " +
      "with head bob and pointer lock, and the body owns the yaw while the head owns the pitch. The view model " +
      "is parented to the rig's `hand` node, so the prop it carries follows the animation; a crosshair ray from " +
      "the camera through `app.physics.raycast` reports what is in reach on the `Interactable` layer and lights " +
      "a pedestal when you interact; and the crates are rigid bodies you can push. The title screen, pause " +
      "menu, settings, key rebinding and save file are all real.",
    tries: [
      "Click the frame to take pointer lock, then walk with WASD and hold C to crouch.",
      "Look at a pedestal and press E, or click, to light it; the game autosaves when you do.",
      "Press Escape, then Settings, and turn shadows or post-processing off while the game runs.",
    ],
    uses: [
      "CharacterController",
      "FirstPersonController",
      "Animator",
      "app.physics.raycast",
      "PostProcessStack",
      "Menu",
      "MenuStack",
      "app.storage",
    ],
    assets: [
      {
        name: "Template rig, textures and audio",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/tree/main/templates/3d-first-person/assets",
      },
    ],
    controls: ["keyboard", "gamepad", "touch", "mouse"],
    posterAlt:
      "A first-person view across a grey tiled room ringed by dark panelled walls: blue-grey crates and three " +
      "pedestals stand ahead, a small crosshair sits at the centre of the frame, the view model and its teal " +
      "prop fill the bottom corner, and a chip in the top corner reads that no pedestals are lit and nothing is " +
      "in reach.",
    sourceFiles: ["src/main.ts", "src/level.ts", "src/scripts/interactor.ts"],
    template: "3d-first-person",
  },
];
