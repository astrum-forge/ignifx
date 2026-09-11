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
    line: "Move a character with a following camera that adjusts around walls.",
    paragraph:
      "Explore a small yard with third-person controls. The orbit camera moves closer when a wall gets in the way and eases back when the view clears. Try walking and sprinting with keyboard, gamepad or touch controls.",
    tries: [
      "Back into the left corner. Watch the camera move closer and the Boom now value decrease.",
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
    line: "Blend movement animations and trigger a separate action, with events you can inspect.",
    paragraph:
      "Control a fox with an animation state machine. Changing speed blends its movement clips, while the Survey trigger plays a look-around animation. The panel shows the current state and counts animation events as they fire.",
    tries: [
      "Drag speed from 0 to 8 and watch the Gait readout name the two clips being mixed at each value.",
      "Press survey: the State readout changes, both events fire, and the exit time returns the fox to its gait.",
      "Set Rate to 0.25x and press survey again to watch the events in slow motion.",
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
