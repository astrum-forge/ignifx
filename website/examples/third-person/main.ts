import {
  Camera,
  CharacterController,
  MODEL_ASSET_TYPE,
  Model,
  physics,
  ThirdPersonCamera,
  ThirdPersonController,
  threeD,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, readout, slider, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import { attachTouchControls, DragToLook, hasTouch, PLAYER_ACTIONS } from "./controls.ts";
import { buildLevel, GROUND_SIZE, SKY } from "./level.ts";
import type { ModelAsset } from "ignifx";

/**
 * A third-person character and a camera that will not clip through a wall: the two components
 * every 3D ignifx game starts from, and little else.
 *
 * `ThirdPersonController` moves a `CharacterController` in `fixedUpdate` — camera-relative, with
 * its own gravity, coyote time, jump buffering and step-up — so 30 fps and 240 fps produce the
 * same trajectory. `ThirdPersonCamera` orbits in `lateUpdate`, after animation, so it frames the
 * character where this frame's pose actually left it; and it sphere-casts along its boom, pulling
 * in the moment something on its `collisionLayers` gets between the camera and the character.
 *
 * `level.ts` is the yard they stand in and `controls.ts` is where the input comes from. Neither is
 * the lesson, and both sit next to this file on the example's page.
 *
 * Two numbers below are worth knowing. `collisionLayers` is `["Level"]`, not empty: an **empty
 * list sweeps every layer**, so the character's own capsule shortens the boom the moment it drifts
 * behind the camera and the shot jams at its nose. And `damping` is a time constant in seconds, not
 * a fraction — `0` snaps, `0.07` keeps up, and anything past about `0.2` is a camera on a rope.
 */

/** The character capsule's height, in metres. The rig is about 1.45 m tall. */
const CAPSULE_HEIGHT = 1.6;

/** The character capsule's radius, in metres: wider than the camera's sweep sphere, deliberately. */
const CAPSULE_RADIUS = 0.32;

/** Where the character stands: south of the wall across the yard, with the doorway ahead of it. */
const SPAWN = { x: 2, y: CAPSULE_HEIGHT / 2, z: -1.2 } as const;

/** The camera's opening yaw, in degrees. Zero looks down `+Z`; this looks a little left of it. */
const START_YAW = -6;

/** The camera's opening pitch, in degrees: above the character, looking down at it. */
const START_PITCH = 18;

/**
 * Where the boom pivots, relative to the character: over its right shoulder, at head height.
 *
 * @remarks
 * In the **character's own space**, so it turns with the character — which is what keeps it clear
 * of walls, since the rig sweeps its collision sphere from this point and a sweep starting inside
 * geometry reports no distance at all. Turning `rotateToMovement` off — a strafing shooter — means
 * keeping `|offset.x| + collisionRadius` inside the capsule's radius instead.
 */
const SHOULDER = { x: 0.4, y: 0.55, z: 0 } as const;

/** The address of the repository's own rigged "box-man". */
const RIG_ADDRESS = "models/rig.glb";

/**
 * Where Havok's WebAssembly is served from.
 *
 * @remarks
 * The default, `"auto"`, asks the asset manifest — which has no entry for it, because an
 * extension's public asset is copied **unhashed** and served rather than indexed. The fallback is
 * relative to the page, and a run page sits three segments below where the plugin writes it, so
 * Vite's base is named here: the one value right under `dev:examples` and in the built site alike.
 */
const HAVOK_WASM_URL = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

bootExample({
  title: "Third-person",
  // `threeD()` requires `physics()` and `input()` before it; the kit registers `input()` first.
  extensions: [physics(), threeD()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
    // `Level` is what the camera's boom sweeps against. `level.ts` tags every wall and the floor.
    layers: { layers: ["Default", "Level"] },
    physics: { havokWasm: HAVOK_WASM_URL },
  },

  async setup({ app, panel, flags, afterStart }) {
    app.registerComponents([DragToLook]);
    app.input.loadActions(PLAYER_ACTIONS);

    // Awaited before `app.start()`: a load that finishes before the loop runs settles at once,
    // while one awaited afterwards waits for a frame's `PreUpdate`.
    const rig = app.assets.load<ModelAsset>(RIG_ADDRESS, { type: MODEL_ASSET_TYPE });
    await createGridGround(app, { size: GROUND_SIZE });
    await rig.promise;

    createLightRig(app, { focus: { x: 0, y: 1, z: 0 }, keyPosition: { x: -6, y: 9, z: -5 } });
    buildLevel(app, app.world.layers.requireIndex("Level"));

    const character = app.world.createEntity("Character", { position: SPAWN });
    character.addComponent(CharacterController, { height: CAPSULE_HEIGHT, radius: CAPSULE_RADIUS, slopeLimit: 50 });
    const controller = character.addComponent(ThirdPersonController, {
      walkSpeed: 3.4,
      sprintSpeed: 6.4,
      jumpHeight: 1.1,
      stepHeight: 0.3,
      rotateToMovement: true,
    });
    character.addComponent(DragToLook);
    // The model hangs off a **child**: a `CharacterController`'s capsule is centred on its own
    // entity and the rig's origin is between its feet, so sharing one transform would bury the
    // character to the waist.
    const body = app.world.createEntity("Character Body", { parent: character });
    body.transform.localPosition.set(0, -CAPSULE_HEIGHT / 2, 0);
    body.addComponent(Model, { model: rig.retain(), castShadows: true, receiveShadows: true });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 56 });
    // `ThirdPersonCamera.awake` reads the entity's current facing as its opening orbit, so the
    // shot is authored on the transform rather than in a field.
    eye.transform.localEulerAngles = { x: START_PITCH, y: START_YAW, z: 0 };
    const boom = eye.addComponent(ThirdPersonCamera, {
      target: character,
      distance: 4.6,
      shoulderOffset: SHOULDER,
      damping: 0.07,
      minPitch: -15,
      maxPitch: 55,
      sensitivity: 0.2,
      collisionEnabled: true,
      // Smaller than the capsule's radius, so the sweep starts in the clear space the character
      // controller keeps around itself rather than in the floor it is standing on.
      collisionRadius: 0.22,
      collisionLayers: ["Level"],
    });
    // `snap()` puts the rig at its ideal pose with no damping — what a teleport, a cut and a frozen
    // capture all need. Under `?static=1` the frame delta is zero, so nothing would ever damp.
    afterStart((): void => {
      boom.snap();
    });

    if (!flags.isStatic && hasTouch()) {
      attachTouchControls(app);
    }

    panel({
      title: "Third-person",
      groups: [
        {
          label: "Camera",
          controls: [
            slider("Boom", { min: 1.5, max: 8, step: 0.1, format: metres }, bind(boom, "distance")),
            // The live length after collision — the whole point of the component.
            readout("Boom now", (): string => metres(boom.currentDistance)),
            toggle("Wall collision", bind(boom, "collisionEnabled")),
            slider("Sensitivity", { min: 0.05, max: 0.6, step: 0.01 }, bind(boom, "sensitivity")),
          ],
        },
        {
          label: "Character",
          controls: [
            slider("Walk", { min: 1, max: 7, step: 0.1, format: metresPerSecond }, bind(controller, "walkSpeed")),
            slider("Sprint", { min: 2, max: 12, step: 0.1, format: metresPerSecond }, bind(controller, "sprintSpeed")),
            slider("Jump", { min: 0.2, max: 3, step: 0.05, format: metres }, bind(controller, "jumpHeight")),
            readout("Speed", (): string => metresPerSecond(controller.speed)),
            readout("Grounded", (): string => (controller.isGrounded ? "yes" : "no")),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [readout("Draw calls", (): string => String(app.renderer.drawCalls))],
        },
      ],
    });
  },
});

/**
 * Writes a distance.
 *
 * @param value - Metres.
 * @returns The text for a slider's or a readout's value cell.
 */
function metres(value: number): string {
  return `${value.toFixed(1)} m`;
}

/**
 * Writes a speed.
 *
 * @param value - Metres per second.
 * @returns The text for a slider's or a readout's value cell.
 */
function metresPerSecond(value: number): string {
  return `${value.toFixed(1)} m/s`;
}
