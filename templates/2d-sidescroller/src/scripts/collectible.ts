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
 * A coin: a trigger that plays a one-shot and takes itself off the board the first time the player
 * touches it.
 *
 * ## Deactivated, not destroyed
 *
 * Phase 6's version called `entity.destroy()`, which was right when a coin was a demonstration and
 * wrong now that the template has a save file: "Continue" has to put a level back the way the
 * player left it, and a destroyed entity cannot be un-destroyed. Setting `entity.active = false`
 * takes the sprite and the collider out of the world just as completely, and `setCollected(false)`
 * puts them back — which is what a save restore and "New game" both need.
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

  /** Called the first time the player takes this coin. Assigned when the coin is spawned. */
  onCollected: ((coin: Collectible) => void) | null = null;

  /** Whether the coin has been taken. */
  #taken = false;

  /**
   * The coin's stable id, which is the name the tilemap's objects layer gave the entity.
   *
   * @returns The id a save file stores.
   */
  get id(): string {
    return this.entity.name;
  }

  /**
   * Whether the coin has been taken.
   *
   * @returns `true` once the player has touched it.
   */
  get isTaken(): boolean {
    return this.#taken;
  }

  /**
   * Takes or replaces the coin without scoring it. This is what a save restore and a reset use.
   *
   * @param taken - Whether the coin should read as taken.
   */
  setCollected(taken: boolean): void {
    this.#taken = taken;
    this.entity.active = !taken;
  }

  onTriggerEnter(trigger: unknown): void {
    if (!isTriggerEvent2D(trigger) || trigger.other?.name !== "Player" || this.#taken) {
      return;
    }
    const handle = this.clip;
    if (handle !== null && handle.state === "loaded") {
      this.app.audio.playOneShot(handle.value, { volume: 0.5 });
    }
    this.setCollected(true);
    this.onCollected?.(this);
    this.app.log.info("coin {id}", this.id);
  }
}
