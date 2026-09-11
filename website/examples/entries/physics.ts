/**
 * 3D physics examples on Havok: the playground, the character controller, queries.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Physics examples, in display order. */
export const PHYSICS: readonly ExampleOf<"Physics">[] = [
  {
    slug: "physics-playground",
    title: "Physics playground",
    category: "Physics",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Drop boxes, spheres and capsules into a pit and adjust their friction and bounce.",
    paragraph:
      "Drop objects into a pit to try Havok physics. Adjust friction and bounce for newly created bodies, or reset the pile with those settings. Objects dim when they settle and brighten when something moves them again.",
    tries: [
      "Click anywhere on the floor: the click is a ray, and the ray is where the body lands.",
      "Raise Bounce to 0.8, then press Reset — the whole pile is re-dropped on the new surface.",
      "Watch a body dim as it settles, then drop a crate on it and watch the colour come back.",
    ],
    uses: [
      "physics",
      "Rigidbody",
      "BoxCollider",
      "SphereCollider",
      "CapsuleCollider",
      "Collider.inlineMaterial",
      "MeshAsset.box",
      "Camera.screenToRay",
    ],
    assets: [],
    controls: ["mouse", "touch", "keyboard", "gamepad"],
    posterAlt:
      "A settled pile of dark orange crates, teal balls and sand-coloured capsules resting on a grid " +
      "floor inside a low kerbed pit, lit from the upper left and casting soft shadows.",
    sourceFiles: ["main.ts", "bodies.ts", "controls.ts", "arena.ts"],
  },
  {
    slug: "character-controller",
    title: "Character controller",
    category: "Physics",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Move a character up ramps, test slope limits and try touch controls.",
    paragraph:
      "Move a capsule-shaped character around two ramps. The controller climbs slopes within its limit and blocks steeper ones. Adjust the limit or switch to touch controls to see how the same movement system responds.",
    tries: [
      "Walk up the pale ramp, then try the dark one: 30° is inside the slope limit and 60° is not.",
      "Drop the slope limit to 20° and the ramp you just climbed becomes a wall.",
      "Turn on the on-screen controls: the thumbstick drives the same action a keyboard does.",
    ],
    uses: [
      "CharacterController",
      "physics",
      "app.physics.raycast",
      "defineInputActions",
      "VirtualJoystick",
      "BoxCollider",
      "MeshAsset.capsule",
    ],
    assets: [],
    controls: ["keyboard", "gamepad", "touch", "mouse"],
    posterAlt:
      "An orange capsule standing half way up a pale 30-degree ramp that leads to a raised platform, " +
      "with a much steeper dark ramp beside it, on a grid floor.",
    sourceFiles: ["main.ts", "motor.ts", "course.ts"],
    guide: "character-controller-3d",
  },
];
