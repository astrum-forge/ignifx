import { bool, createDefaults, defineSchema, enumOf, i32, vec2, vec3 } from "@ignifx/core";
import { createPixelTextLayer, movePixelTextLayer } from "../lite/text.js";
import { computePivotPlacement, HUD_ANCHORS } from "./hud-layout.js";
import { TextComponent, textSchemaFields } from "./text-component.js";
import type { HudAnchor, HudPlacement } from "./hud-layout.js";
import type { TextRuntime } from "./text-runtime.js";
import type { I18nService } from "../i18n/i18n-service.js";
import type { LiteTextLayer } from "../lite/text.js";
import type { ComponentHooks, Schema, Vec2Like, Vec3Like } from "@ignifx/core";

/**
 * `WorldText2D` (`docs/architecture/13-ui.md` §2): text that belongs to the world — damage numbers,
 * floating names — but is drawn as a flat pixel-space layer rather than as geometry, so it never
 * shrinks with distance and never intersects a wall.
 *
 * It is `HudText`'s twin: the same Lite text layer, positioned from the entity's **projected**
 * screen position instead of from a screen anchor. `WorldText` is the other choice, and the one to
 * take when the text should be occluded by the world.
 */

/**
 * World-anchored pixel-space text.
 *
 * @example
 * ```ts
 * const damage = app.world.createEntity("damage").addComponent(WorldText2D);
 * damage.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
 * damage.text = "-12";
 * damage.offset = { x: 0, y: 1.8, z: 0 };
 * ```
 *
 * @public
 */
export class WorldText2D extends TextComponent implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/WorldText2D";

  /** One floating label per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = worldText2DSchema();

  /** A world-space offset added to the entity's position before projecting, in metres. */
  declare offset: Vec3Like;

  /** A screen-space offset added after projecting, in render-target pixels. */
  declare screenOffset: Vec2Like;

  /** Which point of the block sits on the projected position. */
  declare pivot: HudAnchor;

  /** Whether the label is hidden when the anchor point is behind the camera. */
  declare hideWhenBehindCamera: boolean;

  /** The sort order within the text renderer; lower draws first. */
  declare order: number;

  #layer: LiteTextLayer | null = null;

  #runtime: TextRuntime | null = null;

  readonly #placement: HudPlacement = { x: 0, y: 0 };

  /** Builds a floating label with the schema's defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(WorldText2D.schema));
  }

  /**
   * The Babylon Lite objects the component owns. Unstable escape hatch.
   *
   * @returns The text layer, or `null` before the first frame that had a font and a string.
   */
  get lite(): { readonly layer: LiteTextLayer | null } {
    return { layer: this.#layer };
  }

  /** Drops the layer and the block when the component goes away. */
  onDetach(): void {
    this.#dropLayer();
    this.releaseBlock();
  }

  /**
   * Brings the layer in line with the component's fields and the projected position.
   *
   * @param runtime - The renderer the layer is registered on.
   * @param i18n - The localization service, or `null`.
   * @param screenX - The entity's projected x, in render-target pixels.
   * @param screenY - The entity's projected y, in render-target pixels.
   * @param inFront - Whether the anchor point is in front of the camera.
   *
   * @internal
   */
  sync(runtime: TextRuntime, i18n: I18nService | null, screenX: number, screenY: number, inFront: boolean): void {
    this.#runtime = runtime;
    const change = this.syncBlock(i18n);
    const block = this.block;
    if (block === null) {
      this.#dropLayer();
      return;
    }
    if (change === "created" || this.#layer === null) {
      this.#dropLayer();
      const layer = createPixelTextLayer(block, this.order, this.opacity);
      this.#layer = layer;
      runtime.addLayer(layer);
    }
    const layer = this.#layer;
    layer.opacity = this.opacity;
    layer.order = this.order;
    layer.visible = this.isEnabledInHierarchy && (inFront || !this.hideWhenBehindCamera);
    const metrics = this.metrics;
    computePivotPlacement(
      this.pivot,
      screenX + this.screenOffset.x,
      screenY + this.screenOffset.y,
      metrics.width,
      metrics.height,
      this.fontSize,
      this.#placement,
    );
    if (layer.positionPx.x !== this.#placement.x || layer.positionPx.y !== this.#placement.y) {
      movePixelTextLayer(layer, this.#placement.x, this.#placement.y);
    }
  }

  /** Removes the layer from the renderer, if it has one. */
  #dropLayer(): void {
    const layer = this.#layer;
    if (layer === null) {
      return;
    }
    this.#runtime?.removeLayer(layer);
    this.#layer = null;
  }
}

/**
 * The `WorldText2D` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function worldText2DSchema(): Schema {
  return defineSchema({
    ...textSchemaFields(),
    offset: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "A world-space offset added before projecting, in metres." }),
    screenOffset: vec2({ x: 0, y: 0 }, { tooltip: "A screen-space offset added after projecting, in pixels." }),
    pivot: enumOf(HUD_ANCHORS, "center", { tooltip: "Which point of the block sits on the projected position." }),
    hideWhenBehindCamera: bool(true, { tooltip: "Hide the label when the anchor is behind the camera." }),
    order: i32(0, { tooltip: "Sort order within the text renderer; lower draws first." }),
  });
}
