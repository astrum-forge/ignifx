/**
 * The arithmetic of the scene view's methods that needs no GPU: the `pick` unit rule, the
 * `screenshot` size rule, the transform the drag notifications carry, and gizmo snapping. Each is a
 * pure function, so the headless tests check it directly.
 */

import { canonicalizeNumber } from "@ignifx/core";
import { PickUnit, SCREENSHOT_MAX_SIZE } from "../protocol/index.js";
import type { GizmoSnap, PickParams, ScreenshotParams, SceneFileTransform } from "../protocol/index.js";
import type { Entity, MutableQuat, MutableVec3 } from "@ignifx/core";

/** An image or frame size, in pixels. */
export interface PixelSize {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/** The sizes of the view's canvas that the unit rule needs. */
export interface ViewSurface {
  /** The backing-store width, `canvas.width`. */
  readonly width: number;
  /** The backing-store height, `canvas.height`. */
  readonly height: number;
  /** The CSS width, `canvas.clientWidth`. */
  readonly clientWidth: number;
  /** The CSS height, `canvas.clientHeight`. */
  readonly clientHeight: number;
}

/**
 * Reads a render surface's sizes. An `OffscreenCanvas` has no CSS size, so its CSS pixels are its
 * backing pixels.
 *
 * @param surface - The canvas.
 * @returns The sizes.
 */
export function viewSurfaceOf(surface: HTMLCanvasElement | OffscreenCanvas): ViewSurface {
  const clientWidth: unknown = Reflect.get(surface, "clientWidth");
  const clientHeight: unknown = Reflect.get(surface, "clientHeight");
  return {
    width: surface.width,
    height: surface.height,
    clientWidth: typeof clientWidth === "number" && clientWidth > 0 ? clientWidth : surface.width,
    clientHeight: typeof clientHeight === "number" && clientHeight > 0 ? clientHeight : surface.height,
  };
}

/**
 * Converts a `pick` point to the backing-store pixels `app.renderer.pickAsync` takes (protocol 0.3,
 * "The pick unit rule"; engine ask E3). This is the host's one conversion: the renderer converts
 * on to the CSS pixels Lite's picker wants.
 *
 * @param params - The point and its unit.
 * @param surface - The canvas's sizes.
 * @returns The point in backing-store pixels, or `null` when it is outside the canvas (a miss).
 */
export function toBackingPixels(
  params: PickParams,
  surface: ViewSurface,
): { readonly x: number; readonly y: number } | null {
  const x = params.unit === PickUnit.backing ? params.x : (params.x * surface.width) / surface.clientWidth;
  const y = params.unit === PickUnit.backing ? params.y : (params.y * surface.height) / surface.clientHeight;
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) {
    return null;
  }
  return { x, y };
}

/**
 * Rounds an image side and keeps it from 1 to {@link SCREENSHOT_MAX_SIZE}.
 *
 * @param side - The side, in pixels.
 * @returns The whole side in range.
 */
function clampSide(side: number): number {
  return Math.min(SCREENSHOT_MAX_SIZE, Math.max(1, Math.round(side)));
}

/**
 * The size of a `screenshot`: the request's, or the view's backing size scaled down, keeping its
 * aspect, to fit {@link SCREENSHOT_MAX_SIZE}; with one side given the other follows the aspect.
 *
 * @param params - The request; its sizes are already checked to be 1 to 2048.
 * @param view - The captured frame's size.
 * @returns The image size, each side at least 1 and at most 2048.
 */
export function screenshotSize(params: ScreenshotParams, view: PixelSize): PixelSize {
  const aspect = view.height > 0 ? view.width / view.height : 1;
  const { width, height } = params;
  if (width !== undefined && height !== undefined) {
    return { width, height };
  }
  if (width !== undefined) {
    return { width, height: clampSide(width / aspect) };
  }
  if (height !== undefined) {
    return { width: clampSide(height * aspect), height };
  }
  const fit = Math.min(1, SCREENSHOT_MAX_SIZE / Math.max(view.width, view.height, 1));
  return { width: clampSide(view.width * fit), height: clampSide(view.height * fit) };
}

/**
 * Reads an entity's local transform as the scene file writes it, numbers canonicalized.
 *
 * @param entity - The entity.
 * @returns The transform.
 */
export function readLocalTransform(entity: Entity): SceneFileTransform {
  const { localPosition: p, localRotation: r, localScale: s } = entity.transform;
  const c = canonicalizeNumber;
  return {
    position: [c(p.x), c(p.y), c(p.z)],
    rotation: [c(r.x), c(r.y), c(r.z), c(r.w)],
    scale: [c(s.x), c(s.y), c(s.z)],
  };
}

/**
 * Tells whether two transforms are equal number for number.
 *
 * @param a - One transform.
 * @param b - The other.
 * @returns True when every channel matches.
 */
export function sameTransform(a: SceneFileTransform, b: SceneFileTransform): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rounds a value to a step; a step of 0 leaves it alone.
 *
 * @param value - The value.
 * @param step - The step.
 * @returns The snapped value.
 */
function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** A vector or quaternion's channels, as a snapping state holds them. */
type Channels = number[];

/**
 * Snaps a gizmo drag after Lite has applied each move (S0.2 §3.4, post-correction). The raw, unsnapped
 * value is kept apart from the node, so the snapped steps do not accumulate rounding.
 */
export class DragSnapper {
  readonly #mode: "translate" | "rotate" | "scale";

  readonly #snap: GizmoSnap;

  readonly #start: Channels;

  #raw: Channels;

  #written: Channels;

  /**
   * Starts snapping one drag.
   *
   * @param mode - The drag's mode.
   * @param snap - The snapping steps.
   * @param entity - The dragged entity, at drag start.
   */
  constructor(mode: "translate" | "rotate" | "scale", snap: GizmoSnap, entity: Entity) {
    this.#mode = mode;
    this.#snap = snap;
    this.#start = this.#read(entity);
    this.#raw = [...this.#start];
    this.#written = [...this.#start];
  }

  /**
   * Folds the move Lite just wrote into the raw value and writes the snapped value back.
   *
   * @param entity - The dragged entity.
   */
  apply(entity: Entity): void {
    const now = this.#read(entity);
    if (this.#mode === "rotate") {
      this.#applyRotation(entity, now);
      return;
    }
    const step = this.#mode === "translate" ? this.#snap.translate : this.#snap.scale;
    if (step <= 0) {
      return;
    }
    this.#raw = this.#raw.map((value, index) => value + (now[index] ?? 0) - (this.#written[index] ?? 0));
    const snapped = this.#raw.map(
      (value, index) => (this.#start[index] ?? 0) + snapTo(value - (this.#start[index] ?? 0), step),
    );
    const target: MutableVec3 =
      this.#mode === "translate" ? entity.transform.localPosition : entity.transform.localScale;
    target.set(snapped[0] ?? 0, snapped[1] ?? 0, snapped[2] ?? 0);
    this.#written = snapped;
  }

  /**
   * Snaps a rotation drag: a ring turns about one axis, so the turn since drag start is one angle,
   * which is rounded to the step.
   *
   * @param entity - The dragged entity.
   * @param now - Its rotation now, as Lite wrote it.
   */
  #applyRotation(entity: Entity, now: Channels): void {
    const step = this.#snap.rotate;
    if (step <= 0) {
      return;
    }
    // raw = (now · written⁻¹) · raw, then the turn since start = raw · start⁻¹.
    this.#raw = multiply(multiply(now, conjugate(this.#written)), this.#raw);
    const turn = multiply(this.#raw, conjugate(this.#start));
    const sine = Math.hypot(turn[0] ?? 0, turn[1] ?? 0, turn[2] ?? 0);
    if (sine < 1e-9) {
      return;
    }
    const angle = 2 * Math.atan2(sine, turn[3] ?? 1);
    const snapped = (snapTo((angle * 180) / Math.PI, step) * Math.PI) / 180;
    const half = snapped / 2;
    const scale = Math.sin(half) / sine;
    const snappedTurn = [(turn[0] ?? 0) * scale, (turn[1] ?? 0) * scale, (turn[2] ?? 0) * scale, Math.cos(half)];
    const result = multiply(snappedTurn, this.#start);
    const rotation: MutableQuat = entity.transform.localRotation;
    rotation.set(result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1);
    this.#written = result;
  }

  /**
   * Reads the channels this drag moves.
   *
   * @param entity - The entity.
   * @returns Position, scale, or the rotation quaternion.
   */
  #read(entity: Entity): Channels {
    const t = entity.transform;
    if (this.#mode === "rotate") {
      return [t.localRotation.x, t.localRotation.y, t.localRotation.z, t.localRotation.w];
    }
    const v = this.#mode === "translate" ? t.localPosition : t.localScale;
    return [v.x, v.y, v.z];
  }
}

/**
 * Multiplies two quaternions, `a · b`.
 *
 * @param a - The left operand, `[x, y, z, w]`.
 * @param b - The right operand.
 * @returns The product.
 */
function multiply(a: Channels, b: Channels): Channels {
  const [ax = 0, ay = 0, az = 0, aw = 1] = a;
  const [bx = 0, by = 0, bz = 0, bw = 1] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * A unit quaternion's inverse.
 *
 * @param q - The quaternion.
 * @returns Its conjugate.
 */
function conjugate(q: Channels): Channels {
  return [-(q[0] ?? 0), -(q[1] ?? 0), -(q[2] ?? 0), q[3] ?? 1];
}
