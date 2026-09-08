import {
  Camera,
  CharacterController,
  createMaterialAsset,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  physics,
  VirtualButton,
  VirtualJoystick,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, select, slider, toggle } from "../_kit/panel.ts";
import { createLightRig } from "../_kit/stage.ts";
import { buildCourse, gentleRampPoint, GENTLE_DEGREES, SPAWN, STEEP_DEGREES } from "./course.ts";
import { CHARACTER_ACTIONS, CharacterMotor, describeSlope, EYE_OFFSET } from "./motor.ts";
import type { ColorLike } from "ignifx";

/**
 * A `CharacterController`: a kinematic capsule that collides and slides, walks up a 30° ramp,
 * refuses a 60° one, stays on the surface on the way back down, and jumps.
 *
 * This file is the world and the panel. The lesson — the script that turns two actions into one
 * displacement per fixed step, and the slope rule it applies itself — is `motor.ts` beside it, and
 * the course whose angles are exact by construction is `course.ts`.
 *
 * The capsule is a `CharacterController` and nothing else: no `Rigidbody`, no collider component.
 * The controller *is* the body, it is kinematic, and it applies no gravity of its own.
 */

/** The clear colour: the site's dark `--bg`. */
const CLEAR: ColorLike = { r: 0.051, g: 0.063, b: 0.082, a: 1 };

/** The capsule's total height, in metres. */
const HEIGHT = 1.8;

/** The capsule's radius, in metres. */
const RADIUS = 0.35;

/**
 * Where Havok's WebAssembly binary is served from.
 *
 * @remarks
 * `@ignifx/physics` declares the file in `ignifx.assets.public`, so the Vite plugin copies it
 * **unhashed, by base name** into the public asset path. It is named here rather than left at
 * `havokWasm: "auto"`, which resolves the bare file name through the asset manifest, whose `root` is
 * the *relative* path `assets`: on a page served from `/examples/<slug>/run/` that resolves against
 * the document and asks for `…/run/assets/HavokPhysics.wasm`, which is a 404 and then `IGX-0903`.
 * Vite's own `BASE_URL` is the base the plugin wrote its URLs from, so this is right in `dev` and in
 * `build`.
 */
const HAVOK_WASM = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

/**
 * The slope limits the panel offers, as the labels it shows them under.
 *
 * @remarks
 * Three limits, none of them equal to a ramp's angle. `20°` puts the gentle ramp out of reach and
 * is the one worth trying: the surface the capsule walked up a moment ago becomes a wall. A limit
 * exactly equal to a ramp's angle — 30° or 60° — lands on the comparison's own boundary, where
 * whether the capsule climbs comes down to the last bit of a float, so neither is offered.
 */
const SLOPE_LIMITS: readonly string[] = ["20°", "45°", "65°"];

/** The slope limit the panel opens on: between the two ramps, which is the point of the course. */
const START_SLOPE_LIMIT = "45°";

/** The capsule's colour. */
const HERO_COLOR: ColorLike = { r: 0.878, g: 0.412, b: 0.169, a: 1 };

/** The plateau's and the gentle ramp's colour: the surfaces the capsule can walk. */
const SLAB_COLOR: ColorLike = { r: 0.38, g: 0.41, b: 0.48, a: 1 };

/** The steep ramp's colour, darker so the frame says which ramp is refused before you try it. */
const STEEP_COLOR: ColorLike = { r: 0.2, g: 0.22, b: 0.29, a: 1 };

/** The grid floor's tint. */
const FLOOR_COLOR: ColorLike = { r: 0.15, g: 0.17, b: 0.21, a: 1 };

/** How far the camera sits from what it is looking at, in metres. */
const CAMERA_DISTANCE = 8;

/** The camera's opening yaw, in degrees: straight behind the capsule, so forward is up the course. */
const CAMERA_YAW = 0;

/** The camera's opening pitch, in degrees: a third-person look over the capsule's shoulder. */
const CAMERA_PITCH = 26;

/** The character the panel writes an angle with, and strips before reading one back. */
const DEGREE_SIGN = "°";

/** The capture camera's yaw, in degrees: three-quarters on, so both ramps show their slope. */
const STATIC_YAW = 26;

/** The capture camera's pitch, in degrees. Steep enough to keep the horizon out of the frame. */
const STATIC_PITCH = 29;

/** How far up the gentle ramp the capsule is posed for a capture. */
const STATIC_FRACTION = 0.55;

/** Where the camera looks under `?static=1`: the middle of the course rather than the capsule. */
const STATIC_FOCUS = { x: -0.2, y: 1.05, z: 1.9 } as const;

/** How far the camera sits from the course under `?static=1`, in metres. */
const STATIC_DISTANCE = 10.5;

bootExample({
  title: "Character controller",
  extensions: [physics()],
  settings: {
    rendering: { clearColor: CLEAR, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
    physics: { havokWasm: HAVOK_WASM },
  },

  async setup({ app, panel, flags }) {
    app.registerComponents([CharacterMotor]);
    app.input.loadActions(CHARACTER_ACTIONS);

    const slab = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "slab", baseColor: SLAB_COLOR, metallic: 0, roughness: 0.82 }),
      [],
    );
    const steep = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "steep", baseColor: STEEP_COLOR, metallic: 0, roughness: 0.86 }),
      [],
    );
    await buildCourse(app, { slab, steep, floor: FLOOR_COLOR });

    // `?static=1` never runs a fixed step, so the capsule has to be *authored* where the poster
    // wants it: half way up the gentle ramp, feet on the surface.
    const stand = flags.isStatic ? gentleRampPoint(STATIC_FRACTION) : SPAWN;
    const hero = app.world.createEntity("Hero");
    hero.transform.localPosition.set(stand.x, stand.y + HEIGHT / 2, stand.z);
    const heroMaterial = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "hero", baseColor: HERO_COLOR, metallic: 0.1, roughness: 0.4 }),
      [],
    );
    hero.addComponent(MeshRenderer, {
      mesh: MeshAsset.capsule(app, { height: HEIGHT, radius: RADIUS }),
      materials: [heroMaterial],
      castShadows: true,
    });
    const controller = hero.addComponent(CharacterController, { height: HEIGHT, radius: RADIUS, slopeLimit: 45 });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 300, fov: 46 });
    const orbit = attachOrbit(app, eye, {
      yaw: flags.isStatic ? STATIC_YAW : CAMERA_YAW,
      pitch: flags.isStatic ? STATIC_PITCH : CAMERA_PITCH,
      distance: flags.isStatic ? STATIC_DISTANCE : CAMERA_DISTANCE,
      target: flags.isStatic ? STATIC_FOCUS : { x: stand.x, y: stand.y + HEIGHT / 2 + EYE_OFFSET, z: stand.z },
      minDistance: 3,
      maxDistance: 30,
    });
    const motor = hero.addComponent(CharacterMotor);
    // Under `?static=1` the motor keeps no camera, so the shot holds the authored pose above and
    // frames the whole course instead of following a capsule that will never move.
    motor.orbit = flags.isStatic ? null : orbit;
    // The key comes from in front and above, so both ramps' walkable faces are lit rather than
    // turned away from the only lamp in the scene.
    createLightRig(app, {
      focus: { x: 0, y: 0.9, z: 0 },
      keyPosition: { x: -4.5, y: 6.5, z: -6 },
      rimPosition: { x: 5, y: 3, z: 6 },
      keyIntensity: 2.8,
      shadowMapSize: 2048,
    });

    // The on-screen stick and button write `<Virtual>/joystick` and `<Virtual>/leap`, which the
    // action document already binds — so nothing else in this file knows a finger from a keyboard.
    let touch: { dispose(): void }[] = [];
    const setTouchControls = (on: boolean): void => {
      for (const widget of touch) {
        widget.dispose();
      }
      touch = on
        ? [
            new VirtualJoystick(app, { control: "joystick", style: { left: "1.5rem", bottom: "1.5rem" } }),
            new VirtualButton(app, { control: "leap", label: "▲", style: { right: "1.5rem", bottom: "1.5rem" } }),
          ]
        : [];
    };
    setTouchControls(app.platform.isMobile);

    panel({
      title: "Character controller",
      groups: [
        {
          label: "Move",
          controls: [
            slider(
              "Speed",
              { min: 1, max: 9, step: 0.2, format: (v: number): string => `${v.toFixed(1)} m/s` },
              bind(motor, "speed"),
            ),
            slider(
              "Jump",
              { min: 0.2, max: 2.4, step: 0.1, format: (v: number): string => `${v.toFixed(1)} m` },
              bind(motor, "jumpHeight"),
            ),
            // A `select` rather than a slider: `slopeLimit` is handed to Havok when the capsule is
            // built, so changing it rebuilds the controller — three choices means three rebuilds,
            // not one per pixel of drag.
            select("Slope limit", SLOPE_LIMITS, {
              value: START_SLOPE_LIMIT,
              change: (value: string): void => {
                controller.slopeLimit = Number(value.replace(DEGREE_SIGN, ""));
                controller.rebuild();
              },
            }),
            toggle("On-screen controls", { value: app.platform.isMobile, change: setTouchControls }),
            button("Respawn", (): void => {
              motor.respawn();
            }),
          ],
        },
        {
          label: "Ground",
          controls: [
            // Two answers, because they disagree and the difference is the lesson: what Havok's
            // own probe says, and what the script decides from the surface normal.
            readout("Standing", (): string => (motor.onGround ? "yes" : "no")),
            readout("Havok probe", (): string => controller.supportState),
            readout("Slope under foot", (): string => describeSlope(controller.groundNormal.y)),
            readout("Speed", (): string => `${controller.velocity.length().toFixed(1)} m/s`),
            readout("Air under foot", (): string => `${motor.gap.toFixed(2)} m`),
            readout("Height", (): string => `${hero.transform.position.y.toFixed(2)} m`),
          ],
        },
        {
          label: "Course",
          collapsed: true,
          controls: [
            readout("Gentle ramp", (): string => `${String(GENTLE_DEGREES)}°`),
            readout("Steep ramp", (): string => `${String(STEEP_DEGREES)}°`),
            readout("Last device", (): string => (app.input.currentScheme === "" ? "none" : app.input.currentScheme)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
