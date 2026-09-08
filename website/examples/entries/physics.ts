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
    line: "Drop boxes, spheres and capsules into a pit; change the surface they land on.",
    paragraph:
      "Rigid bodies on Havok. Click the floor to drop the selected shape, or press the button; the " +
      "friction and bounce sliders are a physics material, which a collider reads when its shape is " +
      "built, so they reach the next body you drop. The simulation runs in `FixedUpdate` on its own " +
      "headless scene at a fixed rate, whatever the frame rate does, and a body that stops moving is " +
      "put to sleep and costs nothing until something wakes it — the dimmed ones in the pit are the " +
      "ones this example has measured at rest. Every shape is a `MeshAsset` factory, so nothing is " +
      "fetched.",
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
    line: "A capsule that walks up a 30° ramp, refuses a 60° one, and jumps.",
    paragraph:
      "A `CharacterController` is a kinematic capsule that collides and slides. It applies no gravity " +
      "of its own, so the script owns the vertical speed — and therefore owns jump feel, the coyote " +
      "window, and the ground snap that keeps the capsule on the surface instead of skipping down it. " +
      "Movement is simulation, so it runs in `fixedUpdate`, and it is camera-relative, so the same " +
      "code reads a keyboard, a gamepad stick and an on-screen thumbstick. Both ramps are built from " +
      "their angles rather than eyeballed, so 30° and 60° are measured by construction.",
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
