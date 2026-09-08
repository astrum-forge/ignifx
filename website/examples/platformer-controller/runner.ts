import {
  bool,
  CharacterController2D,
  defineInputActions,
  f32,
  Script,
  SpriteAnimator,
  SpriteRenderer,
  Vec2,
} from "ignifx";
import type { InputAction, MutableVec2, ScriptCallbacks, Tilemap } from "ignifx";

/**
 * The runner: everything about how the character *feels*, in one file, so `main.ts` is only the
 * scene it stands in.
 *
 * `CharacterController2D` is a kinematic box that collides and slides through Rapier and applies no
 * gravity of its own. That is what makes this script possible: it owns the vertical velocity, and
 * with it coyote time, a jump buffer, a variable jump height, and dropping through a plank.
 */

/** Below this height the runner has left the world through the pit, and is put back. */
const FALL_LIMIT = -2;

/** The actions the runner reads. Its own map, so the kit's camera actions are untouched. */
export const RUN_ACTIONS = defineInputActions({
  maps: [
    {
      name: "Course",
      actions: [
        {
          name: "move",
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
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.2)"] },
            { path: "<Gamepad>/dpad" },
            { path: "<Virtual>/joystick", processors: ["deadzone(0.15)"] },
          ],
        },
        {
          name: "jump",
          type: "button",
          bindings: [
            { path: "<Keyboard>/space" },
            { path: "<Keyboard>/z" },
            { path: "<Gamepad>/buttonSouth" },
            { path: "<Virtual>/jump" },
          ],
        },
      ],
    },
  ],
});

/**
 * Runs, jumps, cuts the jump short, remembers a press made just before landing, forgives one made
 * just after walking off a ledge, and drops through a plank on down-and-jump.
 *
 * Input is sampled in `update` and spent in `fixedUpdate`, because those are two different clocks.
 * `wasPressedThisFrame` is true for exactly one *frame*, and a frame carries zero, one or two fixed
 * steps: read it inside the step and a press is either missed or acted on twice.
 */
export class Runner
  extends Script.define({
    /** Top running speed, in metres per second. */
    speed: f32(7),
    /** How fast the run reaches top speed on the ground, in metres per second squared. */
    groundAcceleration: f32(70),
    /** The same in the air, where a smaller number means less control. */
    airAcceleration: f32(35),
    /** The upward speed a jump starts at, in metres per second. */
    jumpSpeed: f32(15),
    /** Downward acceleration while rising, in metres per second squared. */
    riseGravity: f32(36),
    /** Downward acceleration while falling; larger than `riseGravity` on purpose. */
    fallGravity: f32(52),
    /** The fastest the runner may fall, in metres per second. */
    terminalVelocity: f32(24),
    /** How long after walking off a ledge a jump still works, in seconds. */
    coyoteTime: f32(0.1),
    /** How long before landing a jump press is remembered, in seconds. */
    jumpBuffer: f32(0.12),
    /** What the rising velocity is multiplied by when the button is released early. */
    jumpCut: f32(0.45),
    /** Whether the sprite is mirrored when running left. */
    flipSprite: bool(true),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "platformer-controller/Runner";

  /** Where the map's objects layer put the runner, and where a fall puts her back. */
  spawn: MutableVec2 = new Vec2();

  /** The level, so a drop-through can ask what the runner is standing on. Assigned on spawn. */
  level: Tilemap | null = null;

  /** How many times the runner has been caught by the pit, for the panel. */
  falls = 0;

  #controller: CharacterController2D | null = null;
  #animator: SpriteAnimator | null = null;
  #sprite: SpriteRenderer | null = null;
  #move: InputAction | null = null;
  #jump: InputAction | null = null;

  /** The runner's velocity, in metres per second. The script owns it, not the controller. */
  readonly #velocity: MutableVec2 = new Vec2();

  /** The displacement handed to `move`, and the cell the drop-through reads. Both reused. */
  readonly #step: MutableVec2 = new Vec2();
  readonly #cell: MutableVec2 = new Vec2();

  #wishX = 0;
  #wishDown = false;
  #buffered = 0;
  #coyote = 0;
  #jumpHeld = false;
  #wasGrounded = true;
  #clip = "";

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController2D);
    this.#animator = this.entity.getComponent(SpriteAnimator);
    this.#sprite = this.entity.getComponent(SpriteRenderer);
    this.#move = this.app.input.actions.find("move");
    this.#jump = this.app.input.actions.find("jump");
  }

  update(dt: number): void {
    const vector = this.#move?.vector ?? null;
    this.#wishX = vector?.x ?? 0;
    this.#wishDown = vector !== null && vector.y < -0.5;
    this.#jumpHeld = this.#jump?.isPressed ?? false;
    if (this.#jump?.wasPressedThisFrame === true) {
      this.#buffered = this.jumpBuffer;
    } else if (this.#buffered > 0) {
      this.#buffered = Math.max(0, this.#buffered - dt);
    }
    this.#animate();
  }

  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    if (this.transform.position2D.y < FALL_LIMIT) {
      this.falls += 1;
      this.#velocity.set(0, 0);
      controller.teleport(this.spawn);
      return;
    }

    const grounded = controller.isGrounded;
    this.#wasGrounded = grounded;
    this.#coyote = grounded ? this.coyoteTime : Math.max(0, this.#coyote - dt);
    this.#accelerate(dt, grounded);

    if (this.#buffered > 0 && this.#coyote > 0) {
      this.#buffered = 0;
      if (grounded && this.#wishDown && this.#dropThrough(controller)) {
        this.#velocity.y = -6;
      } else {
        this.#coyote = 0;
        this.#velocity.y = this.jumpSpeed;
      }
    }

    // Releasing the button on the way up cuts the rise short. That is the whole of "variable jump
    // height": holding it gives the full arc, tapping gives a hop.
    if (!this.#jumpHeld && this.#velocity.y > 0) {
      this.#velocity.y *= this.jumpCut;
    }
    const gravity = this.#velocity.y > 0 ? this.riseGravity : this.fallGravity;
    this.#velocity.y = Math.max(-this.terminalVelocity, this.#velocity.y - gravity * dt);
    if (controller.isGrounded && this.#velocity.y < 0) {
      // Parked at a small negative value rather than zero: a growing downward velocity while
      // standing still would defeat `snapToGround` on the way down a ramp.
      this.#velocity.y = -1;
    }

    this.#step.set(this.#velocity.x * dt, this.#velocity.y * dt);
    controller.move(this.#step);

    // The controller reports what it *actually* did. Walking into a wall has to zero the stored
    // horizontal speed, or the runner keeps pressing into it and never accelerates away.
    const actual = controller.velocity;
    if (Math.abs(actual.x) < Math.abs(this.#velocity.x) * 0.5) {
      this.#velocity.x = actual.x;
    }
    if (this.#velocity.y > 0 && actual.y <= 0) {
      this.#velocity.y = 0;
    }
  }

  /**
   * Whether the runner is standing on something, for the panel.
   *
   * @returns `true` while the controller reported ground under the box on the last fixed step.
   */
  get isGrounded(): boolean {
    return this.#wasGrounded;
  }

  /**
   * The runner's current speed, for the panel.
   *
   * @returns The magnitude of the script's own velocity, in metres per second.
   */
  get speedNow(): number {
    return Math.hypot(this.#velocity.x, this.#velocity.y);
  }

  /**
   * Steps down through a one-way plank, if that is what the runner is standing on.
   *
   * @remarks
   * The runtime's rule is "solid only while the character is descending and its feet are at or
   * above the plank's top", so the way down is to put the feet below that top — and the way to know
   * it is safe is to ask the map. `Tilemap.worldToCell` is exact and free, and `collisionAt` answers
   * with the cell's own `oneWay` flag, so a drop-through can never open a hole in solid ground.
   *
   * A shape query would be the obvious alternative and is the wrong tool: a tilemap's collision is
   * a **merged outline**, so `overlapBox` with a small box entirely inside the ground crosses no
   * edge and reports nothing (measured 2026-09-08).
   *
   * @param controller - The controller to move.
   * @returns `true` when the runner was moved down through a plank.
   */
  #dropThrough(controller: CharacterController2D): boolean {
    const level = this.level;
    if (level === null) {
      return false;
    }
    const feet = this.transform.position2D;
    // A tenth of a metre below the feet is inside the cell that is holding them up.
    const cell = level.worldToCell({ x: feet.x, y: feet.y - 0.1 }, this.#cell);
    if (!level.collisionAt(cell.x, cell.y).oneWay) {
      return false;
    }
    controller.teleport({ x: feet.x, y: feet.y - 0.45 });
    return true;
  }

  /**
   * Moves the horizontal velocity toward the wished-for speed at the right acceleration.
   *
   * @param dt - The fixed step, in seconds.
   * @param grounded - Whether the runner is on the ground, which decides which rate is used.
   */
  #accelerate(dt: number, grounded: boolean): void {
    const target = this.#wishX * this.speed;
    const rate = (grounded ? this.groundAcceleration : this.airAcceleration) * dt;
    const delta = target - this.#velocity.x;
    this.#velocity.x += Math.abs(delta) <= rate ? delta : Math.sign(delta) * rate;
  }

  /** Chooses between idle, run, jump and fall, and mirrors the sprite. */
  #animate(): void {
    const sprite = this.#sprite;
    if (sprite !== null && this.flipSprite && Math.abs(this.#wishX) > 0.05) {
      sprite.flipX = this.#wishX < 0;
    }
    const clip = this.#wasGrounded
      ? Math.abs(this.#velocity.x) > 0.4
        ? "run"
        : "idle"
      : this.#velocity.y > 0
        ? "jump"
        : "fall";
    if (clip !== this.#clip) {
      this.#clip = clip;
      this.#animator?.play(clip);
    }
  }
}
