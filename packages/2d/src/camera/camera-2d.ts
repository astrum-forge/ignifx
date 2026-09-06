import { bool, Component, createDefaults, defineSchema, entityRef, f32, i32, optional, vec2, Vec2 } from "@ignifx/core";
import {
  pixelsToWorldToRef,
  snapPixel,
  snapZoomToInteger,
  viewRotationToLite,
  worldToPixelsToRef,
  zoomForSize,
} from "../math/coords.js";
import type { Entity, MutableVec2, Schema, Vec2Like } from "@ignifx/core";

/**
 * `Camera2D` (`docs/architecture/11-2d-toolkit.md` §2.1): the component that drives every world
 * sprite layer's `Sprite2DView`.
 *
 * The camera holds no Lite object of its own. A `Sprite2DView` belongs to a layer, and every world
 * layer gets the *same* view written to it each frame, which is what makes the layers move
 * together; screen-space layers keep the identity view. The 2D sync system does the writing —
 * this class owns the arithmetic and the public conversions.
 */

/**
 * The half-height, in metres, a camera that declares none shows.
 *
 * @public
 */
export const DEFAULT_ORTHOGRAPHIC_SIZE = 5;

/**
 * The reference resolution a pixel-perfect camera fits an integer zoom to.
 *
 * @public
 */
export const DEFAULT_REFERENCE_RESOLUTION: Vec2Like = Object.freeze({ x: 640, y: 360 });

/**
 * The 2D camera.
 *
 * @remarks
 * `orthographicSize` is a **half-height in metres**, exactly as Unity's orthographic camera is, so
 * the zoom it produces is `viewportHeightPx / (2 · size · PPU)`. With `pixelPerfect` on, that zoom
 * is snapped to a whole number (or to `1/n` when the camera is pulled far out) and the camera's
 * position is snapped to the pixel grid at sync time — scripts keep their sub-pixel positions, so
 * movement stays smooth even though drawing does not.
 *
 * @example
 * ```ts
 * const camera = app.world.createEntity({ name: "camera" }).addComponent(Camera2D);
 * camera.orthographicSize = 3;
 * camera.pixelPerfect = true;
 * ```
 *
 * @public
 */
export class Camera2D extends Component {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Camera2D";

  /** One camera per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = camera2DSchema();

  /** Half the viewport height, in metres. */
  declare orthographicSize: number;

  /** Whether zoom snaps to an integer and positions snap to the pixel grid. */
  declare pixelPerfect: boolean;

  /** The design resolution a pixel-perfect camera fits an integer zoom to, in pixels. */
  declare referenceResolution: Vec2Like;

  /** The lower bound of the camera's travel, in metres, or `null` for no bound. */
  declare boundsMin: Vec2Like | null;

  /** The upper bound of the camera's travel, in metres, or `null` for no bound. */
  declare boundsMax: Vec2Like | null;

  /** The entity this camera follows, or `null`. Read by `Camera2DFollow`. */
  declare follow: Entity | null;

  /** How long the follow takes to catch up, in seconds. */
  declare followDamping: number;

  /** A constant offset added to the followed entity's position, in metres. */
  declare followOffset: Vec2Like;

  /** The half-size of the rectangle the target may move inside before the camera reacts, in metres. */
  declare deadZone: Vec2Like;

  /** Highest wins when a world has several enabled cameras. */
  declare priority: number;

  /** The viewport width the last sync measured, in pixels. */
  #viewportWidthPx = 0;

  /** The viewport height the last sync measured, in pixels. */
  #viewportHeightPx = 0;

  /** The pixels-per-unit the last sync used. */
  #pixelsPerUnit = 100;

  /** The zoom the last sync computed, after any pixel-perfect snapping. */
  #zoom = 1;

  /** The world centre the last sync used, after bounds clamping and pixel snapping. */
  readonly #centre: MutableVec2 = new Vec2();

  /** Scratch, so the conversions allocate nothing (coding standards §7). */
  readonly #scratchA: MutableVec2 = new Vec2();

  /** Scratch; see {@link Camera2D.screenToWorld}. */
  readonly #scratchB: MutableVec2 = new Vec2();

  /**
   * Builds a camera with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(Camera2D.schema));
  }

  /**
   * The zoom the camera last resolved to — `Sprite2DView.zoom`.
   *
   * @returns The zoom; `1` before the first sync.
   */
  get zoom(): number {
    return this.#zoom;
  }

  /**
   * The viewport the camera last measured, in pixels.
   *
   * @returns A read-only view of the size.
   */
  get viewportSizePx(): Vec2Like {
    return { x: this.#viewportWidthPx, y: this.#viewportHeightPx };
  }

  /**
   * The world point the camera is centred on, after bounds clamping and pixel-perfect snapping.
   *
   * @returns A read-only view of the centre, in metres.
   */
  get centre(): Vec2Like {
    return this.#centre;
  }

  /**
   * Recomputes the camera's zoom and centre. The 2D sync system calls this once per frame, before
   * it writes the view onto each world layer.
   *
   * @param worldX - The entity's world x, in metres.
   * @param worldY - The entity's world y, in metres.
   * @param viewportWidthPx - The surface width, in pixels.
   * @param viewportHeightPx - The surface height, in pixels.
   * @param pixelsPerUnit - The pixels one metre spans.
   *
   * @internal
   */
  // oxlint-disable-next-line max-params -- once per camera per frame; an options object would allocate.
  resolve(
    worldX: number,
    worldY: number,
    viewportWidthPx: number,
    viewportHeightPx: number,
    pixelsPerUnit: number,
  ): void {
    this.#viewportWidthPx = viewportWidthPx;
    this.#viewportHeightPx = viewportHeightPx;
    this.#pixelsPerUnit = pixelsPerUnit;
    const raw = zoomForSize(viewportHeightPx, this.orthographicSize, pixelsPerUnit);
    // Pixel-perfect ignores `orthographicSize` and scales the reference resolution by a whole
    // number instead, which is what makes one source texel cover an exact square of screen pixels
    // (`docs/architecture/11-2d-toolkit.md` §4). Unity's Pixel Perfect Camera does the same.
    const referenceHeight = this.referenceResolution.y;
    const scaled = this.pixelPerfect
      ? snapZoomToInteger(referenceHeight > 0 ? viewportHeightPx / referenceHeight : raw)
      : raw;
    this.#zoom = scaled > 0 ? scaled : 1;
    let centreX = worldX;
    let centreY = worldY;
    const min = this.boundsMin;
    const max = this.boundsMax;
    if (min !== null && max !== null) {
      const halfHeight = viewportHeightPx / (2 * this.#zoom * pixelsPerUnit);
      const halfWidth = viewportWidthPx / (2 * this.#zoom * pixelsPerUnit);
      centreX = clampSpan(centreX, min.x, max.x, halfWidth);
      centreY = clampSpan(centreY, min.y, max.y, halfHeight);
    }
    if (this.pixelPerfect) {
      centreX = snapPixel(centreX * pixelsPerUnit, this.#zoom) / pixelsPerUnit;
      centreY = snapPixel(centreY * pixelsPerUnit, this.#zoom) / pixelsPerUnit;
    }
    this.#centre.x = centreX;
    this.#centre.y = centreY;
  }

  /**
   * Converts a viewport pixel into a world point.
   *
   * @remarks
   * `x` and `y` are measured from the surface's top-left corner, which is what a `PointerEvent`
   * reports and what `@ignifx/input`'s pointer position carries. The result is in metres with +Y
   * up. Before the first frame has synced, the camera has no viewport and the result is the
   * camera's own centre.
   *
   * @param x - The viewport x, in pixels from the left edge.
   * @param y - The viewport y, in pixels from the top edge.
   * @param out - The vector to write; omitting it allocates one.
   * @returns `out`, in world metres.
   *
   * @example
   * ```ts
   * const world = camera.screenToWorld(pointer.x, pointer.y);
   * ```
   */
  screenToWorld(x: number, y: number, out: MutableVec2 = new Vec2()): MutableVec2 {
    const zoom = this.#zoom;
    if (this.#viewportWidthPx === 0 || zoom === 0) {
      out.x = this.#centre.x;
      out.y = this.#centre.y;
      return out;
    }
    // The view's top-left in layer pixels, then the offset the pixel sits at, unrotated.
    const centrePx = worldToPixelsToRef(this.#centre.x, this.#centre.y, this.#pixelsPerUnit, this.#scratchA);
    const offsetX = (x - this.#viewportWidthPx * 0.5) / zoom;
    const offsetY = (y - this.#viewportHeightPx * 0.5) / zoom;
    const rotation = viewRotationToLite(this.#rotationDegrees());
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const layerX = centrePx.x + offsetX * cos + offsetY * sin;
    const layerY = centrePx.y - offsetX * sin + offsetY * cos;
    return pixelsToWorldToRef(layerX, layerY, this.#pixelsPerUnit, out);
  }

  /**
   * Converts a world point into a viewport pixel.
   *
   * @param point - The world point, in metres.
   * @param out - The vector to write; omitting it allocates one.
   * @returns `out`, in pixels from the surface's top-left corner.
   */
  worldToScreen(point: Vec2Like, out: MutableVec2 = new Vec2()): MutableVec2 {
    const zoom = this.#zoom;
    const centrePx = worldToPixelsToRef(this.#centre.x, this.#centre.y, this.#pixelsPerUnit, this.#scratchA);
    const pointPx = worldToPixelsToRef(point.x, point.y, this.#pixelsPerUnit, this.#scratchB);
    const deltaX = pointPx.x - centrePx.x;
    const deltaY = pointPx.y - centrePx.y;
    const rotation = viewRotationToLite(this.#rotationDegrees());
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    out.x = (deltaX * cos - deltaY * sin) * zoom + this.#viewportWidthPx * 0.5;
    out.y = (deltaX * sin + deltaY * cos) * zoom + this.#viewportHeightPx * 0.5;
    return out;
  }

  /**
   * The camera entity's rotation about +Z, in degrees counter-clockwise.
   *
   * @returns The angle; `0` when the component is not attached yet.
   */
  #rotationDegrees(): number {
    return this.entity.transform.rotation2D;
  }
}

/**
 * Clamps a camera centre so the viewport stays inside a bound.
 *
 * @remarks
 * When the bound is narrower than the viewport there is no position that keeps the viewport
 * inside it, so the camera centres on the bound instead of jittering against one edge — the
 * behaviour Godot's `limit_*` has.
 *
 * @param value - The desired centre.
 * @param min - The lower bound.
 * @param max - The upper bound.
 * @param half - Half the viewport's extent on this axis, in metres.
 * @returns The clamped centre.
 */
function clampSpan(value: number, min: number, max: number, half: number): number {
  if (max - min <= half * 2) {
    return (min + max) * 0.5;
  }
  return Math.min(Math.max(value, min + half), max - half);
}

/**
 * The `Camera2D` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function camera2DSchema(): Schema {
  return defineSchema({
    orthographicSize: f32(DEFAULT_ORTHOGRAPHIC_SIZE, {
      min: Number.EPSILON,
      tooltip: "Half the viewport height, in metres.",
    }),
    pixelPerfect: bool(false, { tooltip: "Snap zoom to an integer and positions to whole pixels." }),
    referenceResolution: vec2(DEFAULT_REFERENCE_RESOLUTION, {
      tooltip: "The design resolution a pixel-perfect camera fits an integer zoom to.",
    }),
    boundsMin: optional(vec2(), { tooltip: "The lower bound of the camera's travel, in metres." }),
    boundsMax: optional(vec2(), { tooltip: "The upper bound of the camera's travel, in metres." }),
    follow: entityRef<Entity>({ tooltip: "The entity Camera2DFollow tracks." }),
    followDamping: f32(0.15, { min: 0, tooltip: "Seconds the follow takes to catch up; 0 is rigid." }),
    followOffset: vec2({ x: 0, y: 0 }, { tooltip: "A constant offset added to the followed position." }),
    deadZone: vec2({ x: 0, y: 0 }, { tooltip: "Half-size of the rectangle the target moves in freely." }),
    priority: i32(0, { tooltip: "Highest enabled camera wins." }),
  });
}
