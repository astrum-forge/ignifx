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
 * A coin: a trigger that plays a one-shot and removes itself the first time the player touches it.
 *
 * The callback name is the 3D one (`onTriggerEnter`, not `onTriggerEnter2D`); only the payload is a
 * `TriggerEvent2D`. Both entities in a 2D trigger pair receive the callback and both sides of the
 * event are always real objects, so testing `other` is enough — 2D has none of the identity gaps
 * 3D physics documents.
 */
export class Collectible extends Script implements ScriptCallbacks {
  static typeId = "sidescroller/Collectible";

  /** The clip to play on pickup. Assigned when the coin is spawned. */
  clip: AssetHandle<AudioClip> | null = null;

  /** Counts what has been collected so far, so the log line means something. */
  static collected = 0;

  onTriggerEnter(trigger: unknown): void {
    if (!isTriggerEvent2D(trigger) || trigger.other?.name !== "Player") {
      return;
    }
    const handle = this.clip;
    if (handle !== null) {
      this.app.audio.playOneShot(handle.value, { volume: 0.5 });
    }
    Collectible.collected += 1;
    this.app.log.info("coin {count}", Collectible.collected);
    // `destroy` takes effect at the end of the frame, so the collider is still alive for the rest
    // of this fixed step and no other callback sees a half-removed entity.
    this.entity.destroy();
  }
}
