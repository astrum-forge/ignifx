import type { LayerTable } from "./layer-table.js";

/**
 * A set of layer slots as one 32-bit word (`docs/architecture/02-scene-graph.md` §7). Masks are
 * immutable: {@link LayerMask.with} and {@link LayerMask.without} return new masks, so a mask
 * handed to a physics query can be shared without defensive copying.
 */

/** The mask with every one of the 32 slots set. Written unsigned so it stays a positive number. */
const ALL_BITS = 0xff_ff_ff_ff;

/**
 * An immutable set of layer slots.
 *
 * @remarks
 * Two ways in, deliberately:
 *
 * - **Scripts use `world.layers.mask("Player", "Enemy")`** — names, resolved through the project's
 *   {@link LayerTable}, which is what makes files rename-safe.
 * - {@link LayerMask.of} takes slot **indices**, for code that already resolved names (a system
 *   caching `entity.layer` at `awake`, say) and for tests.
 *
 * There is no name-taking static, because resolving a name needs the project's table and a static
 * has no access to one; {@link LayerMask.fromNames} is the standalone form that takes the table
 * explicitly.
 *
 * @example
 * ```ts
 * class Hitbox extends Script {
 *   #hostiles = LayerMask.nothing();
 *   awake(): void {
 *     this.#hostiles = this.world.layers.mask("Enemy", "Projectile");
 *   }
 *   onTriggerEnter(other: TriggerEvent): void {
 *     if (this.#hostiles.has(other.entity.layer)) {
 *       this.takeDamage();
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export class LayerMask {
  /** The 32 slot bits, read as an unsigned word. */
  readonly bits: number;

  /**
   * Wraps a raw bit word. Prefer {@link LayerMask.of}, {@link LayerMask.fromNames}, or
   * `world.layers.mask(...)`.
   *
   * @param bits - The bit word; only the low 32 bits are kept.
   */
  constructor(bits: number) {
    this.bits = bits >>> 0;
  }

  /**
   * Builds a mask from layer slot indices.
   *
   * @param layers - The slots to include; values outside `[0, 31]` are ignored.
   * @returns The mask.
   *
   * @example
   * ```ts
   * LayerMask.of(0, 8).bits; // 0b100000001
   * ```
   */
  static of(...layers: readonly number[]): LayerMask {
    let bits = 0;
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index] ?? -1;
      if (layer >= 0 && layer < 32) {
        bits |= 1 << layer;
      }
    }
    return new LayerMask(bits);
  }

  /**
   * Builds a mask from layer names resolved through a table — the standalone form of
   * `world.layers.mask(...)`.
   *
   * @param table - The project's layer table.
   * @param names - The layer names to include.
   * @returns The mask.
   * @throws IgnifxError with code `IGX-0303` when a name is not declared.
   */
  static fromNames(table: LayerTable, names: readonly string[]): LayerMask {
    let bits = 0;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (name !== undefined) {
        bits |= 1 << table.requireIndex(name);
      }
    }
    return new LayerMask(bits);
  }

  /**
   * Wraps a bit word that was stored or received from another system.
   *
   * @param bits - The bit word.
   * @returns The mask.
   */
  static fromBits(bits: number): LayerMask {
    return new LayerMask(bits);
  }

  /**
   * The mask with no slots set.
   *
   * @returns An empty mask.
   */
  static nothing(): LayerMask {
    return new LayerMask(0);
  }

  /**
   * The mask with all 32 slots set.
   *
   * @returns A full mask.
   */
  static everything(): LayerMask {
    return new LayerMask(ALL_BITS);
  }

  /**
   * Reports whether a slot is in the mask.
   *
   * @param layer - The slot index.
   * @returns `true` when the slot's bit is set.
   */
  has(layer: number): boolean {
    if (layer < 0 || layer >= 32) {
      return false;
    }
    return (this.bits & (1 << layer)) !== 0;
  }

  /**
   * Adds a slot.
   *
   * @param layer - The slot index; out-of-range values are ignored.
   * @returns A new mask; this one is unchanged.
   */
  with(layer: number): LayerMask {
    if (layer < 0 || layer >= 32) {
      return this;
    }
    return new LayerMask(this.bits | (1 << layer));
  }

  /**
   * Removes a slot.
   *
   * @param layer - The slot index; out-of-range values are ignored.
   * @returns A new mask; this one is unchanged.
   */
  without(layer: number): LayerMask {
    if (layer < 0 || layer >= 32) {
      return this;
    }
    return new LayerMask(this.bits & ~(1 << layer));
  }

  /**
   * Reports whether the mask shares at least one slot with another.
   *
   * @param other - The mask to test against.
   * @returns `true` when the two masks overlap.
   */
  intersects(other: LayerMask): boolean {
    return (this.bits & other.bits) !== 0;
  }

  /**
   * The names of every slot in the mask, in slot order — what the serializer writes, because files
   * store names rather than bits (`docs/architecture/06-serialization-and-scene-format.md` §3).
   *
   * @param table - The project's layer table.
   * @returns The names of the set slots that the table declares; unnamed slots are skipped.
   */
  toNames(table: LayerTable): string[] {
    const names: string[] = [];
    for (let layer = 0; layer < 32; layer += 1) {
      if ((this.bits & (1 << layer)) !== 0) {
        const name = table.nameOf(layer);
        if (name !== null) {
          names.push(name);
        }
      }
    }
    return names;
  }
}
