import { Vec2 } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { pickSprite, screenToLayer, visibleBounds } from "../lite/sprite-layer.js";
import { pixelsToWorldToRef } from "../math/coords.js";
import type { SpriteLayerEntry } from "./layer-registry.js";
import type { TwoDLiteHandles, TwoDRuntime } from "./runtime.js";
import type { Camera2D } from "../camera/camera-2d.js";
import type { LiteBounds2D, LiteSprite2DLayer } from "../lite/types.js";
import type { TwoDMode, TwoDSettings } from "../settings.js";
import type { SpriteRenderer } from "../sprite/sprite-renderer.js";
import type { Entity, MutableVec2, Vec2Like, World } from "@ignifx/core";

/**
 * `app.twoD` (`docs/architecture/11-2d-toolkit.md` §1 and §5): the 2D toolkit's runtime surface.
 *
 * Everything a game reaches for that is not attached to an entity lives here — the pixels-per-unit
 * conversion, the camera the frame is drawn through, sprite picking, the tile-object factory
 * registry, the per-layer diagnostics, and the Lite escape hatch.
 */

/**
 * What `app.twoD.pickAt` returns.
 *
 * @public
 */
export interface TwoDPick {
  /** The entity carrying the sprite that was hit. */
  readonly entity: Entity;
  /** The sprite component that was hit. */
  readonly component: SpriteRenderer;
  /** Where inside the sprite's quad the hit landed, in `[0, 1]`. */
  readonly u: number;
  /** Where inside the sprite's quad the hit landed, in `[0, 1]`. */
  readonly v: number;
}

/**
 * Builds the entities a tilemap's objects layer describes.
 *
 * @public
 */
export type TileObjectFactory = (context: TileObjectContext) => Entity | null;

/**
 * What a {@link TileObjectFactory} is handed.
 *
 * @public
 */
export interface TileObjectContext {
  /** The world to create the entity in. */
  readonly world: World;
  /** The object's name, as the map wrote it. */
  readonly name: string;
  /** The object's type, which selected this factory. */
  readonly type: string;
  /** The object's bottom-left corner, in world metres relative to the tilemap entity. */
  readonly position: Vec2Like;
  /** The object's size, in world metres. */
  readonly size: Vec2Like;
  /** The object's custom properties. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  /** The tilemap entity the object came from, so a factory can parent to it. */
  readonly tilemap: Entity;
}

/**
 * A caller-owned world-space box, so reading the camera's bounds allocates nothing.
 *
 * @public
 */
export interface WorldBox {
  /** The lower corner, in world metres. */
  readonly min: MutableVec2;
  /** The upper corner, in world metres. */
  readonly max: MutableVec2;
}

/**
 * The 2D service.
 *
 * @example
 * ```ts
 * const hit = app.twoD.pickAt(pointer.x, pointer.y);
 * if (hit !== null) {
 *   hit.entity.destroy();
 * }
 * ```
 *
 * @public
 */
export class TwoDService {
  readonly #runtime: TwoDRuntime;

  readonly #factories = new Map<string, TileObjectFactory>();

  /** Reused by `pickAt`, so picking allocates nothing. */
  readonly #pickLayers: LiteSprite2DLayer[] = [];

  /** Reused by `visibleWorldBounds`. */
  readonly #bounds: LiteBounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** Reused by `pickAt`, so picking allocates nothing. */
  readonly #pickPoint = { x: 0, y: 0 };

  /** A one-element array reused by `pickAt`, because Lite's picker takes a list. */
  readonly #oneLayer: LiteSprite2DLayer[] = [];

  /**
   * Builds the service.
   *
   * @param runtime - The app's 2D runtime state.
   *
   * @internal
   */
  constructor(runtime: TwoDRuntime) {
    this.#runtime = runtime;
  }

  /**
   * How many pixels one world metre spans (`docs/architecture/11-2d-toolkit.md` §1).
   *
   * @returns The conversion factor; `100` unless the project or a scene changed it.
   */
  get pixelsPerUnit(): number {
    return this.#runtime.pixelsPerUnit;
  }

  /**
   * Whether sprites are the whole frame or composite over the 3D scene.
   *
   * @returns The mode.
   */
  get mode(): TwoDMode {
    return this.#runtime.settings.mode;
  }

  /**
   * The resolved `twoD` settings, after any scene-file override.
   *
   * @returns The settings.
   */
  get settings(): TwoDSettings {
    return this.#runtime.settings;
  }

  /**
   * The camera the last frame was drawn through: the highest-priority enabled `Camera2D`.
   *
   * @returns The camera, or `null` when the world has none enabled.
   */
  get mainCamera(): Camera2D | null {
    return this.#runtime.mainCamera;
  }

  /**
   * The project's sorting layers, back to front.
   *
   * @returns The names.
   */
  get sortingLayers(): readonly string[] {
    return this.#runtime.sortingLayers.names;
  }

  /**
   * Every Lite sprite layer in draw order, for diagnostics and tests.
   *
   * @remarks
   * The snapshot is freshly allocated on each read; it is a debugging surface, not a per-frame one.
   *
   * @returns The layers.
   */
  get layers(): readonly SpriteLayerEntry[] {
    return this.#runtime.layers.describe();
  }

  /**
   * The Babylon Lite objects the toolkit owns. Unstable escape hatch
   * (`CONSTITUTION.md` §3.4).
   *
   * @returns The sprite rendering context, or `null` under a headless app or before the first frame.
   */
  get lite(): TwoDLiteHandles {
    return { renderer: this.#runtime.renderer };
  }

  /**
   * How many sprites the last frame actually wrote to Lite.
   *
   * @remarks
   * This is the number spike S6.1 watches: on a steady frame with a static tilemap it is the count
   * of sprites that genuinely moved, not the count that exist.
   *
   * @returns The count.
   */
  get syncedLastFrame(): number {
    return this.#runtime.syncedLastFrame;
  }

  /**
   * How many `SpriteRenderer` components the last frame walked.
   *
   * @returns The count.
   */
  get spriteCount(): number {
    return this.#runtime.spriteCount;
  }

  /**
   * Picks the topmost sprite under a viewport pixel (`docs/architecture/11-2d-toolkit.md` §5).
   *
   * @remarks
   * Picking is a CPU test against every world layer's instance data, in draw order — no GPU
   * readback and no frame of latency, which is what makes it usable from a click handler. It
   * resolves only `SpriteRenderer` components: a tilemap's tiles have no component, so use
   * `Tilemap.worldToCell` for those.
   *
   * @param xPx - The viewport x, in pixels from the left edge.
   * @param yPx - The viewport y, in pixels from the top edge.
   * @returns The hit, or `null` for a miss.
   */
  pickAt(xPx: number, yPx: number): TwoDPick | null {
    const layers = this.#runtime.layers.collectLayers(false, this.#pickLayers);
    // Front to back, one layer at a time: Lite's picker compares the point against each sprite's
    // stored `positionPx` without applying the view, so the point has to be unprojected through
    // *that* layer's view — and a world layer and a screen-space layer do not share one.
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      if (layer === undefined) {
        continue;
      }
      const point = screenToLayer(layer.view, xPx, yPx, this.#pickPoint);
      this.#oneLayer[0] = layer;
      const hit = pickSprite(this.#oneLayer, point.x, point.y);
      if (hit === null) {
        continue;
      }
      const component = this.#runtime.layers.componentAt(hit.layer, hit.spriteIndex);
      if (component !== null && component.pickable && !component.isDestroyed) {
        return { entity: component.entity, component, u: hit.u, v: hit.v };
      }
    }
    return null;
  }

  /**
   * The world-space rectangle the camera can currently see.
   *
   * @param out - The box to write: its `min` takes the lower corner and its `max` the upper.
   * @returns `true` when a camera and a layer existed to measure against.
   */
  visibleWorldBounds(out: WorldBox): boolean {
    const layers = this.#runtime.layers.collectLayers(true, this.#pickLayers);
    const first = layers[0];
    if (first === undefined) {
      return false;
    }
    visibleBounds(first.view, this.#runtime.viewportWidthPx, this.#runtime.viewportHeightPx, this.#bounds);
    const ppu = this.#runtime.pixelsPerUnit;
    // Layer pixels run +Y down, so the bounds' maxY is the world minimum.
    pixelsToWorldToRef(this.#bounds.minX, this.#bounds.maxY, ppu, out.min);
    pixelsToWorldToRef(this.#bounds.maxX, this.#bounds.minY, ppu, out.max);
    return true;
  }

  /**
   * Registers the factory that turns one kind of tilemap object into an entity
   * (`docs/architecture/11-2d-toolkit.md` §2.5).
   *
   * @param type - The object `type` the map writes.
   * @param factory - Builds the entity, or returns `null` to spawn nothing.
   * @throws IgnifxError with code `IGX-1110` when a factory for the type is already registered.
   *
   * @example
   * ```ts
   * app.twoD.registerTileObjectFactory("spawn", ({ world, position }) => {
   *   const player = world.createEntity({ name: "player" });
   *   player.transform.position2D = new Vec2(position.x, position.y);
   *   return player;
   * });
   * ```
   */
  registerTileObjectFactory(type: string, factory: TileObjectFactory): void {
    if (this.#factories.has(type)) {
      throw twoDError(
        TwoDErrorCode.duplicateObjectFactory,
        `A tile object factory for ${type} is already registered.`,
        {
          context: { type },
          hint: "Unregister the first one, or give the second object type its own name.",
        },
      );
    }
    this.#factories.set(type, factory);
  }

  /**
   * Removes a tile-object factory.
   *
   * @param type - The object type.
   * @returns `true` when a factory was registered.
   */
  unregisterTileObjectFactory(type: string): boolean {
    return this.#factories.delete(type);
  }

  /**
   * The factory registered for an object type.
   *
   * @param type - The object type.
   * @returns The factory, or `null`.
   *
   * @internal
   */
  tileObjectFactory(type: string): TileObjectFactory | null {
    return this.#factories.get(type) ?? null;
  }

  /**
   * Converts a viewport pixel into a world point through the active camera.
   *
   * @param xPx - The viewport x.
   * @param yPx - The viewport y.
   * @param out - The vector to write; omitting it allocates one.
   * @returns `out`, or the origin when no camera is active.
   */
  screenToWorld(xPx: number, yPx: number, out: MutableVec2 = new Vec2()): MutableVec2 {
    const camera = this.#runtime.mainCamera;
    if (camera === null) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    return camera.screenToWorld(xPx, yPx, out);
  }

  /**
   * Converts a world point into a viewport pixel through the active camera.
   *
   * @param point - The world point, in metres.
   * @param out - The vector to write; omitting it allocates one.
   * @returns `out`, or the origin when no camera is active.
   */
  worldToScreen(point: Vec2Like, out: MutableVec2 = new Vec2()): MutableVec2 {
    const camera = this.#runtime.mainCamera;
    if (camera === null) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    return camera.worldToScreen(point, out);
  }
}
