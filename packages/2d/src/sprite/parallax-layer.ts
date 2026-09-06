import { bool, Component, createDefaults, defineSchema, f32, str, vec2, Vec2 } from "@ignifx/core";
import { worldToPixelsToRef } from "../math/coords.js";
import { DEFAULT_SORTING_LAYER } from "../service/sorting-layers.js";
import type { Camera2D } from "../camera/camera-2d.js";
import type { SpriteLayerEntry } from "../service/layer-registry.js";
import type { MutableVec2, Schema, Vec2Like } from "@ignifx/core";

/**
 * `ParallaxLayer` (`docs/architecture/11-2d-toolkit.md` §2.6): makes one sorting layer scroll at a
 * fraction of the camera's speed, which is what gives a side-scroller depth.
 *
 * The component owns no sprites. It reaches into the views of every Lite layer belonging to its
 * sorting layer, after the 2D sync system has written the camera's view onto them, and slides each
 * one back by `cameraPositionPx × (1 − factor)`. A factor of `1` moves with the camera (no
 * parallax); `0` is pinned to the world origin, which is what a distant sky wants.
 */

/**
 * A parallax layer.
 *
 * @example
 * ```ts
 * const sky = app.world.createEntity({ name: "sky" }).addComponent(ParallaxLayer);
 * sky.sortingLayer = "Background";
 * sky.factor = { x: 0.2, y: 0.5 };
 * ```
 *
 * @public
 */
export class ParallaxLayer extends Component {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/ParallaxLayer";

  /** One parallax setting per entity; several entities may each drive a different sorting layer. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = parallaxLayerSchema();

  /** Which sorting layer this component slows down. */
  declare sortingLayer: string;

  /** How much of the camera's motion the layer follows, per axis; `1` is no parallax. */
  declare factor: Vec2Like;

  /** Whether the layer's sprites repeat horizontally across the camera's view. */
  declare repeatX: boolean;

  /** Whether the layer's sprites repeat vertically. */
  declare repeatY: boolean;

  /** The world width one repetition spans, in metres; `0` disables horizontal repetition. */
  declare repeatWidth: number;

  /** The world height one repetition spans, in metres. */
  declare repeatHeight: number;

  /** Scratch, so applying the offset allocates nothing. */
  readonly #scratch: MutableVec2 = new Vec2();

  /**
   * Builds a parallax layer with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(ParallaxLayer.schema));
  }

  /**
   * Slides every matching layer's view.
   *
   * @remarks
   * Runs after the camera has written its own view, so the arithmetic is a pure offset:
   * `view.positionPx -= cameraPx × (1 − factor)`. With `repeatX`/`repeatY` the offset is taken
   * modulo one repetition, which keeps a tiled backdrop from drifting away from the camera no
   * matter how far the player walks — and keeps the number in single-precision range.
   *
   * @param entries - Every layer, as the registry describes them.
   * @param camera - The active camera.
   * @param pixelsPerUnit - The pixels one metre spans.
   *
   * @internal
   */
  applyTo(entries: readonly SpriteLayerEntry[], camera: Camera2D, pixelsPerUnit: number): void {
    const cameraPx = worldToPixelsToRef(camera.centre.x, camera.centre.y, pixelsPerUnit, this.#scratch);
    let offsetX = cameraPx.x * (1 - this.factor.x);
    let offsetY = cameraPx.y * (1 - this.factor.y);
    if (this.repeatX && this.repeatWidth > 0) {
      offsetX = wrap(offsetX, this.repeatWidth * pixelsPerUnit);
    }
    if (this.repeatY && this.repeatHeight > 0) {
      offsetY = wrap(offsetY, this.repeatHeight * pixelsPerUnit);
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined || entry.screenSpace || entry.sortingLayer !== this.sortingLayer) {
        continue;
      }
      const view = entry.layer.view;
      view.positionPx[0] -= offsetX;
      view.positionPx[1] -= offsetY;
    }
  }
}

/**
 * Wraps a value into `[0, span)`, keeping the sign of the mathematical modulus.
 *
 * @param value - The value.
 * @param span - The period; must be greater than zero.
 * @returns The wrapped value.
 */
function wrap(value: number, span: number): number {
  const remainder = value % span;
  return remainder < 0 ? remainder + span : remainder;
}

/**
 * The `ParallaxLayer` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function parallaxLayerSchema(): Schema {
  return defineSchema({
    sortingLayer: str(DEFAULT_SORTING_LAYER, { tooltip: "Which sorting layer scrolls slowly." }),
    factor: vec2({ x: 0.5, y: 1 }, { tooltip: "Fraction of the camera's motion the layer follows." }),
    repeatX: bool(false, { tooltip: "Tile the layer horizontally across the camera's view." }),
    repeatY: bool(false, { tooltip: "Tile the layer vertically." }),
    repeatWidth: f32(0, { min: 0, tooltip: "World width of one repetition, in metres." }),
    repeatHeight: f32(0, { min: 0, tooltip: "World height of one repetition, in metres." }),
  });
}
