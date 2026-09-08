/**
 * Gameplay examples from the 3D toolkit: characters, cameras, the animator, navigation, prefabs.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Gameplay examples, in display order. */
export const GAMEPLAY: readonly ExampleOf<"Gameplay">[] = [
  {
    slug: "third-person",
    title: "Third-person",
    category: "Gameplay",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A character controller and an orbit camera that will not clip through a wall.",
    paragraph:
      "Two components carry a whole third-person game. `ThirdPersonController` moves a character " +
      "capsule on the fixed step, camera-relative, with gravity, coyote time and a step-up of its " +
      "own; `ThirdPersonCamera` orbits behind it and sphere-casts along its boom, so backing into " +
      "the corner of the yard pulls the camera in instead of putting a wall between you and your " +
      "character. Walk out through the doorway and the boom eases back to full length. Keyboard, " +
      "gamepad and touch all drive the same four actions.",
    tries: [
      "Back into the corner on the left and watch the Boom now figure fall as the wall pushes the camera in.",
      "Turn Wall collision off, back into the same corner, and see what the camera does without it.",
      "Hold Shift to sprint: the character turns to face the way it is going, and the camera keeps up.",
    ],
    uses: [
      "ThirdPersonController",
      "ThirdPersonCamera",
      "CharacterController",
      "BoxCollider",
      "Model",
      "defineInputActions",
      "VirtualJoystick",
    ],
    assets: [
      {
        name: "ignifx box-man rig",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/blob/main/tests/fixtures/assets/3d/rig.glb",
      },
    ],
    controls: ["keyboard", "mouse", "gamepad", "touch"],
    posterAlt:
      "A pale blocky figure seen from behind and above, standing on a grey tiled floor inside a walled yard at " +
      "dusk. A wall runs across the yard ahead of it with a dark doorway in it, and a shorter wall stands close " +
      "on the left, throwing a long shadow across the floor.",
    sourceFiles: ["main.ts", "level.ts", "controls.ts"],
    guide: "third-person-camera",
  },
  {
    slug: "animator",
    title: "Animator",
    category: "Gameplay",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A state machine with a blend tree, a trigger and animation events, all in one document.",
    paragraph:
      "The Fox has three clips and `fox.animator.json` turns them into behaviour. A 1D blend tree " +
      "mixes them on a `speed` parameter, so the gait changes with the number instead of snapping " +
      "at a threshold; a trigger cuts to a one-shot look-around from wherever the machine is; two " +
      "animation events on that state arrive on `Animator.onEvent` as the clip crosses them, and " +
      "the panel counts them. The code writes one parameter and sets one trigger. Everything else " +
      "is data, which is what makes an animator something you retune rather than rewrite.",
    tries: [
      "Drag speed from 0 to 8 and watch the Gait readout name the two clips being mixed at each value.",
      "Press survey: the State readout changes, both events fire, and the exit time returns the fox to its gait.",
      "Slow Rate to 0.25x and press survey again; the events fire at the same points in a clip that now takes four times as long.",
    ],
    uses: ["Animator", "AnimatorAsset", "Animator.onEvent", "Model", "app.assets.load", "OrbitCamera"],
    assets: [
      {
        name: "Fox",
        licence: "CC0 1.0 (model), CC-BY 4.0 (rig, animation and glTF conversion)",
        author: "PixelMannen, tomkranis, AsoboStudio and scurest",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A low-poly orange fox mid-stride on a grey tiled floor at dusk, front legs reaching forward and back legs " +
      "pushing off, its tail streaming behind it and its shadow falling to the left.",
    sourceFiles: ["main.ts", "fox.animator.json"],
  },
];
