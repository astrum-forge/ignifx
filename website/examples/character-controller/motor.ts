/**
 * The script that walks the capsule, and the actions it reads.
 *
 * Three things are worth knowing before reading it.
 *
 * **The controller applies no gravity.** A bare `CharacterController` is purely kinematic:
 * `move(displacement)` is the whole input, and this script owns the vertical speed — which is why
 * it also owns jump feel, including the coyote window that keeps a jump alive for a moment after
 * walking off a ledge.
 *
 * **Movement is simulation, so it runs in `fixedUpdate`.** The input captured at frame start reads
 * the same in every fixed step of that frame, so 30 fps and 240 fps produce the same trajectory.
 * `move` accumulates within a step, so calling it twice is one displacement.
 *
 * **The slope rule is applied here, not by `isGrounded`.** See {@link isWalkable}; it is the one
 * thing about `CharacterController` a reader should take away from this example.
 */

import { CharacterController, defineInputActions, degToRad, f32, radToDeg, Script, Vec3 } from "ignifx";
import { SPAWN } from "./course.ts";
import type { OrbitCamera } from "../_kit/orbit.ts";
import type { ScriptCallbacks, Vec3Like } from "ignifx";

/** How fast the capsule walks, in metres per second. */
const START_SPEED = 4.2;

/** How high a jump reaches, in metres. */
const START_JUMP = 1.1;

/** Downward acceleration the script applies itself, in metres per second squared. */
const GRAVITY = -19;

/** How long after leaving the ground a jump still fires, in seconds. */
const COYOTE_SECONDS = 0.12;

/**
 * How far below its feet the capsule will still snap down to, in metres.
 *
 * @remarks
 * Bigger than any lip on the course and smaller than a fall. Inside it the capsule is on the
 * ground and the gap is closed in one step; outside it the capsule is in the air and gravity has
 * it.
 */
const SNAP_DISTANCE = 0.4;

/**
 * How hard a grounded capsule is pushed downwards, in metres per second.
 *
 * @remarks
 * This is the ground snap, and it is the number that makes the difference between a controller that
 * walks and one that hovers. `CharacterController.isGrounded` is Havok's `checkSupport` probe, whose
 * reach is a step of gravity — about 0.16 m at 60 Hz — so a capsule that has just walked off a
 * 0.28 m kerb is *still reported grounded* while a hand's width of air is under its feet. Zeroing
 * the fall speed there leaves it hovering: measured on 2026-09-08, the capsule crossed the kerb and
 * then walked the rest of the course 0.143 m above the floor, "supported" the whole way, because
 * the only thing pulling it down was one step of gravity per step.
 *
 * A constant downward push closes that gap in about a tenth of a second and costs nothing on flat
 * ground, where collide-and-slide absorbs it. It also *is* the feature: walking down the ramp keeps
 * the capsule on the surface instead of launching it off every lip. Small on purpose — on a slope
 * the push resolves along the surface, so a big one would drag a climbing capsule backwards.
 */
const GROUND_STICK = 2.5;

/** Where the camera looks relative to the capsule's centre, in metres. */
export const EYE_OFFSET = 0.4;

/** Straight down, for the snap ray. A module constant, so the per-step path allocates nothing. */
const DOWN: Vec3Like = { x: 0, y: -1, z: 0 };

/** The flattest a surface is treated as, when the resting height is worked out from its normal. */
const MIN_NORMAL_Y = 0.3;

/**
 * The actions the capsule is driven by, on every device the browser offers.
 *
 * @remarks
 * Its own map, so the kit orbit camera's `KitOrbit` map is untouched — `loadActions` merges by map
 * name. The control schemes are declared so `app.input.currentScheme` follows whichever device last
 * produced input, which is what the panel's "Last device" readout shows; scheme tags do not filter
 * bindings unless `input: { strictSchemes: true }`, so a gamepad works whatever the scheme says.
 *
 * `<Virtual>/…` is what `@ignifx/ui`'s `VirtualJoystick` and `VirtualButton` write, so the
 * on-screen controls need nothing here that a thumbstick does not.
 */
export const CHARACTER_ACTIONS = defineInputActions({
  controlSchemes: [
    { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
    { name: "Gamepad", devices: ["Gamepad"] },
    { name: "Touch", devices: ["Touch", "Virtual"] },
  ],
  maps: [
    {
      name: "Character",
      actions: [
        {
          name: "walk",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
            },
            {
              composite: "2DVector",
              up: "<Keyboard>/arrowUp",
              down: "<Keyboard>/arrowDown",
              left: "<Keyboard>/arrowLeft",
              right: "<Keyboard>/arrowRight",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.15)"] },
            { path: "<Gamepad>/dpad" },
            { path: "<Virtual>/joystick", processors: ["deadzone(0.15)"] },
          ],
        },
        {
          name: "leap",
          type: "button",
          bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }, { path: "<Virtual>/leap" }],
        },
      ],
    },
  ],
});

/**
 * Walks and jumps a `CharacterController` from the `walk` and `leap` actions, relative to where the
 * camera is looking, and drags the camera's target along behind it.
 *
 * @remarks
 * Camera-relative movement is two lines rather than a matrix: the orbit camera's yaw is the only
 * rotation in the shot, so forward is `(−sin yaw, 0, cos yaw)` and right is `(cos yaw, 0, sin yaw)`
 * in ignifx's left-handed, `+Z`-forward space. Reading the field rather than the transform is
 * deliberate — the transform carries the *damped* yaw, and a control that lags its own camera feels
 * broken.
 */
export class CharacterMotor
  extends Script.define({
    speed: f32(START_SPEED, { min: 0, tooltip: "Walking speed, in metres per second." }),
    jumpHeight: f32(START_JUMP, { min: 0, tooltip: "How high a jump reaches, in metres." }),
    gravity: f32(GRAVITY, { tooltip: "Downward acceleration the script applies, in m/s²." }),
    coyoteSeconds: f32(COYOTE_SECONDS, { min: 0, tooltip: "Grace period after a ledge in which a jump still fires." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "character-controller/CharacterMotor";

  /** The camera this walks relative to, and whose target it drags along. Assigned after attach. */
  orbit: OrbitCamera | null = null;

  /** The controller, found once. */
  #controller: CharacterController | null = null;

  /** Whether the surface under the capsule was walkable, and within reach, at the last step. */
  #onGround = false;

  /** The gap between the capsule's feet and the surface under them, in metres. */
  #gap = 0;

  /** The vertical speed the script owns, in metres per second. */
  #fall = 0;

  /** How long the capsule has been off the ground, in seconds. */
  #airborne = Number.POSITIVE_INFINITY;

  /** Reused so the per-step path allocates nothing (coding standards §7). */
  readonly #step = new Vec3();

  /** Finds the controller. */
  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController);
  }

  /**
   * Reads the frame's input, integrates gravity, and hands the controller one displacement.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    this.#gap = this.#gapBelow(controller);
    this.#onGround = this.#gap <= SNAP_DISTANCE && isWalkable(controller);
    this.#airborne = this.#onGround ? 0 : this.#airborne + dt;
    if (this.#onGround && this.#fall < 0) {
      // The ground snap. A gap the probe is willing to tolerate is closed in one step; with none
      // left, a small constant push keeps the capsule on the surface. See {@link GROUND_STICK}.
      this.#fall = this.#gap > 0 ? -this.#gap / dt : -GROUND_STICK;
    }
    const jump = this.app.input.actions.find("leap");
    if (jump?.wasPressedThisFrame === true && this.#airborne <= this.coyoteSeconds) {
      // From a height, not a speed: `v = sqrt(2·g·h)` is the jump a designer can actually author.
      this.#fall = Math.sqrt(2 * Math.abs(this.gravity) * this.jumpHeight);
      // Spend the window, so one press is one jump.
      this.#airborne = Number.POSITIVE_INFINITY;
    }
    this.#fall += this.gravity * dt;

    const walk = this.app.input.actions.find("walk")?.vector ?? { x: 0, y: 0 };
    const yaw = degToRad(this.orbit?.yaw ?? 0);
    const forwardX = -Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    this.#step.set(
      (walk.x * forwardZ + walk.y * forwardX) * this.speed * dt,
      this.#fall * dt,
      (walk.y * forwardZ - walk.x * forwardX) * this.speed * dt,
    );
    controller.move(this.#step);
  }

  /** Drags the camera's target onto the capsule, so the shot follows without a second component. */
  update(): void {
    const orbit = this.orbit;
    if (orbit === null) {
      return;
    }
    const at = this.transform.position;
    orbit.target = { x: at.x, y: at.y + EYE_OFFSET, z: at.z };
  }

  /**
   * Whether the surface under the capsule is one it can stand on. Read by the panel.
   *
   * @returns `true` when the last step found a walkable surface within reach.
   */
  get onGround(): boolean {
    return this.#onGround;
  }

  /**
   * How much air is under the capsule's feet. Read by the panel.
   *
   * @returns The gap in metres; `0` when the capsule is resting.
   */
  get gap(): number {
    return Math.max(0, this.#gap);
  }

  /**
   * How far the surface under the capsule is below its feet.
   *
   * @remarks
   * One downward ray, and it is what makes the snap exact rather than approximate. It is also the
   * only reliable answer available: Havok's support probe reaches about a step of gravity — 0.16 m
   * at 60 Hz — and reports a capsule that far off the ground as *supported*, so a controller that
   * trusted it hovered a hand's width above the floor for the rest of the level (measured
   * 2026-09-08: 0.143 m, indefinitely, after one small drop).
   *
   * A query answers only after one completed fixed step, so the first step of a run — and every
   * frame under `?static=1`, where no fixed step ever runs — reports no gap rather than `IGX-0902`.
   *
   * @param controller - The capsule, for its height and its skin width.
   * @returns The gap in metres; `0` when the capsule is resting or nothing is under it.
   */
  #gapBelow(controller: CharacterController): number {
    if (!this.app.physics.hasStepped) {
      return 0;
    }
    // How far the surface *should* be, straight down, when the capsule is resting on it. On a
    // slope that is more than half the capsule's height: the bottom cap touches the surface at a
    // point offset along the normal, so the vertical drop from the centre is the cap's radius
    // divided by the cosine of the slope. Without that term a capsule standing perfectly still on
    // the 30° ramp measures a 0.06 m "gap" and the snap below drags it back down the hill.
    const lean = Math.max(controller.groundNormal.y, MIN_NORMAL_Y);
    const feet = controller.height / 2 - controller.radius + (controller.radius + controller.skinWidth) / lean;
    const hit = this.app.physics.raycast(this.transform.position, DOWN, feet + SNAP_DISTANCE);
    return hit === null ? Number.POSITIVE_INFINITY : Math.max(0, hit.distance - feet);
  }

  /**
   * Puts the capsule back at the start line.
   *
   * @remarks
   * `teleport` rather than an assignment to the transform: it moves the controller without
   * integrating, and clears the swept motion Havok was carrying.
   */
  respawn(): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    this.#fall = 0;
    this.#airborne = Number.POSITIVE_INFINITY;
    controller.teleport({ x: SPAWN.x, y: SPAWN.y + controller.height / 2, z: SPAWN.z });
  }
}

/**
 * Whether the surface under the capsule is one it can stand on.
 *
 * @remarks
 * **`CharacterController.isGrounded` is not that question.** It reports Havok's own `checkSupport`
 * classification, and Babylon Lite 1.27.0 builds its character with `staticFriction = 0`
 * (`index.d.ts`, `PhysicsCharacterController`) — so a capsule on *any* incline is a capsule sliding
 * down it, and `isGrounded` reads `false` the moment the floor tilts. Measured on 2026-09-08: on the
 * 30° ramp below, `supportState` reported `"sliding"` and the capsule crept up 0.16 m and slid back.
 *
 * So the slope rule is applied here instead, against the surface normal and the controller's own
 * `slopeLimit` — which is exactly what `ThirdPersonController` in `@ignifx/3d` does, and what
 * `skills/ignifx/references/recipes/character-controller-3d.md` says a real game reaches for. The
 * `slopeLimit` field still does its other job: Havok stops the capsule dead on anything steeper,
 * which is why the 60° ramp is refused rather than merely slippery.
 *
 * @param controller - The capsule.
 * @returns `true` when the surface under it is within `slopeLimit`.
 */
function isWalkable(controller: CharacterController): boolean {
  return (
    controller.supportState !== "unsupported" && controller.groundNormal.y >= Math.cos(degToRad(controller.slopeLimit))
  );
}

/**
 * Writes the angle of the surface under the capsule.
 *
 * @param normalY - The ground normal's `y`, which is the cosine of the slope.
 * @returns The angle in degrees, or a dash when the capsule is in the air.
 */
export function describeSlope(normalY: number): string {
  if (normalY <= 0) {
    return "—";
  }
  return `${radToDeg(Math.acos(Math.min(1, normalY))).toFixed(0)}°`;
}
