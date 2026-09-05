import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { LayerMask } from "./layer-mask.js";

/**
 * The project's layer names, resolved once from settings
 * (`docs/architecture/02-scene-graph.md` §7). Layers drive physics collision matrices and raycast
 * masks; files store layer **names**, never indices, so reordering the project list is safe.
 */

/**
 * How many layer slots exist. One bit each, in a 32-bit mask.
 *
 * @public
 */
export const MAX_LAYERS = 32;

/**
 * The names of the eight engine-reserved slots, in slot order. They always occupy slots 0–7,
 * whether or not the project lists them (`docs/architecture/02-scene-graph.md` §7).
 *
 * @public
 */
export const RESERVED_LAYER_NAMES: readonly string[] = Object.freeze([
  "Default",
  "TransparentFX",
  "IgnoreRaycast",
  "Water",
  "UI",
  "Reserved5",
  "Reserved6",
  "Reserved7",
]);

/**
 * The slot every entity starts on, and the fallback for an unknown name in a file.
 *
 * @public
 */
export const DEFAULT_LAYER = 0;

/** The first slot a project-declared layer can occupy. */
const FIRST_USER_LAYER = 8;

/**
 * The resolved mapping between layer names and the 32 layer slots.
 *
 * @remarks
 * How the project list is interpreted (the settings example in
 * `docs/architecture/04-extensions.md` §5 opens with `"Default"`, while
 * `docs/architecture/02-scene-graph.md` §7 reserves slots 0–7, so one rule has to reconcile the
 * two): the eight reserved names always occupy slots 0–7. A project entry that repeats a reserved
 * name keeps that reserved slot and consumes no user slot; every other entry takes the next free
 * slot from 8 upwards, in declaration order. A name declared twice is `IGX-0304`; more names than
 * slots is `IGX-0305`.
 *
 * @example
 * ```ts
 * const table = createLayerTable(["Default", "Ground", "Player"]);
 * table.indexOf("Ground"); // 8
 * table.mask("Ground", "Player").bits; // 0b1100000000
 * ```
 *
 * @public
 */
export class LayerTable {
  /** Name per slot; the empty string marks an unassigned user slot. */
  readonly #names: string[];

  /** Slot per name, for O(1) resolution at load and at mask construction. */
  readonly #indices: Map<string, number>;

  /**
   * Builds a table. Prefer {@link createLayerTable}, which is the documented entry point.
   *
   * @param names - The project's layer names in declaration order.
   * @throws IgnifxError with code `IGX-0304` on a duplicate name, or `IGX-0305` when the names do
   * not fit in the 32 slots.
   *
   * @internal
   */
  constructor(names: readonly string[]) {
    const slots: string[] = [];
    const indices = new Map<string, number>();
    for (let index = 0; index < MAX_LAYERS; index += 1) {
      const reserved = index < FIRST_USER_LAYER ? (RESERVED_LAYER_NAMES[index] ?? "") : "";
      slots.push(reserved);
      if (reserved !== "") {
        indices.set(reserved, index);
      }
    }
    let next = FIRST_USER_LAYER;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index] ?? "";
      if (name === "") {
        continue;
      }
      const existing = indices.get(name);
      if (existing !== undefined) {
        if (existing >= FIRST_USER_LAYER) {
          throw new IgnifxError(CoreErrorCode.duplicateLayerName, `The layer name ${name} is declared twice.`, {
            context: { layer: name, slot: existing },
            hint: "Every layer name must be unique across the project list and the eight reserved names.",
          });
        }
        continue;
      }
      if (next >= MAX_LAYERS) {
        throw new IgnifxError(
          CoreErrorCode.tooManyLayers,
          `The project declares more layers than the ${String(MAX_LAYERS)} slots allow.`,
          {
            context: { layer: name, limit: MAX_LAYERS - FIRST_USER_LAYER },
            hint: "Slots 0-7 are reserved for engine defaults, leaving 24 for the project.",
          },
        );
      }
      slots[next] = name;
      indices.set(name, next);
      next += 1;
    }
    this.#names = slots;
    this.#indices = indices;
  }

  /**
   * Every slot's name, indexed by slot. Unassigned user slots hold the empty string.
   *
   * @returns The 32 slot names.
   */
  get names(): readonly string[] {
    return this.#names;
  }

  /**
   * How many slots carry a name.
   *
   * @returns The count, always at least eight.
   */
  get count(): number {
    return this.#indices.size;
  }

  /**
   * Resolves a layer name to its slot.
   *
   * @param name - The layer name.
   * @returns The slot index, or `-1` when the project does not declare the name.
   */
  indexOf(name: string): number {
    return this.#indices.get(name) ?? -1;
  }

  /**
   * Resolves a layer name to its slot, requiring it to exist.
   *
   * @param name - The layer name.
   * @returns The slot index.
   * @throws IgnifxError with code `IGX-0303` when the project does not declare the name. Scene
   * loading* is more forgiving: an unknown name in a file resolves to `Default` with the same code
   * reported as a diagnostic (`docs/architecture/02-scene-graph.md` §7).
   */
  requireIndex(name: string): number {
    const index = this.#indices.get(name);
    if (index === undefined) {
      throw new IgnifxError(CoreErrorCode.unknownLayer, `${name} is not a layer declared in the project settings.`, {
        context: { layer: name },
        hint: "Add it to `layers` in ignifx.config.ts, or use one of the reserved names.",
      });
    }
    return index;
  }

  /**
   * The name of a slot.
   *
   * @param index - The slot index.
   * @returns The name, or `null` when the slot is out of range or unassigned.
   */
  nameOf(index: number): string | null {
    const name = this.#names[index];
    return name === undefined || name === "" ? null : name;
  }

  /**
   * Reports whether a name is declared.
   *
   * @param name - The layer name.
   * @returns `true` when the name resolves to a slot.
   */
  has(name: string): boolean {
    return this.#indices.has(name);
  }

  /**
   * Builds a mask from layer names — the ergonomic form scripts use, reached as
   * `world.layers.mask("Player", "Enemy")`.
   *
   * @param names - The layer names to include.
   * @returns The mask.
   * @throws IgnifxError with code `IGX-0303` when a name is not declared.
   *
   * @example
   * ```ts
   * const hostiles = this.world.layers.mask("Enemy", "Projectile");
   * if (hostiles.has(other.layer)) {
   *   this.takeDamage();
   * }
   * ```
   */
  mask(...names: readonly string[]): LayerMask {
    return LayerMask.fromNames(this, names);
  }
}

/**
 * Resolves the project's layer names into a table.
 *
 * @param names - The `layers` project settings section, in declaration order.
 * @returns The resolved table.
 * @throws IgnifxError with code `IGX-0304` on a duplicate name, or `IGX-0305` when the names do not
 * fit in the 32 slots.
 *
 * @example
 * ```ts
 * const layers = createLayerTable(["Default", "Ground", "Player", "Enemy"]);
 * ```
 *
 * @public
 */
export function createLayerTable(names: readonly string[] = []): LayerTable {
  return new LayerTable(names);
}

/**
 * Checks that a number is a usable layer slot.
 *
 * @param layer - The candidate slot.
 * @returns `true` when the value is an integer in `[0, 31]`.
 *
 * @internal
 */
export function isValidLayer(layer: number): boolean {
  return Number.isInteger(layer) && layer >= 0 && layer < MAX_LAYERS;
}
