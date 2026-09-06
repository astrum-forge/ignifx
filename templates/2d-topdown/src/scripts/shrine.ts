import { Script } from "@ignifx/core";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, ScriptCallbacks } from "@ignifx/core";
import type { TriggerEvent2D } from "@ignifx/physics-2d";

/**
 * Narrows the `unknown` a trigger callback receives.
 *
 * @remarks
 * `ScriptCallbacks` types the payload as `unknown` because `@ignifx/core` cannot depend on either
 * physics package — the same callback carries a 3D `TriggerEvent` in a 3D game. A type guard is
 * used rather than an assertion so that nothing is claimed about a value that was not checked.
 *
 * @param value - Whatever the runtime passed.
 * @returns `true` when the payload is a 2D trigger event.
 */
function isTriggerEvent2D(value: unknown): value is TriggerEvent2D {
  return typeof value === "object" && value !== null && "self" in value && "other" in value;
}

/**
 * The trigger zone: it plays a one-shot the first time the player steps onto the pad and arms
 * itself again once they step off.
 *
 * The callbacks are the **3D names** — `onTriggerEnter` and `onTriggerExit` — even though the
 * simulation is `@ignifx/physics-2d`; only the payload differs. There is no `onTriggerEnter2D`.
 */
export class Shrine extends Script implements ScriptCallbacks {
  static typeId = "topdown/Shrine";

  /** The clip to play. Assigned when the shrine is spawned. */
  clip: AssetHandle<AudioClip> | null = null;

  onTriggerEnter(trigger: unknown): void {
    if (!isTriggerEvent2D(trigger) || trigger.other?.name !== "Player") {
      return;
    }
    const handle = this.clip;
    if (handle !== null) {
      // `playOneShot` routes into the `SFX` bus of `game.audio.json` by default. A browser keeps
      // its audio context suspended until the player has interacted with the page, so the very
      // first chime may be the one that unlocks it rather than the one that is heard.
      this.app.audio.playOneShot(handle.value);
    }
    this.app.log.info("the shrine hums");
  }

  onTriggerExit(trigger: unknown): void {
    if (isTriggerEvent2D(trigger) && trigger.other?.name === "Player") {
      this.app.log.info("the shrine falls quiet");
    }
  }
}
