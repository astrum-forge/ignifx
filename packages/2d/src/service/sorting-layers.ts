import { twoDError, TwoDErrorCode } from "../errors.js";

/**
 * The sorting-layer table (`docs/architecture/11-2d-toolkit.md` §1).
 *
 * `@ignifx/core` owns the `sortingLayers` settings section — an ordered list of names, back to
 * front — but ships no resolver for it, the way `layers/layer-table.ts` resolves the `layers`
 * section. This is that resolver: it turns a name into the index the Lite layer's `order` is
 * derived from, and it refuses a name the project never declared instead of silently drawing on
 * the wrong layer.
 */

/**
 * The sorting layer a component that names none draws on.
 *
 * @public
 */
export const DEFAULT_SORTING_LAYER = "Default";

/**
 * How far apart two sorting layers' Lite `order` values sit.
 *
 * @remarks
 * A gap of 1000 leaves room for the per-(atlas, blend, space) sub-layers a single sorting layer
 * expands into: one sorting layer holding sprites from twelve atlases in three blend modes still
 * fits inside its slice without reaching the next layer's.
 *
 * @public
 */
export const SORTING_LAYER_ORDER_STEP = 1000;

/**
 * Resolves sorting-layer names to draw orders.
 *
 * @example
 * ```ts
 * const layers = new SortingLayerTable(["Background", "Default", "Foreground"]);
 * layers.indexOf("Foreground"); // 2
 * ```
 *
 * @public
 */
export class SortingLayerTable {
  readonly #names: readonly string[];

  readonly #indices: ReadonlyMap<string, number>;

  /**
   * Builds the table from the project's `sortingLayers` section.
   *
   * @param names - The names, back to front. An empty list falls back to `["Default"]`.
   */
  constructor(names: readonly string[]) {
    const resolved = names.length === 0 ? [DEFAULT_SORTING_LAYER] : names;
    const indices = new Map<string, number>();
    for (let index = 0; index < resolved.length; index += 1) {
      const name = resolved[index];
      if (name !== undefined && !indices.has(name)) {
        indices.set(name, index);
      }
    }
    if (!indices.has(DEFAULT_SORTING_LAYER)) {
      // A project may rename every layer; `Default` still has to resolve, because it is what an
      // unconfigured `SpriteRenderer` carries.
      indices.set(DEFAULT_SORTING_LAYER, 0);
    }
    this.#names = resolved;
    this.#indices = indices;
  }

  /**
   * The layer names, back to front.
   *
   * @returns The names.
   */
  get names(): readonly string[] {
    return this.#names;
  }

  /**
   * Resolves a name to its index.
   *
   * @param name - The sorting layer name.
   * @returns The index, or `-1` when the project declares no such layer.
   */
  indexOf(name: string): number {
    return this.#indices.get(name) ?? -1;
  }

  /**
   * Resolves a name to its index and refuses to guess.
   *
   * @param name - The sorting layer name.
   * @returns The index.
   * @throws IgnifxError with code `IGX-1107` when the project declares no such layer.
   */
  require(name: string): number {
    const index = this.#indices.get(name);
    if (index === undefined) {
      throw twoDError(TwoDErrorCode.unknownSortingLayer, `${name} is not a declared sorting layer.`, {
        context: { sortingLayer: name },
        hint: `Add it to the sortingLayers settings section. Declared: ${this.#names.join(", ")}.`,
      });
    }
    return index;
  }

  /**
   * The Lite `Sprite2DLayer.order` a sorting layer's sub-layers start at.
   *
   * @param name - The sorting layer name.
   * @returns The base order.
   * @throws IgnifxError with code `IGX-1107` when the project declares no such layer.
   */
  orderOf(name: string): number {
    return this.require(name) * SORTING_LAYER_ORDER_STEP;
  }
}
