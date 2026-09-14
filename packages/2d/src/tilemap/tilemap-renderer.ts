import { asset, bool, Component, createDefaults, defineSchema, str, Vec2 } from "@ignifx/core";
import { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";
import { createSpriteScratch, writeScratch } from "../lite/sprite-layer.js";
import { worldToPixelsToRef } from "../math/coords.js";
import { DEFAULT_SORTING_LAYER } from "../service/sorting-layers.js";
import { tileFrameName } from "./definition.js";
import type { Tilemap } from "./tilemap.js";
import type { SpriteScratch } from "../lite/sprite-layer.js";
import type { LiteBounds2D, LiteSprite2DHandle } from "../lite/types.js";
import type { SpriteLayerRegistry } from "../service/layer-registry.js";
import type { AssetHandle, ComponentHooks, MutableVec2, Schema } from "@ignifx/core";

/**
 * Draw visible tilemap chunks through the shared sprite-layer registry so tiles sort with characters.
 * Chunk sprites are written when built and removed when out of view. Tiles have no individual
 * entities; use `Tilemap.worldToCell` to locate a tile rather than `app.twoD.pickAt`.
 */

/** One materialised chunk. */
interface ChunkRecord {
  /** The chunk's column, in chunks. */
  readonly chunkX: number;
  /** The chunk's row, in chunks. */
  readonly chunkY: number;
  /** The layer keys and handles of every sprite in the chunk. */
  readonly sprites: { readonly key: string; readonly handle: LiteSprite2DHandle }[];
}

/**
 * A tilemap renderer.
 *
 * @example
 * ```ts
 * const level = app.world.createEntity({ name: "level" });
 * level.addComponent(Tilemap).map = app.assets.load<TilemapAsset>("2d/level-1.tilemap.json").retain();
 * const renderer = level.addComponent(TilemapRenderer);
 * renderer.atlas = app.assets.load<SpriteAtlasAsset>("2d/tiles.atlas.json").retain();
 * ```
 *
 * @public
 */
export class TilemapRenderer extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/TilemapRenderer";

  /** One renderer per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = tilemapRendererSchema();

  /** The atlas the tile frames come from. */
  declare atlas: AssetHandle<SpriteAtlasAsset> | null;

  /** Which sorting layer the tiles draw on, when the document's layers name none. */
  declare sortingLayer: string;

  /** Whether chunks outside the camera's visible bounds are dropped. */
  declare cullChunks: boolean;

  /** Chunks currently materialised, keyed by `<chunkX>,<chunkY>`. */
  readonly #chunks = new Map<string, ChunkRecord>();

  /** The reusable props record, so building a chunk allocates one object rather than 1024. */
  readonly #scratch: SpriteScratch = createSpriteScratch();

  /** Scratch, so the per-chunk arithmetic allocates nothing. */
  readonly #pixels: MutableVec2 = new Vec2();

  /** How far animated tiles have advanced, in seconds. */
  #animationClock = 0;

  /** Whether every chunk must be rebuilt, because the map or the atlas changed. */
  #isStale = true;

  /**
   * Builds a renderer with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(TilemapRenderer.schema));
  }

  /**
   * Marks every chunk stale, so a recycled component rebuilds.
   */
  onAttach(): void {
    this.#isStale = true;
  }

  /**
   * Marks every chunk stale; the 2D sync system does the removal, because it owns the layers.
   */
  onDetach(): void {
    this.#isStale = true;
  }

  /**
   * How many chunks are currently materialised.
   *
   * @returns The count.
   */
  get chunkCount(): number {
    return this.#chunks.size;
  }

  /**
   * How many sprites the materialised chunks hold in total.
   *
   * @returns The count.
   */
  get spriteCount(): number {
    let total = 0;
    for (const chunk of this.#chunks.values()) {
      total += chunk.sprites.length;
    }
    return total;
  }

  /**
   * The loaded atlas, or `null`.
   *
   * @returns The atlas.
   */
  get loadedAtlas(): SpriteAtlasAsset | null {
    const handle = this.atlas;
    return handle?.state === "loaded" ? handle.value : null;
  }

  /**
   * Forces every chunk to be rebuilt on the next sync.
   *
   * @remarks
   * `Tilemap.onTileChanged` is what normally calls this — a rewritten cell has to reach the sprite
   * that draws it, and rebuilding the chunk is both simpler and, for anything short of a per-frame
   * rewrite, cheaper than tracking one sprite per cell.
   *
   * @internal
   */
  invalidate(): void {
    this.#isStale = true;
  }

  /**
   * Brings the materialised chunks in line with the camera's visible bounds.
   *
   * @param map - The tilemap being drawn.
   * @param registry - The layer registry that owns the Lite layers.
   * @param bounds - The camera's visible bounds, in layer pixels, or `null` to build every chunk.
   * @param pixelsPerUnit - The pixels one metre spans.
   * @returns How many sprites were written this call; `0` on a steady frame.
   *
   * @internal
   */
  sync(map: Tilemap, registry: SpriteLayerRegistry, bounds: LiteBounds2D | null, pixelsPerUnit: number): number {
    const atlas = this.loadedAtlas;
    const definition = map.definition;
    if (atlas === null || atlas.lite.atlas === null || definition === null) {
      return 0;
    }
    if (this.#isStale) {
      this.#dropAll(registry);
      this.#isStale = false;
    }
    const chunkSize = Math.max(1, map.chunkSize);
    const cellSize = map.cellSize;
    if (cellSize <= 0) {
      return 0;
    }
    const chunksX = Math.ceil(definition.width / chunkSize);
    const chunksY = Math.ceil(definition.height / chunkSize);
    const window = this.#chunkWindow(bounds, chunkSize, cellSize, pixelsPerUnit, chunksX, chunksY);
    let written = 0;
    for (const [key, chunk] of this.#chunks) {
      if (!inWindow(chunk.chunkX, chunk.chunkY, window)) {
        this.#drop(registry, key, chunk);
      }
    }
    for (let chunkY = window.minY; chunkY <= window.maxY; chunkY += 1) {
      for (let chunkX = window.minX; chunkX <= window.maxX; chunkX += 1) {
        const key = `${String(chunkX)},${String(chunkY)}`;
        if (this.#chunks.has(key)) {
          continue;
        }
        written += this.#build(map, atlas, registry, chunkX, chunkY, chunkSize, cellSize, pixelsPerUnit);
      }
    }
    return written;
  }

  /**
   * Advances animated tiles and rewrites the chunks holding them.
   *
   * @param deltaSeconds - The scaled frame delta.
   * @returns `true` when a tile's frame changed, so the renderer must rebuild.
   *
   * @internal
   */
  advanceAnimation(deltaSeconds: number): boolean {
    const previous = this.#animationClock;
    this.#animationClock += deltaSeconds;
    // A tile animation is a whole-map property: if any tileset declares one, a frame boundary
    // anywhere invalidates the chunks. Rebuilding on a 100 ms grid is cheap next to tracking every
    // animated cell, and tile animations are authored in tenths of a second, not milliseconds.
    return (
      Math.floor(previous * ANIMATION_TICKS_PER_SECOND) !==
      Math.floor(this.#animationClock * ANIMATION_TICKS_PER_SECOND)
    );
  }

  /**
   * The animation clock animated tiles are sampled at, in seconds.
   *
   * @returns The elapsed time.
   *
   * @internal
   */
  get animationClock(): number {
    return this.#animationClock;
  }

  /**
   * Drops every materialised chunk.
   *
   * @param registry - The layer registry.
   *
   * @internal
   */
  dropAll(registry: SpriteLayerRegistry): void {
    this.#dropAll(registry);
  }

  /**
   * The range of chunks the camera can see.
   *
   * @param bounds - The camera's visible bounds, in layer pixels, or `null`.
   * @param chunkSize - Cells per chunk.
   * @param cellSize - Metres per cell.
   * @param pixelsPerUnit - Pixels per metre.
   * @param chunksX - How many chunk columns the map has.
   * @param chunksY - How many chunk rows.
   * @returns The inclusive chunk window.
   */
  // oxlint-disable-next-line max-params -- once per tilemap per frame; an options object would allocate.
  #chunkWindow(
    bounds: LiteBounds2D | null,
    chunkSize: number,
    cellSize: number,
    pixelsPerUnit: number,
    chunksX: number,
    chunksY: number,
  ): ChunkWindow {
    if (bounds === null || !this.cullChunks) {
      return { minX: 0, minY: 0, maxX: chunksX - 1, maxY: chunksY - 1 };
    }
    const matrix = this.entity.transform.worldMatrix;
    const originX = matrix[12] ?? 0;
    const originY = matrix[13] ?? 0;
    // Layer pixels run +Y down, so the bounds' minY is the *top* of the world window.
    const worldMinX = bounds.minX / pixelsPerUnit - originX;
    const worldMaxX = bounds.maxX / pixelsPerUnit - originX;
    const worldMinY = -bounds.maxY / pixelsPerUnit - originY;
    const worldMaxY = -bounds.minY / pixelsPerUnit - originY;
    const span = chunkSize * cellSize;
    return {
      minX: clampIndex(Math.floor(worldMinX / span), chunksX),
      maxX: clampIndex(Math.floor(worldMaxX / span), chunksX),
      minY: clampIndex(Math.floor(worldMinY / span), chunksY),
      maxY: clampIndex(Math.floor(worldMaxY / span), chunksY),
    };
  }

  /**
   * Materialises one chunk's sprites.
   *
   * @param map - The tilemap.
   * @param atlas - The tile atlas.
   * @param registry - The layer registry.
   * @param chunkX - The chunk's column.
   * @param chunkY - The chunk's row.
   * @param chunkSize - Cells per chunk.
   * @param cellSize - Metres per cell.
   * @param pixelsPerUnit - Pixels per metre.
   * @returns How many sprites were created.
   */
  // oxlint-disable-next-line max-params -- once per chunk; an options object would allocate per chunk.
  #build(
    map: Tilemap,
    atlas: SpriteAtlasAsset,
    registry: SpriteLayerRegistry,
    chunkX: number,
    chunkY: number,
    chunkSize: number,
    cellSize: number,
    pixelsPerUnit: number,
  ): number {
    const definition = map.definition;
    if (definition === null) {
      return 0;
    }
    const matrix = this.entity.transform.worldMatrix;
    const originX = matrix[12] ?? 0;
    const originY = matrix[13] ?? 0;
    const sizePx = cellSize * pixelsPerUnit;
    const sprites: { key: string; handle: LiteSprite2DHandle }[] = [];
    for (let layerIndex = 0; layerIndex < definition.layers.length; layerIndex += 1) {
      const layer = definition.layers[layerIndex];
      if (layer === undefined) {
        continue;
      }
      const sortingLayer = layer.sortingLayer === "" ? this.sortingLayer : layer.sortingLayer;
      const alpha = layer.opacity;
      const endX = Math.min(layer.width, (chunkX + 1) * chunkSize);
      const endY = Math.min(layer.height, (chunkY + 1) * chunkSize);
      for (let y = chunkY * chunkSize; y < endY; y += 1) {
        for (let x = chunkX * chunkSize; x < endX; x += 1) {
          const tileId = map.getTile(layerIndex, x, y);
          if (tileId === 0) {
            continue;
          }
          const frameName = tileFrameName(definition, tileId);
          const frame = frameName === null ? -1 : atlas.frameIndex(frameName);
          if (frame < 0) {
            continue;
          }
          const worldX = originX + (x + 0.5) * cellSize;
          const worldY = originY + (y + 0.5) * cellSize;
          const centre = worldToPixelsToRef(worldX, worldY, pixelsPerUnit, this.#pixels);
          writeScratch(this.#scratch, centre.x, centre.y, sizePx, sizePx, frame, 0, 1, 1, 1, alpha, false, false, true);
          sprites.push(registry.placeRaw(sortingLayer, atlas, "alpha", false, this.#scratch));
        }
      }
    }
    this.#chunks.set(`${String(chunkX)},${String(chunkY)}`, { chunkX, chunkY, sprites });
    return sprites.length;
  }

  /**
   * Removes one chunk's sprites.
   *
   * @param registry - The layer registry.
   * @param key - The chunk key.
   * @param chunk - The chunk record.
   */
  #drop(registry: SpriteLayerRegistry, key: string, chunk: ChunkRecord): void {
    for (let index = chunk.sprites.length - 1; index >= 0; index -= 1) {
      const sprite = chunk.sprites[index];
      if (sprite !== undefined) {
        registry.removeRaw(sprite.key, sprite.handle);
      }
    }
    this.#chunks.delete(key);
  }

  /**
   * Removes every chunk's sprites.
   *
   * @param registry - The layer registry.
   */
  #dropAll(registry: SpriteLayerRegistry): void {
    for (const [key, chunk] of this.#chunks) {
      this.#drop(registry, key, chunk);
    }
    this.#chunks.clear();
  }
}

/** How often an animated tile's frame is allowed to change, in ticks per second. */
const ANIMATION_TICKS_PER_SECOND = 10;

/** An inclusive range of chunk indices. */
interface ChunkWindow {
  /** The first chunk column. */
  readonly minX: number;
  /** The first chunk row. */
  readonly minY: number;
  /** The last chunk column. */
  readonly maxX: number;
  /** The last chunk row. */
  readonly maxY: number;
}

/**
 * Whether a chunk is inside a window.
 *
 * @param x - The chunk column.
 * @param y - The chunk row.
 * @param window - The window.
 * @returns `true` when the chunk should stay materialised.
 */
function inWindow(x: number, y: number, window: ChunkWindow): boolean {
  return x >= window.minX && x <= window.maxX && y >= window.minY && y <= window.maxY;
}

/**
 * Clamps a chunk index into a map's range.
 *
 * @param value - The index.
 * @param count - How many chunks the map has on this axis.
 * @returns The clamped index.
 */
function clampIndex(value: number, count: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, count - 1));
}

/**
 * The `TilemapRenderer` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function tilemapRendererSchema(): Schema {
  return defineSchema({
    atlas: asset(SpriteAtlasAsset, { tooltip: "The atlas the tile frames come from." }),
    sortingLayer: str(DEFAULT_SORTING_LAYER, { tooltip: "Sorting layer used when a map layer names none." }),
    cullChunks: bool(true, { tooltip: "Drop chunks outside the camera's visible bounds." }),
  });
}
