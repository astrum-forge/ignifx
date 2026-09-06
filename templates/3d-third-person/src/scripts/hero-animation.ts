import { Animator, ThirdPersonController } from "@ignifx/3d";
import { f32, Script } from "@ignifx/core";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, ScriptCallbacks } from "@ignifx/core";

/**
 * The one script that connects the character controller to the animation state machine, and plays
 * a footstep while the character is walking.
 *
 * `@ignifx/3d` deliberately does not do this for you: an `Animator` reads a document whose
 * parameter names are the game's, not the engine's, so the mapping from "how fast is this character
 * moving" to "what is the `speed` parameter called" belongs in the game. This is that mapping, and
 * `assets/hero.animator.json` is the other half of it.
 *
 * Everything here runs in `update`, not `fixedUpdate`. The controller has already moved on the
 * fixed step; the animator runs in `PostUpdate`, after `update`. Writing the parameters on the
 * frame clock therefore reaches the same frame's pose, and doing it on the fixed clock would write
 * the same values twice whenever a frame carried two steps.
 */
export class HeroAnimation
  extends Script.define({
    /** How far the character walks between footsteps, in metres. */
    strideMetres: f32(1.9),
    /** Below this speed, in m/s, the character is standing still and no footstep plays. */
    walkThreshold: f32(0.6),
  })
  implements ScriptCallbacks
{
  static typeId = "third-person/HeroAnimation";

  /** The footstep clip. Assigned by `main.ts`, because an asset handle is not a schema field here. */
  footstep: AssetHandle<AudioClip> | null = null;

  /** The state machine this drives. */
  #animator: Animator | null = null;

  /** The controller whose state the machine reads. */
  #controller: ThirdPersonController | null = null;

  /** Metres walked since the last footstep. */
  #stride = 0;

  /** Whether the jump trigger has already been set for the current airborne moment. */
  #jumpArmed = true;

  awake(): void {
    // `getComponentInChildren` and not `getComponent`: the `Animator` sits on the child entity that
    // carries the model, because a `CharacterController`'s capsule is centred on its own entity and
    // the rig's origin is between its feet. The two cannot share one transform.
    this.#animator = this.entity.getComponentInChildren(Animator);
    this.#controller = this.entity.requireComponent(ThirdPersonController);
    this.#animator?.onEvent.connect(
      (name: string): void => {
        if (name === "landed") {
          this.app.log.debug("the hero lands");
        }
      },
      { owner: this },
    );
  }

  update(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    const grounded = controller.isGrounded;
    const speed = controller.speed;

    const animator = this.#animator;
    if (animator !== null) {
      animator.setFloat("speed", speed);
      animator.setBool("grounded", grounded);
      // The trigger is armed on the ground and fired once on the way up, so a long hang time does
      // not re-enter the jump state every frame.
      if (grounded) {
        this.#jumpArmed = true;
      } else if (this.#jumpArmed && controller.verticalVelocity > 0) {
        this.#jumpArmed = false;
        animator.setTrigger("jump");
      }
    }

    if (!grounded || speed < this.walkThreshold) {
      this.#stride = 0;
      return;
    }
    this.#stride += speed * dt;
    if (this.#stride < this.strideMetres) {
      return;
    }
    this.#stride -= this.strideMetres;
    const clip = this.footstep;
    if (clip !== null) {
      // `playOneShot` routes into the `SFX` bus of `game.audio.json`. A browser keeps its audio
      // context suspended until the player has interacted with the page, so the first footstep may
      // be the one that unlocks it rather than the one that is heard.
      this.app.audio.playOneShot(clip.value, { volume: 0.5 });
    }
  }
}
