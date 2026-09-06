import {
  addSprite,
  clearLayer,
  createLayer,
  removeSprite,
  setShaderParams,
  setYSort,
  setYSortOrder,
  spriteIndexOf,
} from "../lite/sprite-layer.js";
import type { SortingLayerTable } from "./sorting-layers.js";
import type { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";
import type { SpriteScratch, SpriteBlendName } from "../lite/sprite-layer.js";
import type { LiteSprite2DHandle, LiteSprite2DLayer, LiteSpriteCustomShader } from "../lite/types.js";
import type { SpriteRenderer } from "../sprite/sprite-renderer.js";

/**
 * The pool of Lite sprite layers (`docs/architecture/11-2d-toolkit.md` §1).
 *
 * One `Sprite2DLayer` exists per **(sorting layer, atlas, blend mode, screen-space)** tuple,
 * because Lite binds a layer to one atlas and one blend mode for its whole life (`index.d.ts` 11885
 * declares both `readonly`). Layers are created on demand as sprites appear and torn down with the
 * app; a sprite that changes any part of its key is removed from one layer and added to another,
 * which replaces its handle.
 *
 * The registry also carries the **handle-index to component** map that picking needs. Lite has no
 * per-sprite metadata slot and removes by swapping the last sprite into the freed index
 * (`lib/sprite/sprite-2d-handle.js`), so the map is a dense array kept in step by applying the same
 * swap rule.
 */

/** How many sprites a new layer pre-allocates room for. */
const INITIAL_LAYER_CAPACITY = 64;

/**
 * One Lite layer and everything the registry tracks alongside it.
 *
 * @public
 */
export interface SpriteLayerEntry {
  /** The composite key, built by {@link spriteLayerKey}. */
  readonly key: string;
  /** The sorting layer's name. */
  readonly sortingLayer: string;
  /** The Lite layer. */
  readonly layer: LiteSprite2DLayer;
  /** Whether the layer keeps the identity view instead of following the `Camera2D`. */
  readonly screenSpace: boolean;
  /** How many sprites the layer currently holds. */
  readonly count: number;
  /** Whether the layer is Y-sorted. */
  readonly ySort: boolean;
}

/**
 * The registry's internal record for one layer.
 */
interface LayerRecord {
  readonly key: string;
  readonly sortingLayer: string;
  readonly layer: LiteSprite2DLayer;
  readonly screenSpace: boolean;
  ySort: boolean;
  /** Component per dense sprite index; kept in step with Lite's swap-remove. */
  readonly components: (SpriteRenderer | null)[];
}

/**
 * Builds the composite key two sprites must share to land in one Lite layer.
 *
 * @param sortingLayer - The sorting layer's name.
 * @param atlasAddress - The atlas's address.
 * @param blend - The blend mode.
 * @param screenSpace - Whether the layer ignores the camera.
 * @returns The key.
 *
 * @public
 */
export function spriteLayerKey(
  sortingLayer: string,
  atlasAddress: string,
  blend: SpriteBlendName,
  screenSpace: boolean,
): string {
  return `${sortingLayer}|${atlasAddress}|${blend}|${screenSpace ? "screen" : "world"}`;
}

/**
 * Owns every Lite sprite layer in one app.
 *
 * @public
 */
export class SpriteLayerRegistry {
  readonly #records = new Map<string, LayerRecord>();

  /** Records in draw order, rebuilt whenever a layer is created. */
  #ordered: LayerRecord[] = [];

  readonly #sortingLayers: SortingLayerTable;

  readonly #ySort: Readonly<Record<string, boolean>>;

  readonly #onLayerCreated: (layer: LiteSprite2DLayer) => void;

  readonly #onLayerRemoved: (layer: LiteSprite2DLayer) => void;

  /**
   * Supplies the compiled custom shader a sorting layer's layers are created with.
   *
   * @returns The shader, or `null` when no effect covers the layer.
   */
  #shaderFor: (sortingLayer: string) => LiteSpriteCustomShader | null = (): null => null;

  /**
   * Builds the registry.
   *
   * @param sortingLayers - Resolves a sorting-layer name to its draw order.
   * @param ySort - Which sorting layers draw back-to-front by world Y.
   * @param onLayerCreated - Called with each new Lite layer, so the sprite renderer can draw it.
   * @param onLayerRemoved - Called before a layer is dropped.
   */
  constructor(
    sortingLayers: SortingLayerTable,
    ySort: Readonly<Record<string, boolean>>,
    onLayerCreated: (layer: LiteSprite2DLayer) => void,
    onLayerRemoved: (layer: LiteSprite2DLayer) => void,
  ) {
    this.#sortingLayers = sortingLayers;
    this.#ySort = ySort;
    this.#onLayerCreated = onLayerCreated;
    this.#onLayerRemoved = onLayerRemoved;
  }

  /**
   * Installs the source of per-sorting-layer custom shaders.
   *
   * @remarks
   * `Sprite2DLayer.customShader` is `readonly` and is only read at creation, so a
   * `SpriteLayerEffect` has to be discoverable **before** the first sprite on its sorting layer is
   * placed. That is why the registry pulls the shader rather than the effect pushing it.
   *
   * @param provider - Returns the compiled shader for a sorting layer, or `null`.
   *
   * @internal
   */
  setShaderProvider(provider: (sortingLayer: string) => LiteSpriteCustomShader | null): void {
    this.#shaderFor = provider;
  }

  /**
   * Writes a sorting layer's `fx.params` vec4 onto every layer belonging to it.
   *
   * @param sortingLayer - The sorting layer's name.
   * @param params - The four components.
   *
   * @internal
   */
  writeShaderParams(sortingLayer: string, params: Float32Array): void {
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record !== undefined && record.sortingLayer === sortingLayer) {
        setShaderParams(record.layer, params[0] ?? 0, params[1] ?? 0, params[2] ?? 0, params[3] ?? 0);
      }
    }
  }

  /**
   * Every layer, in draw order.
   *
   * @returns A freshly allocated snapshot, for diagnostics.
   */
  describe(): readonly SpriteLayerEntry[] {
    const out: SpriteLayerEntry[] = [];
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record !== undefined) {
        out.push({
          key: record.key,
          sortingLayer: record.sortingLayer,
          layer: record.layer,
          screenSpace: record.screenSpace,
          count: record.layer.count,
          ySort: record.ySort,
        });
      }
    }
    return out;
  }

  /**
   * The Lite layers, in draw order — what picking tests against.
   *
   * @param worldOnly - Whether to skip screen-space layers.
   * @param out - The array to fill; it is emptied first, so one array serves every frame.
   * @returns `out`.
   */
  collectLayers(worldOnly: boolean, out: LiteSprite2DLayer[]): LiteSprite2DLayer[] {
    out.length = 0;
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record !== undefined && !(worldOnly && record.screenSpace)) {
        out.push(record.layer);
      }
    }
    return out;
  }

  /**
   * Walks every layer's view, so the camera can write world layers and skip screen-space ones.
   *
   * @param visit - Called with each layer and whether it follows the camera.
   *
   * @internal
   */
  forEachLayer(visit: (layer: LiteSprite2DLayer, screenSpace: boolean) => void): void {
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record !== undefined) {
        visit(record.layer, record.screenSpace);
      }
    }
  }

  /**
   * Adds a sprite to the layer its key selects, creating the layer when it is the first of its kind.
   *
   * @param component - The sprite component.
   * @param atlas - Its loaded atlas.
   * @param scratch - The reusable props record, already written.
   * @returns The key of the layer the sprite landed in.
   *
   * @internal
   */
  place(component: SpriteRenderer, atlas: SpriteAtlasAsset, scratch: SpriteScratch): string {
    const key = spriteLayerKey(component.sortingLayer, atlas.address, component.blend, component.screenSpace);
    const record = this.#ensure(key, component.sortingLayer, component.blend, component.screenSpace, atlas);
    const handle = addSprite(record.layer, scratch);
    const index = spriteIndexOf(handle);
    if (index >= 0) {
      record.components[index] = component;
    }
    component.setPlacement(handle, key);
    return key;
  }

  /**
   * Removes a sprite from whichever layer holds it.
   *
   * @param component - The sprite component.
   *
   * @internal
   */
  remove(component: SpriteRenderer): void {
    const placement = component.placement();
    if (placement === null) {
      return;
    }
    const record = this.#records.get(placement.key);
    const index = spriteIndexOf(placement.handle);
    if (record !== undefined && index >= 0) {
      // Lite swap-removes: the last sprite moves into the freed slot. Mirror that in the map.
      const last = record.components.length - 1;
      record.components[index] = record.components[last] ?? null;
      record.components.length = Math.max(0, last);
    }
    removeSprite(placement.handle);
    component.setPlacement(null, null);
  }

  /**
   * Adds a sprite that no `SpriteRenderer` owns — a tilemap's tiles.
   *
   * @remarks
   * The sprite occupies a slot in the same layers component-owned sprites use, so it sorts and
   * Y-sorts alongside them, but its slot in the pick map stays empty: `app.twoD.pickAt` resolves
   * `SpriteRenderer` components, and a tile is not one. Pick a tile with `Tilemap.worldToCell`
   * instead, which is exact and costs no draw-order search.
   *
   * @param sortingLayer - The sorting layer's name.
   * @param atlas - The atlas the sprite draws from.
   * @param blend - The blend mode.
   * @param screenSpace - Whether the layer ignores the camera.
   * @param scratch - The reusable props record, already written.
   * @returns The key and the handle.
   *
   * @internal
   */
  placeRaw(
    sortingLayer: string,
    atlas: SpriteAtlasAsset,
    blend: SpriteBlendName,
    screenSpace: boolean,
    scratch: SpriteScratch,
  ): { readonly key: string; readonly handle: LiteSprite2DHandle } {
    const key = spriteLayerKey(sortingLayer, atlas.address, blend, screenSpace);
    const record = this.#ensure(key, sortingLayer, blend, screenSpace, atlas);
    const handle = addSprite(record.layer, scratch);
    const index = spriteIndexOf(handle);
    if (index >= 0) {
      record.components[index] = null;
    }
    return { key, handle };
  }

  /**
   * Removes a sprite added by {@link SpriteLayerRegistry.placeRaw}.
   *
   * @param key - The key the sprite was placed under.
   * @param handle - The handle.
   *
   * @internal
   */
  removeRaw(key: string, handle: LiteSprite2DHandle): void {
    const record = this.#records.get(key);
    const index = spriteIndexOf(handle);
    if (record !== undefined && index >= 0) {
      const last = record.components.length - 1;
      record.components[index] = record.components[last] ?? null;
      record.components.length = Math.max(0, last);
    }
    removeSprite(handle);
  }

  /**
   * Applies a sprite's `orderInLayer` to the layer holding it.
   *
   * @remarks
   * Lite's Y-sort bias setter **throws** on a layer that has no Y-sort state
   * (`lib/sprite/sprite-2d-y-sort.js`, `setSprite2DYSortBias`), so the bias is only written to a
   * layer that is actually sorting. On a layer that is not, `orderInLayer` falls back to ordering
   * by insertion, which is exactly what `docs/architecture/11-2d-toolkit.md` §1 specifies:
   * "applied as a Y-sort bias when Y-sort is on, or as sub-ordering by insertion when off"*.
   *
   * @param key - The key of the layer holding the sprite.
   * @param handle - The sprite.
   * @param orderInLayer - The component's `orderInLayer`.
   *
   * @internal
   */
  applyOrderInLayer(key: string, handle: LiteSprite2DHandle, orderInLayer: number): void {
    if (this.#records.get(key)?.ySort === true) {
      setYSortOrder(handle, orderInLayer);
    }
  }

  /**
   * Resolves a pick hit back to the component that owns the sprite.
   *
   * @param layer - The Lite layer the hit is in.
   * @param spriteIndex - The dense index the hit reports.
   * @returns The component, or `null` when the slot is unmapped.
   *
   * @internal
   */
  componentAt(layer: LiteSprite2DLayer, spriteIndex: number): SpriteRenderer | null {
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record?.layer === layer) {
        return record.components[spriteIndex] ?? null;
      }
    }
    return null;
  }

  /**
   * Empties every layer and drops them all.
   *
   * @internal
   */
  clear(): void {
    for (let index = 0; index < this.#ordered.length; index += 1) {
      const record = this.#ordered[index];
      if (record !== undefined) {
        clearLayer(record.layer);
        this.#onLayerRemoved(record.layer);
      }
    }
    this.#records.clear();
    this.#ordered = [];
  }

  /**
   * Finds or creates the layer a key names.
   *
   * @param key - The composite key.
   * @param sortingLayer - The sorting layer's name.
   * @param blend - The blend mode the layer draws with.
   * @param screenSpace - Whether the layer ignores the camera.
   * @param atlas - The atlas to bind the layer to.
   * @returns The record.
   */
  #ensure(
    key: string,
    sortingLayer: string,
    blend: SpriteBlendName,
    screenSpace: boolean,
    atlas: SpriteAtlasAsset,
  ): LayerRecord {
    const existing = this.#records.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const liteAtlas = atlas.lite.atlas;
    if (liteAtlas === null) {
      throw new Error("a sprite layer needs an uploaded atlas; this app is headless");
    }
    const base = this.#sortingLayers.orderOf(sortingLayer);
    // Sub-layers of one sorting layer are ordered by creation, which is stable across a run and
    // never crosses into the next sorting layer's slice.
    const order = base + this.#countIn(sortingLayer);
    const layer = createLayer(liteAtlas, {
      blend,
      order,
      capacity: INITIAL_LAYER_CAPACITY,
      customShader: this.#shaderFor(sortingLayer),
    });
    const ySort = !screenSpace && this.#ySort[sortingLayer] === true;
    if (ySort) {
      setYSort(layer, true);
    }
    const record: LayerRecord = {
      key,
      sortingLayer,
      layer,
      screenSpace,
      ySort,
      components: [],
    };
    this.#records.set(key, record);
    this.#ordered.push(record);
    this.#ordered.sort(byOrder);
    this.#onLayerCreated(layer);
    return record;
  }

  /**
   * How many layers a sorting layer already has, so the next one gets the next sub-order.
   *
   * @param sortingLayer - The sorting layer's name.
   * @returns The count.
   */
  #countIn(sortingLayer: string): number {
    let count = 0;
    for (const record of this.#records.values()) {
      if (record.sortingLayer === sortingLayer) {
        count += 1;
      }
    }
    return count;
  }
}

/**
 * Orders two layer records by their Lite draw order.
 *
 * @param left - One record.
 * @param right - The other.
 * @returns The comparison.
 */
function byOrder(left: LayerRecord, right: LayerRecord): number {
  return left.layer.order - right.layer.order;
}
