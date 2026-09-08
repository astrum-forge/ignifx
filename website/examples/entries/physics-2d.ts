/**
 * 2D physics examples on Rapier: bodies and the platformer controller.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleAsset, ExampleOf } from "../catalogue.ts";

/** Kenney's Pixel Platformer pack, which the arena's crates and coins come from. */
const PIXEL_PLATFORMER: ExampleAsset = {
  name: "Pixel Platformer tileset",
  licence: "CC0 1.0",
  author: "Kenney",
  source: "https://kenney.nl/assets/pixel-platformer",
};

/** The repository's own generated side-on tileset and character sheet. */
const REPO_ART: ExampleAsset = {
  name: "Side-on terrain and runner sheets",
  licence: "Apache-2.0",
  author: "Astrum Forge Studios",
  source: "https://github.com/astrum-forge/ignifx/tree/main/tests/fixtures/assets/2d-templates",
};

/** The Physics examples, in display order. */
export const PHYSICS_2D: readonly ExampleOf<"Physics">[] = [
  {
    slug: "platformer-controller",
    title: "Platformer controller",
    category: "Physics",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Ramps, low steps, one-way planks and coyote time on a kinematic character controller.",
    paragraph:
      "`CharacterController2D` is a kinematic box that collides and slides through Rapier, and it applies no " +
      "gravity at all. That is the point: the script owns the vertical velocity, which is what makes coyote time, " +
      "a jump buffer and a variable jump height possible. The course is built for the four fields on the panel — " +
      "two 45-degree ramps for `slopeLimit`, three quarter-metre steps for `stepOffset`, two tiers of one-way " +
      'planks for `onOneWayPlatforms`, and a pit to fall into. Autostep needs `shape: "box"`; the default ' +
      "capsule clears about 0.15 m however large the number is.",
    tries: [
      "Pull Slope limit under 45 and walk at a ramp: the controller refuses the climb and slides you back.",
      "Drop Step offset to 0.1 and the three low steps become a wall; put it back to 0.3 and you walk up them.",
      "Stand on a plank and press Down and Jump together to fall through it; on solid ground the same press jumps.",
    ],
    uses: [
      "CharacterController2D",
      "TilemapCollider2D",
      "BoxCollider2D",
      "Tilemap.collisionAt",
      "Camera2D",
      "Camera2DFollow",
      "SpriteAnimator",
    ],
    assets: [REPO_ART],
    controls: ["keyboard", "gamepad", "touch"],
    posterAlt:
      "A side-on pixel-art platformer level at dusk: a grassy earth floor with a dusk-blue pit cut through it on " +
      "the left, a small blue-suited runner standing beside a flight of three low grassy steps, and two rows of " +
      "wooden planks floating above and to the right.",
    sourceFiles: ["main.ts", "runner.ts", "course.tmj.json"],
    guide: "platformer-controller-2d",
  },
  {
    slug: "physics-2d",
    title: "2D physics",
    category: "Physics",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Stack crates, roll coins into them, and watch Rapier take the tower apart.",
    paragraph:
      "A collider makes an entity solid, a `Rigidbody2D` makes it move, and the pose comes back on " +
      "`entity.transform.position2D` like any other. The only difference between a crate and a coin here is the " +
      "collider shape — a box stacks and topples, a circle rolls — and the mass, which is exact kilograms. The " +
      "floor and the two off-screen walls carry colliders and no body, which is what makes them static. Rapier is " +
      "stepped by ignifx's own fixed loop at 60 Hz whatever the frame rate does, and dynamic bodies interpolate " +
      "between steps so the motion stays smooth above it.",
    tries: [
      "Click or tap anywhere: a coin is thrown from the left edge at the point you picked.",
      "Drop crates until the tower leans, then knock it down and press Reset the stack.",
      "Open World and pull gravity towards zero: the same throw turns into a slow drift.",
    ],
    uses: ["Rigidbody2D", "BoxCollider2D", "CircleCollider2D", "app.physics2d.gravity", "Camera2D", "SpriteRenderer"],
    assets: [PIXEL_PLATFORMER],
    controls: ["mouse", "touch"],
    posterAlt:
      "Nine wooden crates stacked three by three on a strip of grassy earth against a dusk-blue background, with a " +
      "gold coin resting on the ground either side of them.",
    sourceFiles: ["main.ts", "arena.ts", "launch.ts"],
  },
];
