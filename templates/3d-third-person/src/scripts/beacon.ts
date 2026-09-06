import { f32, Script } from "@ignifx/core";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, Entity, MeshRenderer, ScriptCallbacks } from "@ignifx/core";

/**
 * A beacon: the emissive marker the player lights by walking up to it.
 *
 * Lighting one is the template's unit of progress — it scores a point, plays the pickup sound and
 * asks `SaveGame` for a checkpoint — and its lit state is what a save file's `collected` list
 * holds, keyed by the entity's name.
 *
 * ## Why a distance check and not a trigger volume
 *
 * A `BoxCollider` with `isTrigger` would be the obvious answer, and it is the right one for a body
 * Havok integrates. The player here is a `CharacterController`, which is a kinematic capsule the
 * script sweeps by hand, and whether Havok raises trigger events for it is not something
 * `@ignifx/physics`'s documentation promises. Three squared-distance tests per frame cost nothing
 * and are exactly as deterministic as the rest of the scene, so the template does not depend on an
 * unpromised behaviour.
 */
export class Beacon
  extends Script.define({
    /** How close the player has to come, in metres. */
    radius: f32(1.6),
  })
  implements ScriptCallbacks
{
  static typeId = "third-person/Beacon";

  /** The entity whose distance is measured. Assigned when the beacon is built. */
  player: Entity | null = null;

  /** The clip to play when the beacon lights. Assigned when the beacon is built. */
  clip: AssetHandle<AudioClip> | null = null;

  /** Called the first time the player lights this beacon. Assigned when the beacon is built. */
  onLit: ((beacon: Beacon) => void) | null = null;

  /** The emissive column, shown only while the beacon is lit. Assigned when the beacon is built. */
  column: MeshRenderer | null = null;

  /** The dark column, shown only while the beacon is dark. Assigned when the beacon is built. */
  unlitColumn: MeshRenderer | null = null;

  /** Whether the beacon has been lit. */
  #lit = false;

  /**
   * The beacon's stable id, which is the entity's name.
   *
   * @returns The id a save file stores.
   */
  get id(): string {
    return this.entity.name;
  }

  /**
   * Whether the beacon is lit.
   *
   * @returns `true` once the player has reached it.
   */
  get isLit(): boolean {
    return this.#lit;
  }

  /**
   * Lights or unlights the beacon without scoring it. This is what a save restore and a reset use.
   *
   * @param lit - Whether the beacon should read as lit.
   */
  setLit(lit: boolean): void {
    this.#lit = lit;
    // Exactly one of the two columns is drawn; see `src/level.ts` for why it is two renderers and
    // not one renderer with a swapped material.
    if (this.column !== null) {
      this.column.enabled = lit;
    }
    if (this.unlitColumn !== null) {
      this.unlitColumn.enabled = !lit;
    }
  }

  update(): void {
    const player = this.player;
    if (this.#lit || player === null || player.isDestroyed) {
      return;
    }
    const here = this.transform.position;
    const there = player.transform.position;
    const dx = here.x - there.x;
    const dz = here.z - there.z;
    if (dx * dx + dz * dz > this.radius * this.radius) {
      return;
    }
    this.setLit(true);
    const handle = this.clip;
    if (handle !== null && handle.state === "loaded") {
      this.app.audio.playOneShot(handle.value, { volume: 0.7 });
    }
    this.onLit?.(this);
    this.app.log.info("{name} lights up", this.id);
  }
}
