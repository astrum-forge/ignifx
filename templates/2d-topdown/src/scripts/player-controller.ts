import { SpriteAnimator } from "@ignifx/2d";
import { f32, Script, Vec2 } from "@ignifx/core";
import { CharacterController2D } from "@ignifx/physics-2d";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, MutableVec2, ScriptCallbacks } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";

/**
 * The four facings the art has, and the clip suffix each one uses.
 *
 * A stick can point anywhere; the sheet has four directions, so a diagonal snaps to whichever
 * cardinal it is closest to. That is what almost every top-down game with this kind of sheet does.
 */
const FACINGS = ["down", "left", "right", "up"] as const;

/** One of the four facings. */
type Facing = (typeof FACINGS)[number];

/**
 * Drives the player: reads `move` and `interact` once per frame, moves the character controller on
 * the fixed step, and keeps the animator on the clip that matches where the player is heading.
 *
 * The split matters. Input is sampled in `update`, because that is where a frame's device state is
 * settled and `wasPressedThisFrame` means what it says; the move is applied in `fixedUpdate`,
 * because that is the only clock the physics world advances on. Reading input inside `fixedUpdate`
 * would sample the same frame twice whenever a frame carries two fixed steps, and miss a press
 * entirely whenever it carries none.
 */
export class PlayerController
  extends Script.define({
    /** Metres per second on the ground. */
    speed: f32(4.5),
  })
  implements ScriptCallbacks
{
  static typeId = "topdown/PlayerController";

  /**
   * The footstep clip, or `null` when the browser refused to decode it. Assigned when the character
   * is spawned, so a hot-reloaded script does not re-request a file the asset service has already
   * delivered.
   */
  footstep: AssetHandle<AudioClip> | null = null;

  /**
   * Called with the names of everything the `interact` press found within arm's reach, so the front
   * end can say so. `null` under an app with no front end — a `?static=1` scene, or the frame-time
   * harness — in which case the answer only reaches the log.
   */
  onLookAround: ((names: readonly string[]) => void) | null = null;

  /** The controller this script drives, found on attach. */
  #controller: CharacterController2D | null = null;

  /** The animator, or `null` when the entity has none. */
  #animator: SpriteAnimator | null = null;

  /** The `move` action, resolved once the action maps are installed. */
  #move: InputAction | null = null;

  /** The `interact` action. */
  #interact: InputAction | null = null;

  /** This frame's movement direction, in `[-1, 1]` per axis. Reused, so the path allocates nothing. */
  readonly #wish: MutableVec2 = new Vec2();

  /** The displacement handed to the controller each fixed step. */
  readonly #step: MutableVec2 = new Vec2();

  /** Which way the character is facing. */
  #facing: Facing = "down";

  /** The clip that is playing, so `play` is called only when it actually changes. */
  #clip = "";

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController2D);
    this.#animator = this.entity.getComponent(SpriteAnimator);
    const actions = this.app.input.actions;
    this.#move = actions.find("move");
    this.#interact = actions.find("interact");
    // The two `footstep` markers in `hero.spriteanim.json`'s walk clips are what times the sound,
    // so a step lands on the frame the foot lands on rather than on a timer of our own.
    this.#animator?.onEvent.connect(
      (name: string): void => {
        if (name === "footstep") {
          this.#playFootstep();
        }
      },
      { owner: this },
    );
  }

  update(): void {
    const move = this.#move;
    if (move === null) {
      this.#wish.set(0, 0);
      return;
    }
    const vector = move.vector;
    // The action is already dead-zoned and clamped by its processors, so the only thing left is to
    // stop a diagonal from being 1.41 times faster than a straight line.
    const length = Math.hypot(vector.x, vector.y);
    if (length > 1) {
      this.#wish.set(vector.x / length, vector.y / length);
    } else {
      this.#wish.set(vector.x, vector.y);
    }

    if (this.#interact?.wasPressedThisFrame === true) {
      this.#lookAround();
    }
    this.#animate();
  }

  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    this.#step.set(this.#wish.x * this.speed * dt, this.#wish.y * this.speed * dt);
    controller.move(this.#step);
  }

  /** Plays one footstep, pitched a little differently each time so a run does not machine-gun. */
  #playFootstep(): void {
    const handle = this.footstep;
    if (handle !== null && handle.state === "loaded") {
      this.app.audio.playOneShot(handle.value, { volume: 0.5, pitch: 0.92 + Math.random() * 0.16 });
    }
  }

  /**
   * Reports what is within arm's reach. A real game would open the chest or read the sign; this is
   * the shortest honest demonstration of a 2D shape query, and of the fact that a query needs one
   * completed fixed step behind it (`IGX-1153`).
   *
   * @remarks
   * The answer goes to {@link PlayerController.onLookAround} as well as to the log, because a
   * control a player is told to press has to do something the player can see. A log line is not
   * that.
   */
  #lookAround(): void {
    const here = this.transform.position2D;
    const nearby = this.app.physics2d.overlapCircle(here, 1.2);
    const names: string[] = [];
    for (let index = 0; index < nearby.length; index += 1) {
      const entity = nearby[index];
      if (entity !== undefined && entity !== this.entity) {
        names.push(entity.name);
      }
    }
    this.app.log.info("interact: within reach:", names.length === 0 ? "nothing" : names.join(", "));
    this.onLookAround?.(names);
  }

  /** Chooses the facing from the movement vector and plays the matching clip. */
  #animate(): void {
    const animator = this.#animator;
    if (animator === null) {
      return;
    }
    const { x, y } = this.#wish;
    const moving = Math.abs(x) > 0.01 || Math.abs(y) > 0.01;
    if (moving) {
      this.#facing = Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "up" : "down";
    }
    const clip = `${moving ? "walk" : "idle"}_${this.#facing}`;
    if (clip !== this.#clip) {
      this.#clip = clip;
      animator.play(clip);
    }
  }
}
