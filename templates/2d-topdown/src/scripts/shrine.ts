import { SpriteRenderer } from "@ignifx/2d";
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

/** The tint an unlit shrine pad is drawn with. */
const DARK = { r: 0.55, g: 0.55, b: 0.62, a: 1 } as const;

/** The tint a lit shrine pad is drawn with. */
const LIT = { r: 1, g: 0.94, b: 0.72, a: 1 } as const;

/**
 * A shrine: the trigger zone the player lights by standing on it.
 *
 * Lighting one is the template's unit of progress — it scores a point, plays the pickup sound and
 * asks `SaveGame` for a checkpoint — and its lit state is what a save file's `collected` list
 * holds, keyed by the entity name the tilemap's objects layer gave it.
 *
 * The callbacks are the **3D names** — `onTriggerEnter` and `onTriggerExit` — even though the
 * simulation is `@ignifx/physics-2d`; only the payload differs. There is no `onTriggerEnter2D`.
 */
export class Shrine extends Script implements ScriptCallbacks {
  static typeId = "topdown/Shrine";

  /** The clip to play when the shrine lights. Assigned when the shrine is spawned. */
  clip: AssetHandle<AudioClip> | null = null;

  /** Called the first time the player lights this shrine. Assigned when the shrine is spawned. */
  onLit: ((shrine: Shrine) => void) | null = null;

  /** The pad, so the tint can say whether the shrine is lit. */
  #sprite: SpriteRenderer | null = null;

  /** Whether the shrine has been lit. */
  #lit = false;

  awake(): void {
    this.#sprite = this.entity.getComponent(SpriteRenderer);
    this.#applyTint();
  }

  /**
   * The shrine's stable id, which is the name the tilemap's objects layer gave the entity.
   *
   * @returns The id a save file stores.
   */
  get id(): string {
    return this.entity.name;
  }

  /**
   * Whether the shrine is lit.
   *
   * @returns `true` once the player has stood on it.
   */
  get isLit(): boolean {
    return this.#lit;
  }

  /**
   * Lights or unlights the shrine without scoring it. This is what a save restore and a reset use.
   *
   * @param lit - Whether the shrine should read as lit.
   */
  setLit(lit: boolean): void {
    this.#lit = lit;
    this.#applyTint();
  }

  onTriggerEnter(trigger: unknown): void {
    if (!isTriggerEvent2D(trigger) || trigger.other?.name !== "Player" || this.#lit) {
      return;
    }
    this.setLit(true);
    const handle = this.clip;
    if (handle !== null) {
      // `playOneShot` routes into the `SFX` bus of `game.audio.json` by default. A browser keeps
      // its audio context suspended until the player has interacted with the page, so the very
      // first pickup may be the one that unlocks it rather than the one that is heard.
      this.app.audio.playOneShot(handle.value);
    }
    this.onLit?.(this);
    this.app.log.info("the shrine hums");
  }

  onTriggerExit(trigger: unknown): void {
    if (isTriggerEvent2D(trigger) && trigger.other?.name === "Player") {
      this.app.log.info("the shrine falls quiet");
    }
  }

  /** Writes the tint that matches the lit flag. */
  #applyTint(): void {
    const sprite = this.#sprite;
    if (sprite !== null) {
      sprite.color = this.#lit ? LIT : DARK;
    }
  }
}
