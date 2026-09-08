import { SpriteAnimator, SpriteRenderer } from "@ignifx/2d";
import { bool, f32, Script, Vec2 } from "@ignifx/core";
import { CharacterController2D } from "@ignifx/physics-2d";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, MutableVec2, ScriptCallbacks, Vec2Like } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";
import type { CharacterCollision2D } from "@ignifx/physics-2d";

/** The probe box used to tell a thin platform from real ground, in metres. */
const PROBE_SIZE: Vec2Like = { x: 0.3, y: 0.3 };

/** Degrees to radians, for reading `slopeLimit` as an angle. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * How sideways an *unwalkable* contact normal has to be before the surface is a candidate wall
 * rather than a ledge the character clipped a corner of. A brick's normal is 1 across.
 */
const WALL_NORMAL_X = 0.5;

/** How far down a contact normal has to point before the surface counts as a ceiling. */
const CEILING_NORMAL_Y = -0.5;

/** The slope limit assumed if the controller has gone away mid-frame, in degrees. */
const DEFAULT_SLOPE_LIMIT = 45;

/**
 * How far a ground normal has to lean before the run is rotated onto it. Flat ground reports
 * exactly `(0, 1)`, so this only has to be above the noise in a merged tilemap outline.
 */
const SLOPE_NORMAL_X = 0.01;

/**
 * How much of the requested horizontal speed a step has to lose before an unwalkable contact
 * counts as a wall that stopped the character rather than one it brushed past.
 */
const WALL_STALL_RATIO = 0.5;

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
 *
 * ## Why walls and ceilings are read from contact normals
 *
 * The obvious test — "the controller moved less than I asked for, so I hit something" — is wrong on
 * a slope. Collide-and-slide on a 45-degree surface legitimately returns about half the requested
 * horizontal motion, so a controller that zeroes its stored speed on that reading re-accelerates
 * from a standstill every fixed step and the character crawls up the hill at a fraction of its run
 * speed (measured 2026-09-08: 0.5 m/s against a designed 7). `CharacterController2D.onCollided`
 * reports the *geometry* instead — a normal per obstacle the move touched — and a normal sorts the
 * contact: pointing down is a ceiling, walkable is the surface the run is rotated onto, and too
 * steep to stand on *and* sideways is a candidate wall, confirmed by the short-move test the normal
 * has already kept slopes out of. The hits land after `fixedUpdate` (the step system runs at
 * `FixedUpdate +100`), so each step consumes the previous step's contacts, which is the same
 * one-step lag `controller.velocity` already has.
 *
 * ## Why a tap and a hold both give a usable jump
 *
 * Multiplying the rising velocity by a "cut" factor on *every* step the button is up compounds:
 * the same 16 m/s launch reached 0.41 m when the button was released after one frame and 3.42 m
 * when it was held (measured 2026-09-08), which is not a variable jump height so much as a
 * lottery. The genre's answer is to apply the cut **once**, on the release edge, as a clamp: the
 * rise is capped at whatever `minJumpHeight` needs and never below it, so the shortest possible tap
 * still clears a tile and a held button still reaches the top of the arc.
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
    /**
     * The rise a *tapped* jump is guaranteed to reach, in metres — a little over one tile.
     * Releasing the button early clamps the climb to this once; holding it gives the whole
     * `jumpSpeed` arc.
     */
    minJumpHeight: f32(1.1),
    /**
     * Below this height, in metres, the character has fallen out of the level and is put back on
     * the last ground it stood on. The map's floor is `y = 0` and its two pits are bottomless.
     */
    fallLimit: f32(-3),
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

  /** The footstep clip, or `null`. Assigned when the character is spawned. */
  footstep: AssetHandle<AudioClip> | null = null;

  /** The jump clip, or `null`. Assigned when the character is spawned. */
  jumpSound: AssetHandle<AudioClip> | null = null;

  /** The landing clip, or `null`. Assigned when the character is spawned. */
  landSound: AssetHandle<AudioClip> | null = null;

  /** Whether the character was on the ground at the end of the previous fixed step. */
  #wasGrounded = true;

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

  /** Whether the character is on the way up from a jump this script started. */
  #rising = false;

  /** Whether the rise of the current jump has already been clamped, so it is clamped only once. */
  #cut = false;

  /**
   * Which way a wall blocked the character on the previous fixed step: `1` for a wall on its
   * right, `-1` for one on its left, `0` for neither. Written from `onCollided`.
   */
  #blocked = 0;

  /** Whether the previous fixed step ended against a ceiling. Written from `onCollided`. */
  #ceiling = false;

  /**
   * The most upward-facing walkable normal the previous fixed step touched, or `(0, 1)` when it
   * touched nothing. This is the surface the run is rotated onto.
   *
   * @remarks
   * `CharacterController2D.groundNormal` is not used for this: it keeps the last normal it was
   * given, so at the crest of a hill it still reads as the slope and the run rotates itself off
   * the flat ground it has just reached, one launch per step.
   */
  readonly #surface: MutableVec2 = new Vec2(0, 1);

  /** The `y` of {@link PlatformerController.#surface}, so the best of a step's normals wins. */
  #surfaceY = -2;

  /** The last place the character stood, which is where a fall out of the level puts it back. */
  readonly #safeGround: MutableVec2 = new Vec2();

  /** Scratch for the drop-through probe, so the press path allocates nothing of its own. */
  readonly #probe: MutableVec2 = new Vec2();

  /** The clip that is playing, so `play` is called only when it changes. */
  #clip = "";

  /**
   * The character's velocity, in metres per second.
   *
   * @remarks
   * The script owns this, not the controller: a kinematic character has no velocity of its own,
   * and `CharacterController2D.velocity` reports what the *last* step resolved rather than what
   * this one intends.
   *
   * @returns A live view; copy it if you keep it.
   */
  get velocity(): Vec2Like {
    return this.#velocity;
  }

  /**
   * Where a fall out of the level puts the character back: the last ground it stood on, or its
   * spawn until it has stood anywhere.
   *
   * @returns A live view; copy it if you keep it.
   */
  get respawnPoint(): Vec2Like {
    return this.#safeGround;
  }

  awake(): void {
    const controller = this.entity.requireComponent(CharacterController2D);
    this.#controller = controller;
    this.#animator = this.entity.getComponent(SpriteAnimator);
    this.#sprite = this.entity.getComponent(SpriteRenderer);
    const here = this.transform.position2D;
    this.#safeGround.set(here.x, here.y);
    // One handler per obstacle the move touched, raised from the step system at `FixedUpdate +100`
    // — after this script's `fixedUpdate`. Each normal is classified here and thrown away rather
    // than kept: the event object and its vectors are reused for every hit of every step.
    controller.onCollided.connect(
      (hit: CharacterCollision2D): void => {
        this.#noteContact(hit.normal);
      },
      { owner: this },
    );
    const actions = this.app.input.actions;
    this.#move = actions.find("move");
    this.#jump = actions.find("jump");
    // The two `footstep` markers in `hero.spriteanim.json`'s run clip are what time the sound, so a
    // step lands on the frame the foot lands on rather than on a timer of our own.
    this.#animator?.onEvent.connect(
      (name: string): void => {
        if (name === "footstep") {
          this.#playClip(this.footstep, 0.45);
        }
      },
      { owner: this },
    );
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

    const here = this.transform.position2D;
    if (here.y < this.fallLimit) {
      // Both pits in `level.tilemap.json` are bottomless, so without this the character falls for
      // ever behind a camera clamped at the level's lower bound.
      this.respawn();
      return;
    }

    const grounded = controller.isGrounded;
    if (grounded && !this.#wasGrounded) {
      this.#playClip(this.landSound, 0.5);
    }
    this.#wasGrounded = grounded;
    this.#coyote = grounded ? this.coyoteTime : Math.max(0, this.#coyote - dt);
    if (grounded) {
      // Standing anywhere makes that spot the place a fall puts the character back, which is the
      // lip of the pit it just ran off rather than the far side of the level.
      this.#safeGround.set(here.x, here.y);
      this.#rising = false;
    }

    this.#applyContacts(controller);
    this.#accelerate(dt, grounded);

    if (this.#buffered > 0 && this.#coyote > 0) {
      this.#buffered = 0;
      if (grounded && this.#wishDown && this.#dropThrough(controller)) {
        this.#velocity.y = -this.dropSpeed;
      } else {
        this.#coyote = 0;
        this.#velocity.y = this.jumpSpeed;
        this.#rising = true;
        this.#cut = false;
        this.#playClip(this.jumpSound, 0.55);
      }
    }

    // The whole of "variable jump height", applied **once** per jump: the first step in which the
    // button is no longer held clamps the climb to what `minJumpHeight` needs. A clamp rather than
    // a multiplier is what makes the shortest tap and a one-frame-longer tap land in the same
    // place, and it can only ever shorten a jump — a button released near the apex finds the rise
    // already below the clamp and nothing happens.
    if (this.#rising && !this.#cut && !this.#jumpHeld) {
      this.#cut = true;
      this.#velocity.y = Math.min(this.#velocity.y, this.#shortJumpSpeed());
    }
    if (this.#velocity.y <= 0) {
      this.#rising = false;
    }

    const gravity = this.#velocity.y > 0 ? this.riseGravity : this.fallGravity;
    this.#velocity.y = Math.max(-this.terminalVelocity, this.#velocity.y - gravity * dt);
    if (controller.isGrounded && this.#velocity.y < 0) {
      // Standing still on the ground with a growing downward velocity would defeat `snapToGround`
      // on the way down a slope, so it is parked at a small negative value instead of zero.
      // `isGrounded` is re-read because a drop-through has just moved the character off its floor.
      this.#velocity.y = -1;
    }

    this.#stepAlong(grounded, dt);
    controller.move(this.#step);
    // Everything the contact handler collects from here on belongs to the step Rapier is about to
    // run, which the *next* `fixedUpdate` reads.
    this.#forgetContacts();
  }

  /**
   * Applies the previous fixed step's contacts to the stored velocity: a wall zeroes the run, a
   * ceiling ends the rise.
   *
   * @remarks
   * A wall has to be both things at once. A normal alone is not enough: the leading vertex of a
   * slope reports a normal 56 degrees off vertical for one step as the box rides onto it, and
   * treating that as a wall costs the character its whole run speed at the foot of every hill.
   * A short move alone is not enough either, for the reason in the class comment. So the test is
   * "the surface was too steep to stand on **and** the character barely moved along it", and the
   * slope's leading vertex fails the second half — the step it reports on resolved the full
   * 7 m/s.
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

  /** Starts collecting contacts for the step that is about to run. */
  #forgetContacts(): void {
    this.#blocked = 0;
    this.#ceiling = false;
    this.#surface.set(0, 1);
    this.#surfaceY = -2;
  }

  /**
   * Turns the velocity into the displacement `move()` is given, rotated onto the ground the
   * character is standing on.
   *
   * @remarks
   * A horizontal request on a slope is not a horizontal move: collide-and-slide projects it onto
   * the surface, and a 45-degree surface keeps only `cos 45` of its length — so a run that follows
   * the ground rather than cutting across it is the difference between 3.3 m/s up the level's first
   * hill and the designed 7 along it (measured 2026-09-08). Rotating the *whole* velocity, rather than
   * only its horizontal half, is what keeps the small downward bias below `snapToGround` pointing
   * into the surface instead of into the hill.
   *
   * A jump is left alone: `jumpSpeed` goes straight up on a slope as it does on the flat, which is
   * what a player expects and what keeps the arc the level's coins were placed against.
   *
   * @param grounded - Whether the character is on the ground.
   * @param dt - The fixed step, in seconds.
   */
  #stepAlong(grounded: boolean, dt: number): void {
    const velocityX = this.#velocity.x * dt;
    const velocityY = this.#velocity.y * dt;
    const normal = this.#surface;
    if (!grounded || this.#velocity.y > 0 || Math.abs(normal.x) <= SLOPE_NORMAL_X) {
      this.#step.set(velocityX, velocityY);
      return;
    }
    this.#step.set(normal.y * velocityX + normal.x * velocityY, normal.y * velocityY - normal.x * velocityX);
  }

  /**
   * Puts the character back on the last ground it stood on and clears everything the fall left
   * behind. Nothing is scored and nothing is saved: falling into a pit costs progress through the
   * level, not the coins already taken.
   */
  respawn(): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    // Through the controller, not the transform: a character controller owns a kinematic body, and
    // writing the transform under it leaves the body where it was until the next move.
    controller.teleport({ x: this.#safeGround.x, y: this.#safeGround.y });
    this.#velocity.set(0, 0);
    this.#buffered = 0;
    this.#coyote = 0;
    this.#rising = false;
    this.#cut = false;
    this.#forgetContacts();
    this.#wasGrounded = true;
    this.#playClip(this.landSound, 0.6);
  }

  /**
   * The rising speed a released jump is clamped to: exactly enough to climb `minJumpHeight`
   * against `riseGravity`.
   *
   * @returns The speed, in metres per second.
   */
  #shortJumpSpeed(): number {
    return Math.sqrt(2 * this.riseGravity * this.minJumpHeight);
  }

  /**
   * Files one of the previous step's contact normals as a wall, a ceiling, or ground.
   *
   * @remarks
   * The normal is the obstacle's outward normal, so a wall to the character's right reports
   * `x = -1` and a ceiling reports `y = -1`. "Too steep to stand on" is the controller's own
   * `slopeLimit`, which is what keeps a 45-degree slope — normal `y` of 0.707 against a limit of
   * 50 degrees, or 0.643 — out of the wall case.
   *
   * @param normal - The obstacle's outward normal at the contact point.
   */
  #noteContact(normal: Vec2Like): void {
    if (normal.y <= CEILING_NORMAL_Y) {
      this.#ceiling = true;
      return;
    }
    const limit = this.#controller?.slopeLimit ?? DEFAULT_SLOPE_LIMIT;
    if (normal.y >= Math.cos(limit * DEGREES_TO_RADIANS)) {
      // Walkable, so it is the surface the run is rotated onto. The most upward-facing one wins,
      // which is what keeps a wall the character is also brushing out of the answer.
      if (normal.y > this.#surfaceY) {
        this.#surfaceY = normal.y;
        this.#surface.set(normal.x, normal.y);
      }
      return;
    }
    if (Math.abs(normal.x) > WALL_NORMAL_X) {
      // The obstacle's normal points away from its surface, so a wall the character runs into on
      // its right pushes left. Whether it actually stopped the character is decided in
      // `#applyContacts`.
      this.#blocked = normal.x < 0 ? 1 : -1;
    }
  }

  /**
   * Plays one clip on the `SFX` bus, pitched a little differently each time so a run does not
   * machine-gun.
   *
   * @param handle - The clip's handle, or `null` when the template did not load one.
   * @param volume - The gain to play it at.
   */
  #playClip(handle: AssetHandle<AudioClip> | null, volume: number): void {
    if (handle !== null && handle.state === "loaded") {
      this.app.audio.playOneShot(handle.value, { volume, pitch: 0.94 + Math.random() * 0.12 });
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
