import { Vec2 } from "@ignifx/core";
import {
  createSpriteVisibilityScratch,
  pickSprite,
  screenToLayer,
  setSpriteVisibleAt,
  visibleBounds,
} from "../lite/sprite-layer.js";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { pixelsToWorldToRef } from "../math/coords.js";
import { createSpriteBatch } from "./sprite-batch.js";
import type { SpriteLayerEntry } from "./layer-registry.js";
import type { TwoDLiteHandles, TwoDRuntime } from "./runtime.js";
import type { SpriteBatch, SpriteBatchOptions } from "./sprite-batch.js";
import type { Camera2D } from "../camera/camera-2d.js";
import type { LiteBounds2D, LiteSprite2DLayer } from "../lite/types.js";
import type { TwoDMode, TwoDSettings } from "../settings.js";
import type { SpriteRenderer } from "../sprite/sprite-renderer.js";
import type { Entity, MutableVec2, Vec2Like } from "@ignifx/core";

/**
 * `app.twoD` (`docs/architecture/11-2d-toolkit.md` §1 and §5): the 2D toolkit's runtime surface.
 *
 * Everything a game reaches for that is not attached to an entity lives here — the pixels-per-unit
 * conversion, the camera the frame is drawn through, sprite picking, the per-layer diagnostics,
 * and the Lite escape hatch.
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
 * Options for `app.twoD.pickAt`, named after core's `RenderPickOptions`.
 *
 * @public
 */
export interface TwoDPickOptions {
  /**
   * Restricts the pick to the sprites this accepts. A rejected sprite neither occludes nor returns:
   * the pick goes on to the next sprite under the point in the same sorting layer, then to the
   * layers below.
   *
   * @remarks
   * Called synchronously, topmost candidate first, while the pick has the sprites above the
   * candidate hidden. It must not add, remove or change sprites, and must not pick again: a nested
   * `pickAt` or `pickAllAt` throws `IGX-1119`. If it throws, the pick restores every sprite it hid
   * and rethrows.
   *
   * @param entity - The entity carrying the candidate sprite.
   * @param component - The candidate sprite.
   * @returns `true` to consider the sprite.
   */
  readonly filter?: (entity: Entity, component: SpriteRenderer) => boolean;
  /**
   * Whether sprites marked `pickable: false` are candidates too. An editor sets it to select what
   * the game itself never picks. Defaults to `false`.
   */
  readonly includeUnpickable?: boolean;
  /** Entities whose sprites are skipped, as if `filter` had rejected them. */
  readonly ignore?: readonly Entity[];
}

/**
 * Options for `app.twoD.pickAllAt`.
 *
 * @public
 */
export interface TwoDPickAllOptions extends TwoDPickOptions {
  /** The most hits to return, topmost first. Defaults to {@link DEFAULT_PICK_ALL_LIMIT}. */
  readonly limit?: number;
}

/**
 * How many hits `app.twoD.pickAllAt` returns when no `limit` is given.
 *
 * @remarks
 * Every hit costs one more scan of its layer, so an unbounded walk over a dense stack is quadratic;
 * 64 is far deeper than any click-cycle needs. Pass `limit: Infinity` to walk the whole stack.
 *
 * @public
 */
export const DEFAULT_PICK_ALL_LIMIT = 64;

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

  /** Reused by `pickAt`, so picking allocates nothing. */
  readonly #pickLayers: LiteSprite2DLayer[] = [];

  /** Reused by `visibleWorldBounds`. */
  readonly #bounds: LiteBounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** Reused by `pickAt`, so picking allocates nothing. */
  readonly #pickPoint = { x: 0, y: 0 };

  /** A one-element array reused by `pickAt`, because Lite's picker takes a list. */
  readonly #oneLayer: LiteSprite2DLayer[] = [];

  /** The layers of the sprites a pick hid to look under them, restored before it returns. */
  readonly #hiddenLayers: LiteSprite2DLayer[] = [];

  /** The dense indices matching {@link TwoDService.#hiddenLayers}. */
  readonly #hiddenIndices: number[] = [];

  /** The visibility patch a pick hides and restores sprites with. */
  readonly #visibility = createSpriteVisibilityScratch();

  /** Whether a pick is walking, so one called from its own `filter` is refused. */
  #picking = false;

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
   * Picking is a CPU test against every layer's instance data, in draw order — no GPU readback and
   * no frame of latency, which is what makes it usable from a click handler. It resolves only
   * `SpriteRenderer` components: a tilemap's tiles have no component, so use
   * `Tilemap.worldToCell` for those.
   *
   * A sprite that is rejected — unpickable, destroyed, ignored, refused by `options.filter`, or a
   * tile or batch slot with no component — does not occlude: the pick goes on to the sprite under
   * it in the same sorting layer, then to the layers below.
   *
   * Cost: one scan of a layer's sprites per sprite examined in it. With nothing rejected that is one
   * scan per layer; looking under `m` rejected sprites in a layer of `n` costs `O(m·n)`, and every
   * hidden sprite costs one slot upload on the next frame.
   *
   * @param xPx - The viewport x, in pixels from the left edge.
   * @param yPx - The viewport y, in pixels from the top edge.
   * @param options - A filter, an ignore list, and whether unpickable sprites count.
   * @returns The hit, or `null` for a miss.
   * @throws IgnifxError with code `IGX-1119` when called from inside a pick's `filter`.
   *
   * @example
   * ```ts
   * // An editor selecting what the game cannot pick, minus locked entities.
   * const hit = app.twoD.pickAt(x, y, {
   *   includeUnpickable: true,
   *   filter: (entity) => !locked.has(entity),
   * });
   * ```
   */
  pickAt(xPx: number, yPx: number, options?: TwoDPickOptions): TwoDPick | null {
    return this.#pick(xPx, yPx, options, 1, null);
  }

  /**
   * Picks every sprite under a viewport pixel, topmost first.
   *
   * @remarks
   * The order is the draw order reversed: sorting layers front to back, and within a layer the
   * order `pickAt` would have reached them in. The same sprites are rejected as by
   * {@link TwoDService.pickAt}. Use it for click-cycling through a stack.
   *
   * Cost: one scan of a layer's sprites per sprite examined in it, so `k` hits over a layer of `n`
   * cost `O(k·n)`; hence the default `limit` of {@link DEFAULT_PICK_ALL_LIMIT}.
   *
   * @param xPx - The viewport x, in pixels from the left edge.
   * @param yPx - The viewport y, in pixels from the top edge.
   * @param options - A limit, a filter, an ignore list, and whether unpickable sprites count.
   * @returns The hits, freshly allocated; empty for a miss or a `limit` below 1.
   * @throws IgnifxError with code `IGX-1119` when called from inside a pick's `filter`.
   *
   * @example
   * ```ts
   * const stack = app.twoD.pickAllAt(x, y);
   * const next = stack[(stack.findIndex((hit) => hit.entity === selected) + 1) % stack.length];
   * ```
   */
  pickAllAt(xPx: number, yPx: number, options?: TwoDPickAllOptions): TwoDPick[] {
    const out: TwoDPick[] = [];
    const limit = options?.limit ?? DEFAULT_PICK_ALL_LIMIT;
    if (!(limit >= 1)) {
      return out;
    }
    this.#pick(xPx, yPx, options, limit, out);
    return out;
  }

  /**
   * The walk behind `pickAt` and `pickAllAt`.
   *
   * @param xPx - The viewport x.
   * @param yPx - The viewport y.
   * @param options - The caller's options.
   * @param limit - How many hits to accept before stopping.
   * @param out - Where to push every accepted hit, or `null` to return the first.
   * @returns The first accepted hit, or `null`.
   */
  // oxlint-disable-next-line max-params -- private; an options object would allocate per pick.
  #pick(
    xPx: number,
    yPx: number,
    options: TwoDPickOptions | undefined,
    limit: number,
    out: TwoDPick[] | null,
  ): TwoDPick | null {
    if (this.#picking) {
      // The nested walk's restore would show the outer walk's hidden sprites and loop it forever.
      throw twoDError(TwoDErrorCode.nestedPick, "app.twoD.pickAt was called from inside a pick filter.", {
        hint: "Collect what the filter needs before picking, or pick again after this pick returns.",
      });
    }
    this.#picking = true;
    const layers = this.#runtime.layers.collectLayers(false, this.#pickLayers);
    let found: TwoDPick | null = null;
    let accepted = 0;
    try {
      // Front to back, one layer at a time: Lite's picker compares the point against each sprite's
      // stored `positionPx` without applying the view, so the point has to be unprojected through
      // *that* layer's view — and a world layer and a screen-space layer do not share one.
      for (let index = layers.length - 1; index >= 0 && accepted < limit; index -= 1) {
        const layer = layers[index];
        if (layer === undefined) {
          continue;
        }
        const point = screenToLayer(layer.view, xPx, yPx, this.#pickPoint);
        this.#oneLayer[0] = layer;
        // Lite reports only the topmost hit in a layer, so look under one by hiding it and asking
        // again; the `finally` below shows every hidden sprite before anything can draw.
        for (let hit = pickSprite(this.#oneLayer, point.x, point.y); hit !== null;) {
          const component = this.#runtime.layers.componentAt(hit.layer, hit.spriteIndex);
          if (component !== null && this.#accepts(component, options)) {
            const pick: TwoDPick = { entity: component.entity, component, u: hit.u, v: hit.v };
            accepted += 1;
            if (out === null) {
              found = pick;
              break;
            }
            out.push(pick);
            if (accepted >= limit) {
              break;
            }
          }
          setSpriteVisibleAt(hit.layer, hit.spriteIndex, this.#visibility, false);
          this.#hiddenLayers.push(hit.layer);
          this.#hiddenIndices.push(hit.spriteIndex);
          hit = pickSprite(this.#oneLayer, point.x, point.y);
        }
      }
    } finally {
      this.#restoreHidden();
      this.#picking = false;
    }
    return found;
  }

  /**
   * Whether a candidate sprite passes the pick's rules.
   *
   * @param component - The candidate.
   * @param options - The caller's options.
   * @returns `true` to accept it.
   */
  #accepts(component: SpriteRenderer, options: TwoDPickOptions | undefined): boolean {
    if (component.isDestroyed) {
      return false;
    }
    if (!component.pickable && options?.includeUnpickable !== true) {
      return false;
    }
    if (options === undefined) {
      return true;
    }
    const entity = component.entity;
    if (options.ignore?.includes(entity) === true) {
      return false;
    }
    return options.filter === undefined || options.filter(entity, component);
  }

  /** Shows every sprite a pick hid, last hidden first. */
  #restoreHidden(): void {
    for (let index = this.#hiddenLayers.length - 1; index >= 0; index -= 1) {
      const layer = this.#hiddenLayers[index];
      const spriteIndex = this.#hiddenIndices[index];
      if (layer !== undefined && spriteIndex !== undefined) {
        setSpriteVisibleAt(layer, spriteIndex, this.#visibility, true);
      }
    }
    this.#hiddenLayers.length = 0;
    this.#hiddenIndices.length = 0;
  }

  /**
   * Claims a fixed-capacity crowd of sprites that no entity owns
   * (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2).
   *
   * @remarks
   * Use it when the sprites are not *things* — bullets, sparks, debris, 2D particles — and the
   * per-entity cost of a `SpriteRenderer` would dominate. The batch is not picked and does not sort
   * its own slots; see {@link SpriteBatch}. Dispose it when the crowd is gone, or take it with
   * `using`.
   *
   * @param options - The atlas, the capacity, the sorting layer, the blend, and the space.
   * @returns The batch.
   * @throws IgnifxError with code `IGX-1114` for a capacity that is not a whole number of at least
   * 1, `IGX-1117` for an atlas handle that has not finished loading, or `IGX-1107` for a sorting
   * layer the project does not declare.
   *
   * @example
   * ```ts
   * const atlas = app.assets.load<SpriteAtlasAsset>("2d/spark.atlas.json");
   * await atlas.promise;
   * const batch = app.twoD.createSpriteBatch({ atlas, capacity: 2048, blend: "additive" });
   * batch.count = 1;
   * batch.write(0, 0, 0, 0.2, 0.2, 0, 0, 1, 0.8, 0.3, 1);
   * ```
   *
   * @beta
   */
  createSpriteBatch(options: SpriteBatchOptions): SpriteBatch {
    return createSpriteBatch(this.#runtime, options);
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
    // The camera's own view, not `first.view`: a parallax band's layer can sort first, and its
    // view is slid away from the camera's.
    visibleBounds(
      this.#runtime.cameraView,
      this.#runtime.viewportWidthPx,
      this.#runtime.viewportHeightPx,
      this.#bounds,
    );
    const ppu = this.#runtime.pixelsPerUnit;
    // Layer pixels run +Y down, so the bounds' maxY is the world minimum.
    pixelsToWorldToRef(this.#bounds.minX, this.#bounds.maxY, ppu, out.min);
    pixelsToWorldToRef(this.#bounds.maxX, this.#bounds.minY, ppu, out.max);
    return true;
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
