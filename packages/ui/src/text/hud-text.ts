import { createDefaults, defineSchema, enumOf, i32, vec2 } from "@ignifx/core";
import { createPixelTextLayer, movePixelTextLayer } from "../lite/text.js";
import { computeHudPlacement, HUD_ANCHORS } from "./hud-layout.js";
import { TextComponent, textSchemaFields } from "./text-component.js";
import type { HudAnchor, HudPlacement } from "./hud-layout.js";
import type { TextRuntime } from "./text-runtime.js";
import type { I18nService } from "../i18n/i18n-service.js";
import type { LiteTextLayer } from "../lite/text.js";
import type { ComponentHooks, Schema, Vec2Like } from "@ignifx/core";

/**
 * `HudText` (`docs/architecture/13-ui.md` §2): pixel-space text drawn by Babylon Lite rather than
 * by the DOM, *"when DOM text is not desirable (e.g. capture-perfect pixel HUDs, screenshots via
 * `captureScreenshot`)"*.
 *
 * ## The coordinate system is the render target, not CSS
 *
 * Lite's text renderer positions a layer against `surface.canvas.width`/`.height`
 * (`lib/text/text-renderer.js`), so `position` is in **backing-store pixels**. That is deliberate
 * and is the whole point of the component: the pixel a `HudText` draws on is the pixel
 * `app.renderer.captureScreenshot()` reads back, so a golden test asserts on an exact address. A
 * DOM label in `app.ui.layer("hud")` is the right tool whenever that is not what you want.
 */

/**
 * Pixel-space HUD text.
 *
 * @example
 * ```ts
 * const label = app.world.createEntity("score").addComponent(HudText);
 * label.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
 * label.anchor = "topLeft";
 * label.position = { x: 16, y: 16 };
 * label.i18nKey = "hud.score";
 * ```
 *
 * @public
 */
export class HudText extends TextComponent implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/HudText";

  /** One HUD label per entity; a second belongs on a second entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = hudTextSchema();

  /** Which point of the render target {@link HudText.position} is measured from. */
  declare anchor: HudAnchor;

  /** The offset from the anchor, in render-target pixels; x grows right, y grows down. */
  declare position: Vec2Like;

  /** The sort order within the text renderer; lower draws first. */
  declare order: number;

  #layer: LiteTextLayer | null = null;

  #runtime: TextRuntime | null = null;

  readonly #placement: HudPlacement = { x: 0, y: 0 };

  /** Builds a HUD label with the schema's defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(HudText.schema));
  }

  /**
   * The Babylon Lite objects the component owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
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
   * Brings the layer in line with the component's fields. The UI text system calls it once a frame.
   *
   * @param runtime - The renderer the layer is registered on.
   * @param i18n - The localization service, or `null`.
   * @param targetWidth - The render target's width, in pixels.
   * @param targetHeight - The render target's height, in pixels.
   *
   * @internal
   */
  sync(runtime: TextRuntime, i18n: I18nService | null, targetWidth: number, targetHeight: number): void {
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
    layer.visible = this.isEnabledInHierarchy;
    const metrics = this.metrics;
    computeHudPlacement(
      {
        anchor: this.anchor,
        offsetX: this.position.x,
        offsetY: this.position.y,
        targetWidth,
        targetHeight,
        blockWidth: metrics.width,
        blockHeight: metrics.height,
        fontSize: this.fontSize,
      },
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
 * The `HudText` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function hudTextSchema(): Schema {
  return defineSchema({
    ...textSchemaFields(),
    anchor: enumOf(HUD_ANCHORS, "topLeft", { tooltip: "Which corner of the screen the position is measured from." }),
    position: vec2({ x: 0, y: 0 }, { tooltip: "The offset from the anchor, in render-target pixels." }),
    order: i32(0, { tooltip: "Sort order within the text renderer; lower draws first." }),
  });
}
