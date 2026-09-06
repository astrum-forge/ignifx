import { SpriteAnimator, SpriteRenderer } from "@ignifx/2d";
import { bool, f32, Script, Vec2 } from "@ignifx/core";
import { CharacterController2D } from "@ignifx/physics-2d";
import type { MutableVec2, ScriptCallbacks, Vec2Like } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";

/** The probe box used to tell a thin platform from real ground, in metres. */
const PROBE_SIZE: Vec2Like = { x: 0.3, y: 0.3 };

/**
 * The reference platformer controller: coyote time, a jump buffer, a variable jump height, and
 * drop-through on one-way platforms.
 *
 * ## Why the input is read in `update` and the movement happens in `fixedUpdate`
 *
 * A `CharacterController2D` only moves when `move()` is called from a fixed step, and a frame may
 * carry zero, one or two of those. `wasPressedThisFrame`, on the other hand, is true for exactly
 * one *frame*. Reading it inside `fixedUpdate` therefore either misses a press (no step this
 * frame) or acts on it twice (two steps). So the frame captures intent — "jump was pressed", "the
 * stick is at x = -0.8" — and the fixed step consumes it.
 *
 * ## Why gravity is here rather than in the physics settings
 *
 * `physics2d`'s `gravity` accelerates *rigid bodies*. A character controller is kinematic: it goes
 * exactly where `move()` says. That is a feature — it is what lets this script use one gravity
 * going up and a stronger one coming down, which is the oldest trick in the genre and the reason
 * a jump feels "snappy" rather than floaty.
 */
export class PlatformerController
  extends Script.define({
    /** Top running speed, in metres per second. */
    speed: f32(7),
    /** How fast the run reaches top speed on the ground, in metres per second squared. */
    groundAcceleration: f32(70),
    /** The same in the air, where a smaller number means less control. */
    airAcceleration: f32(35),
    /** The upward speed a jump starts at, in metres per second. */
    jumpSpeed: f32(16),
    /** Downward acceleration while rising, in metres per second squared. */
    riseGravity: f32(36),
    /** Downward acceleration while falling; larger than `riseGravity` on purpose. */
    fallGravity: f32(52),
    /** The fastest the character may fall, in metres per second. */
    terminalVelocity: f32(24),
    /** How long after walking off a ledge a jump still works, in seconds. */
    coyoteTime: f32(0.1),
    /** How long before landing a jump press is remembered, in seconds. */
    jumpBuffer: f32(0.12),
    /** What the rising velocity is multiplied by when the jump button is released early. */
    jumpCut: f32(0.45),
    /** How far below its feet a drop-through moves the character, in metres. */
    dropClearance: f32(0.45),
    /**
     * How far below the feet the "is this thin enough to drop through?" probe looks, in metres.
     * Anything solid there means the character is standing on ground, not on a platform.
     */
    dropProbe: f32(0.5),
    /** The downward speed a drop-through starts at, in metres per second. */
    dropSpeed: f32(6),
    /** Whether the sprite is mirrored when running left. */
    flipSprite: bool(true),
  })
  implements ScriptCallbacks
{
  static typeId = "sidescroller/PlatformerController";

  #controller: CharacterController2D | null = null;
  #animator: SpriteAnimator | null = null;
  #sprite: SpriteRenderer | null = null;
  #move: InputAction | null = null;
  #jump: InputAction | null = null;

  /** The character's velocity in metres per second; the script owns it, not the controller. */
  readonly #velocity: MutableVec2 = new Vec2();

  /** The displacement handed to `move()`. Reused so the fixed step allocates nothing. */
  readonly #step: MutableVec2 = new Vec2();

  /** This frame's horizontal stick or key value, in `[-1, 1]`. */
  #wishX = 0;

  /** Whether the stick is pushed far enough down to mean "drop through". */
  #wishDown = false;

  /** Seconds left of the buffered jump press, or `0`. */
  #buffered = 0;

  /** Seconds left of coyote time, or `0`. */
  #coyote = 0;

  /** Whether the jump button is still held; releasing it early cuts the rise. */
  #jumpHeld = false;

  /** Scratch for the drop-through probe, so the press path allocates nothing of its own. */
  readonly #probe: MutableVec2 = new Vec2();

  /** The clip that is playing, so `play` is called only when it changes. */
  #clip = "";

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController2D);
    this.#animator = this.entity.getComponent(SpriteAnimator);
    this.#sprite = this.entity.getComponent(SpriteRenderer);
    const actions = this.app.input.actions;
    this.#move = actions.find("move");
    this.#jump = actions.find("jump");
  }

  update(dt: number): void {
    const move = this.#move;
    const vector = move === null ? null : move.vector;
    this.#wishX = vector === null ? 0 : vector.x;
    this.#wishDown = vector !== null && vector.y < -0.5;

    const jump = this.#jump;
    this.#jumpHeld = jump !== null && jump.isPressed;
    if (jump?.wasPressedThisFrame === true) {
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

    const grounded = controller.isGrounded;
    this.#coyote = grounded ? this.coyoteTime : Math.max(0, this.#coyote - dt);

    this.#accelerate(dt, grounded);

    if (this.#buffered > 0 && this.#coyote > 0) {
      this.#buffered = 0;
      if (grounded && this.#wishDown && this.#dropThrough(controller)) {
        this.#velocity.y = -this.dropSpeed;
      } else {
        this.#coyote = 0;
        this.#velocity.y = this.jumpSpeed;
      }
    }

    // Releasing the button on the way up cuts the rise short, which is the whole of "variable
    // jump height": holding it gives the full arc, tapping gives a hop.
    if (!this.#jumpHeld && this.#velocity.y > 0) {
      this.#velocity.y *= this.jumpCut;
    }

    const gravity = this.#velocity.y > 0 ? this.riseGravity : this.fallGravity;
    this.#velocity.y = Math.max(-this.terminalVelocity, this.#velocity.y - gravity * dt);
    if (controller.isGrounded && this.#velocity.y < 0) {
      // Standing still on the ground with a growing downward velocity would defeat `snapToGround`
      // on the way down a slope, so it is parked at a small negative value instead of zero.
      // `isGrounded` is re-read because a drop-through has just moved the character off its floor.
      this.#velocity.y = -1;
    }

    this.#step.set(this.#velocity.x * dt, this.#velocity.y * dt);
    controller.move(this.#step);

    // The controller reports what it *actually* did. Walking into a wall has to zero the stored
    // horizontal speed, or the character keeps pressing into it and never accelerates away.
    const actual = controller.velocity;
    if (Math.abs(actual.x) < Math.abs(this.#velocity.x) * 0.5) {
      this.#velocity.x = actual.x;
    }
    if (this.#velocity.y > 0 && actual.y <= 0) {
      this.#velocity.y = 0;
    }
  }

  /**
   * Steps down off a one-way platform, if that is what the character is standing on.
   *
   * @remarks
   * `CharacterController2D.onOneWayPlatforms` is not the switch it sounds like: leaving it on is
   * what makes a platform passable from below, and turning it off makes it solid from *both*
   * sides. The rule the runtime applies is "solid only while the character is descending and its
   * feet are already at or above the platform's top", so the way down is to put the feet below
   * that top — after which the platform stops existing for this character until it lands on it
   * again.
   *
   * The probe is what keeps that from being a hole in the world: a box half a metre under the feet
   * finds solid ground under solid ground, and finds nothing under a plank. `overlapBox` needs one
   * completed fixed step behind it (`IGX-1153`), which by definition it has here.
   *
   * @param controller - The controller to move.
   * @returns `true` when the character was moved down through a platform.
   */
  #dropThrough(controller: CharacterController2D): boolean {
    const feet = this.transform.position2D;
    this.#probe.set(feet.x, feet.y - this.dropProbe);
    if (this.app.physics2d.overlapBox(this.#probe, PROBE_SIZE).length > 0) {
      return false;
    }
    controller.teleport({ x: feet.x, y: feet.y - this.dropClearance });
    return true;
  }

  /** Moves the horizontal velocity toward the wished-for speed at the right acceleration. */
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
    const animator = this.#animator;
    const controller = this.#controller;
    if (animator === null || controller === null) {
      return;
    }
    const clip = controller.isGrounded
      ? Math.abs(this.#velocity.x) > 0.4
        ? "run"
        : "idle"
      : this.#velocity.y > 0
        ? "jump"
        : "fall";
    if (clip !== this.#clip) {
      this.#clip = clip;
      animator.play(clip);
    }
  }
}
