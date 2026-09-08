import { Camera, validateInputActions } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, button, readout, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import { attachBoard, PLAYER_MAP } from "./board.ts";
import actionsSource from "./player.input.json?raw";
import { attachRover } from "./rover.ts";
import type { InputAction } from "ignifx";

/**
 * Every device and every action, live: an `.input.json` document, the board it lights up, and the
 * rover it drives.
 *
 * Read `player.input.json` beside this file first — it is the whole input configuration, and
 * nothing in this program names a key. Two maps: `Player`, which holds the gameplay actions, and
 * `System`, which holds the one action that switches `Player` off. Inside `Player` are the three
 * composites (`2DVector` for WASD, `1DAxis` for Q and E, `ButtonWithModifier` for shift-W), the
 * processors that make a stick and a keyboard agree (`deadzone`, `normalize`, `scale`, `clamp`), and
 * three control schemes.
 *
 * ## The document is imported, not addressed
 *
 * `?raw` hands the file over as text, `JSON.parse` turns it into a value and `validateInputActions`
 * turns that into the definition `loadActions` takes — the **same** check the asset loader runs, so
 * a typo in the document is an error here rather than a silently missing action. The alternative is
 * to put the file under `website/examples/assets/` and load it by address, which is what a game
 * does; it is imported here so the viewer page can show it as a tab next to this file, which is the
 * point of the example.
 *
 * A document named in `input({ actions })` is **not** awaited: it is delivered like any other asset,
 * in a later frame (`packages/input/skills/input/SKILL.md`). Loading it before `app.start()` is what
 * makes the first frame have its maps — and the board resolve its actions in `attachBoard`.
 */

/**
 * The floor, in metres. Big enough that its far edge is behind the board and out of the frame: a
 * finite plane whose horizon is visible reads as a raft floating in the void.
 */
const PAD_SIZE = 60;

/** Where the camera sits and what it looks at, in metres. */
const SHOT = { eye: { x: 0, y: 2.75, z: -4.35 }, focus: { x: 0, y: 0.78, z: 0.35 }, fov: 42 } as const;

/**
 * Writes a `vector2` action as a pair, or `—` when the document declares no such action.
 *
 * @param action - The action to read.
 * @returns The text for a readout cell.
 */
function vectorText(action: InputAction | null): string {
  if (action === null) {
    return "—";
  }
  return `${action.vector.x.toFixed(2)}, ${action.vector.y.toFixed(2)}`;
}

/**
 * Writes an axis or button action as one number and its press state.
 *
 * @param action - The action to read.
 * @returns The text for a readout cell.
 */
function axisText(action: InputAction | null): string {
  if (action === null) {
    return "—";
  }
  return `${action.axis.toFixed(2)}${action.isPressed ? " ▪" : ""}`;
}

/**
 * Writes a slider's value to two places.
 *
 * @param value - The value.
 * @returns The text for the slider's value cell.
 */
function twoPlaces(value: number): string {
  return value.toFixed(2);
}

bootExample({
  title: "Input actions",
  settings: {
    rendering: {
      clearColor: { r: 0.035, g: 0.043, b: 0.059, a: 1 },
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`.
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    // The document, checked the way the loader checks it. `JSON.parse` answers `any`, so the value
    // is typed `unknown` at the boundary and `validateInputActions` is what narrows it.
    const parsed: unknown = JSON.parse(actionsSource);
    app.input.loadActions(validateInputActions(parsed, "player.input.json"));

    const eye = app.world.createEntity("Main Camera");
    eye.transform.localPosition.set(SHOT.eye.x, SHOT.eye.y, SHOT.eye.z);
    eye.transform.lookAt(SHOT.focus);
    // No orbit camera here, on purpose: the mouse belongs to the actions in this example, and a
    // camera that ate the drag would take `look`, `fire` and `aim` with it.
    const camera = eye.addComponent(Camera, { near: 0.05, far: 120, fov: SHOT.fov });

    // Awaited before `app.start()`: a load that completes before the loop runs settles at once,
    // and a material binds its textures once — an unawaited grid is an untextured floor.
    await createGridGround(app, { size: PAD_SIZE, color: { r: 0.17, g: 0.19, b: 0.24, a: 1 } });
    createLightRig(app, {
      focus: { x: 0, y: 0.4, z: -0.4 },
      keyIntensity: 2.4,
      rimIntensity: 0.9,
      shadowDarkness: 0.4,
    });

    const board = attachBoard(app);
    const rover = attachRover(app, camera);
    // The board and the rover light up from the same actions, so the two halves of the frame never
    // disagree: one reads the map, the other drives on it.
    const player = app.input.actions.map(PLAYER_MAP);
    const find = (name: string): InputAction | null => app.input.actions.find(name);
    // A signal rather than a poll: `onPerformed` fires once per press, in `PreUpdate`. The
    // connection is owned by the board's entity, so it disconnects when the entity dies — which is
    // the whole point of an owner-scoped connection.
    find("toggleMap")?.onPerformed.connect(
      (): void => {
        player.enabled = !player.enabled;
      },
      { owner: board },
    );

    panel({
      title: "Input actions",
      groups: [
        {
          label: "Actions",
          controls: [
            readout("move", (): string => vectorText(find("move"))),
            readout("look", (): string => vectorText(find("look"))),
            readout("spin", (): string => axisText(find("spin"))),
            readout("boost", (): string => axisText(find("boost"))),
            readout("jump", (): string => axisText(find("jump"))),
            readout("fire", (): string => axisText(find("fire"))),
            readout("sprint", (): string => axisText(find("sprint"))),
          ],
        },
        {
          label: "Devices",
          controls: [
            readout("Scheme", (): string => (app.input.currentScheme === "" ? "none" : app.input.currentScheme)),
            // A browser hides a pad until a button is pressed on it, so this reads 0 with one
            // plugged in and nothing touched.
            readout("Gamepads", (): string => String(app.input.gamepads.filter((pad) => pad.isConnected).length)),
            readout("Events this frame", (): string => String(app.input.events.length)),
            readout("Pointer, pixels", (): string => vectorText(find("aim"))),
          ],
        },
        {
          label: "Maps",
          controls: [
            // A button and a readout, not a `toggle`: a checkbox is written once when the panel
            // mounts, so it would go stale the moment Escape switched the same map off.
            readout("Player map", (): string => (player.enabled ? "enabled" : "disabled")),
            button("Toggle Player map", (): void => {
              player.enabled = !player.enabled;
            }),
            // Escape does the same thing. A disabled map hides its actions from
            // `app.input.actions.get`, which is why the board and the rover hold theirs from
            // `find` — where they read as released instead of throwing `IGX-0801`.
            //
            // The magnitude at which an analog value counts as pressed. Push it up and a gamepad
            // trigger has to be squeezed harder before `jump.isPressed` is true.
            slider(
              "Press point",
              { min: 0.05, max: 0.95, step: 0.05, format: twoPlaces },
              bind(app.input, "pressPoint"),
            ),
          ],
        },
        {
          label: "Rover",
          collapsed: true,
          controls: [
            slider("Speed", { min: 0.5, max: 6, step: 0.1 }, bind(rover, "speed")),
            slider("Boost factor", { min: 1, max: 4, step: 0.1 }, bind(rover, "boostFactor")),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
