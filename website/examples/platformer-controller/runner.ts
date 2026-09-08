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
import type { CharacterCollision2D, InputAction, MutableVec2, ScriptCallbacks, Tilemap, Vec2Like } from "ignifx";

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

/** Degrees to radians, for reading the controller's `slopeLimit` as an angle. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/** How sideways an unwalkable contact normal has to be to count as a wall. A brick's is 1. */
const WALL_NORMAL_X = 0.5;

/** How far down a contact normal has to point to count as a ceiling. */
const CEILING_NORMAL_Y = -0.5;

/** How far a ground normal has to lean before the run is rotated onto it; flat ground is exactly `(0, 1)`. */
const SLOPE_NORMAL_X = 0.01;

/** How much of the requested horizontal speed a step has to lose before a wall counts as stopping the runner. */
const WALL_STALL_RATIO = 0.5;

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
 *
 * Two rules here are the ones every platformer gets wrong the first time. **Walls are read from
 * contact normals, not from a short move**: collide-and-slide on a 45-degree ramp legitimately
 * returns about half the requested horizontal motion, so "I moved less than I asked, I must have hit
 * a wall" zeroes the run on every ramp and the runner crawls up it (measured 2026-09-08 at a
 * fraction of the run speed). `CharacterController2D.onCollided` reports a normal per obstacle
 * instead; a normal that is too steep to stand on *and* sideways is a wall, and only if it also
 * stalled the move. **The jump cut is a clamp applied once**, on the release edge: multiplying the
 * rise by a factor on *every* step the button is up compounds, so the same launch reached 0.4 m or
 * 3.4 m depending on how many frames a tap covered. `minJumpHeight` is what a tap is guaranteed.
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
    /**
     * The rise a *tapped* jump is guaranteed to reach, in metres. Releasing the button early clamps
     * the climb to this once; holding it gives the whole `jumpSpeed` arc.
     */
    minJumpHeight: f32(1.1),
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

  /** Whether the runner is on the way up from a jump, and whether that rise has been clamped yet. */
  #rising = false;
  #cut = false;

  /** What the previous fixed step touched: a wall on the right (`1`) or left (`-1`), a ceiling, the ground. */
  #blocked = 0;
  #ceiling = false;
  readonly #surface: MutableVec2 = new Vec2(0, 1);
  #surfaceY = -2;

  awake(): void {
    const controller = this.entity.requireComponent(CharacterController2D);
    this.#controller = controller;
    this.#animator = this.entity.getComponent(SpriteAnimator);
    this.#sprite = this.entity.getComponent(SpriteRenderer);
    this.#move = this.app.input.actions.find("move");
    this.#jump = this.app.input.actions.find("jump");
    // One call per obstacle the move touched, raised by the step system after this script's
    // `fixedUpdate`, so each step reads the previous step's contacts — the same one-step lag
    // `controller.velocity` has. The event is pooled: classify it here, keep nothing of it.
    controller.onCollided.connect(
      (hit: CharacterCollision2D): void => {
        this.#noteContact(hit.normal);
      },
      { owner: this },
    );
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
    if (grounded) {
      this.#rising = false;
    }
    this.#applyContacts(controller);
    this.#accelerate(dt, grounded);

    if (this.#buffered > 0 && this.#coyote > 0) {
      this.#buffered = 0;
      if (grounded && this.#wishDown && this.#dropThrough(controller)) {
        this.#velocity.y = -6;
      } else {
        this.#coyote = 0;
        this.#velocity.y = this.jumpSpeed;
        this.#rising = true;
        this.#cut = false;
      }
    }

    // The whole of "variable jump height", applied **once** per jump: the first step in which the
    // button is no longer held clamps the climb to what `minJumpHeight` needs. It can only shorten
    // a jump — released near the apex, the rise is already below the clamp and nothing happens.
    if (this.#rising && !this.#cut && !this.#jumpHeld) {
      this.#cut = true;
      this.#velocity.y = Math.min(this.#velocity.y, Math.sqrt(2 * this.riseGravity * this.minJumpHeight));
    }
    if (this.#velocity.y <= 0) {
      this.#rising = false;
    }
    const gravity = this.#velocity.y > 0 ? this.riseGravity : this.fallGravity;
    this.#velocity.y = Math.max(-this.terminalVelocity, this.#velocity.y - gravity * dt);
    if (controller.isGrounded && this.#velocity.y < 0) {
      // Parked at a small negative value rather than zero: a growing downward velocity while
      // standing still would defeat `snapToGround` on the way down a ramp.
      this.#velocity.y = -1;
    }

    this.#stepAlong(grounded, dt);
    controller.move(this.#step);
    // Whatever the contact handler hears from here on belongs to the step Rapier is about to run.
    this.#blocked = 0;
    this.#ceiling = false;
    this.#surface.set(0, 1);
    this.#surfaceY = -2;
  }

  /**
   * Applies the previous step's contacts: a wall that stalled the move zeroes the run, a ceiling
   * ends the rise.
   *
   * @param controller - The controller, for what the last step actually resolved.
   */
  #applyContacts(controller: CharacterController2D): void {
    if (this.#blocked !== 0 && Math.sign(this.#velocity.x) === this.#blocked) {
      const resolved = controller.velocity;
      if (Math.abs(resolved.x) < Math.abs(this.#velocity.x) * WALL_STALL_RATIO) {
        this.#velocity.x = 0;
      }
    }
    if (this.#ceiling && this.#velocity.y > 0) {
      this.#velocity.y = 0;
      this.#rising = false;
    }
  }

  /**
   * Turns the velocity into the displacement `move()` is given, rotated onto the ground the runner
   * stands on so a run follows a ramp at full speed instead of cutting across it at its cosine. A
   * jump is left alone: `jumpSpeed` goes straight up on a ramp as it does on the flat.
   *
   * @param grounded - Whether the runner is on the ground.
   * @param dt - The fixed step, in seconds.
   */
  #stepAlong(grounded: boolean, dt: number): void {
    const x = this.#velocity.x * dt;
    const y = this.#velocity.y * dt;
    const normal = this.#surface;
    if (!grounded || this.#velocity.y > 0 || Math.abs(normal.x) <= SLOPE_NORMAL_X) {
      this.#step.set(x, y);
      return;
    }
    this.#step.set(normal.y * x + normal.x * y, normal.y * y - normal.x * x);
  }

  /**
   * Files one contact normal as a ceiling, walkable ground, or a candidate wall.
   *
   * @param normal - The obstacle's outward normal at the contact point.
   */
  #noteContact(normal: Vec2Like): void {
    if (normal.y <= CEILING_NORMAL_Y) {
      this.#ceiling = true;
      return;
    }
    const limit = this.#controller?.slopeLimit ?? 45;
    if (normal.y >= Math.cos(limit * DEGREES_TO_RADIANS)) {
      // Walkable: the most upward-facing surface of the step is the one the run is rotated onto.
      if (normal.y > this.#surfaceY) {
        this.#surfaceY = normal.y;
        this.#surface.set(normal.x, normal.y);
      }
      return;
    }
    if (Math.abs(normal.x) > WALL_NORMAL_X) {
      // A wall on the runner's right pushes left, so its normal's x is negative.
      this.#blocked = normal.x < 0 ? 1 : -1;
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
