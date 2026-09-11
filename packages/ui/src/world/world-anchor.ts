import { bool, Component, createDefaults, defineSchema, f32, vec3 } from "@ignifx/core";
import { computeAnchorPlacement, createAnchorPlacement } from "./anchor-math.js";
import type { AnchorPlacement } from "./anchor-math.js";
import type { UiPixelMapping } from "../dom/scaling.js";
import type { ComponentHooks, Schema, Vec3Like } from "@ignifx/core";

/**
 * Position a game-owned DOM element without changing its contents or ownership.
 * Cache pose and camera state to avoid redundant style writes; changing a CSS transform still
 * requires a string allocation.
 */

/**
 * An entity-to-element anchor.
 *
 * @example
 * ```ts
 * const tag = document.createElement("div");
 * tag.textContent = "Boss";
 * app.ui.layer("hud").element?.append(tag);
 *
 * const anchor = enemy.addComponent(WorldAnchor);
 * anchor.element = tag;
 * anchor.offset = { x: 0, y: 2, z: 0 };
 * ```
 *
 * @public
 */
export class WorldAnchor extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/WorldAnchor";

  /** One anchored element per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = worldAnchorSchema();

  /** A world-space offset added to the entity's position before projecting, in metres. */
  declare offset: Vec3Like;

  /** Whether the element is hidden when the anchor point is behind the camera. */
  declare hideWhenBehindCamera: boolean;

  /** Whether the element is kept inside the overlay's bounds instead of being hidden off-screen. */
  declare clampToScreen: boolean;

  /** Whether the element shrinks with distance. */
  declare scaleWithDistance: boolean;

  /** The distance at which {@link WorldAnchor.scaleWithDistance} produces a scale of `1`, in metres. */
  declare referenceDistance: number;

  /** The smallest scale distance scaling may produce. */
  declare minScale: number;

  /** The largest scale distance scaling may produce. */
  declare maxScale: number;

  /**
   * The element to position. Not serialised — a DOM node cannot be — so a scene file carries the
   * flags and the game assigns the element in `awake`.
   */
  element: HTMLElement | null = null;

  readonly #placement: AnchorPlacement = createAnchorPlacement();

  #prepared: HTMLElement | null = null;

  #lastX = Number.NaN;

  #lastY = Number.NaN;

  #lastScale = Number.NaN;

  #lastVisible: boolean | null = null;

  /** Builds an anchor with the schema's defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(WorldAnchor.schema));
  }

  /**
   * Where the element was placed on the last synchronised frame.
   *
   * @returns The placement; `visible` is `false` before the first sync.
   */
  get placement(): Readonly<AnchorPlacement> {
    return this.#placement;
  }

  /** Hides the element when the component goes away, so an orphaned tag does not linger. */
  onDetach(): void {
    const element = this.element;
    if (element !== null) {
      element.style.setProperty("display", "none");
    }
    this.#prepared = null;
  }

  /**
   * Places the element for this frame.
   *
   * @param screenX - The anchor point's projected x, in render-target pixels.
   * @param screenY - The anchor point's projected y, in render-target pixels.
   * @param inFront - Whether the point is in front of the camera.
   * @param distance - How far the point is from the camera, in metres.
   * @param viewWidth - The overlay root's width, in UI units.
   * @param viewHeight - The overlay root's height, in UI units.
   * @param mapping - The render-target-pixel to UI-unit conversion.
   *
   * @internal
   */
  place(
    screenX: number,
    screenY: number,
    inFront: boolean,
    distance: number,
    viewWidth: number,
    viewHeight: number,
    mapping: UiPixelMapping,
  ): void {
    const element = this.element;
    if (element === null) {
      return;
    }
    computeAnchorPlacement(
      {
        screenX,
        screenY,
        inFront,
        distance,
        viewWidth,
        viewHeight,
        mapping,
        hideWhenBehindCamera: this.hideWhenBehindCamera,
        clampToScreen: this.clampToScreen,
        scaleWithDistance: this.scaleWithDistance,
        referenceDistance: this.referenceDistance,
        minScale: this.minScale,
        maxScale: this.maxScale,
      },
      this.#placement,
    );
    this.#write(element);
  }

  /**
   * Writes the placement onto the element, skipping every property that did not change.
   *
   * @param element - The element to write.
   */
  #write(element: HTMLElement): void {
    if (this.#prepared !== element) {
      const style = element.style;
      style.setProperty("position", "absolute");
      style.setProperty("left", "0px");
      style.setProperty("top", "0px");
      this.#prepared = element;
      this.#lastVisible = null;
      this.#lastX = Number.NaN;
    }
    const visible = this.#placement.visible && this.isEnabledInHierarchy;
    if (this.#lastVisible !== visible) {
      element.style.setProperty("display", visible ? "block" : "none");
      this.#lastVisible = visible;
    }
    if (!visible) {
      return;
    }
    const { x, y, scale } = this.#placement;
    if (this.#lastX === x && this.#lastY === y && this.#lastScale === scale) {
      return;
    }
    this.#lastX = x;
    this.#lastY = y;
    this.#lastScale = scale;
    element.style.setProperty(
      "transform",
      `translate(${String(x)}px, ${String(y)}px) translate(-50%, -50%) scale(${String(scale)})`,
    );
  }
}

/**
 * The `WorldAnchor` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function worldAnchorSchema(): Schema {
  return defineSchema({
    offset: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "A world-space offset added before projecting, in metres." }),
    hideWhenBehindCamera: bool(true, { tooltip: "Hide the element when the anchor is behind the camera." }),
    clampToScreen: bool(false, { tooltip: "Keep the element inside the overlay instead of hiding it." }),
    scaleWithDistance: bool(false, { tooltip: "Shrink the element as the anchor gets further away." }),
    referenceDistance: f32(10, { min: 0.001, tooltip: "The distance at which the scale is 1, in metres." }),
    minScale: f32(0.25, { min: 0, tooltip: "The smallest scale distance scaling may produce." }),
    maxScale: f32(2, { min: 0, tooltip: "The largest scale distance scaling may produce." }),
  });
}
