/**
 * The scene view's 2D editor camera (S0.2 §5): a script on the editor camera's entity that, while
 * the view is in 2D mode, drives an editor-owned `Camera2D` that outranks the level's, and turns
 * the 3D editor camera into a matching orthographic camera looking down +Z at the 2D plane, so
 * the gizmo overlay and the 3D picker see what the sprites show. The level's own `Camera2D` is
 * never touched.
 */

import { Script } from "@ignifx/core";
import {
  DEFAULT_PIXELS_PER_UNIT,
  fitView,
  orthographicSizeFor,
  screenToWorld2D,
  stepZoom,
  zoomAbout,
} from "./view-2d.js";
import { setCapture } from "./editor-camera.js";
import type { PointerClaims, ViewClick } from "./editor-camera.js";
import type { Box2D, Camera2DLike, View2D } from "./view-2d.js";
import type { Camera, ScriptCallbacks } from "@ignifx/core";

/** How far in front of the 2D plane the orthographic eye sits, in metres (it looks along +Z). */
export const EYE_DISTANCE_2D = 500;

/** How far a press may move, in CSS pixels, and still be a click. */
const CLICK_SLOP_PX = 4;

/** How much wheel travel, in pixels, makes one zoom step; a mouse notch is about 100. */
const WHEEL_STEP_PX = 50;

/** The gesture the current pointer press drives. */
type Gesture2D = "none" | "click" | "pan";

/**
 * Pans and zooms the 2D view on DOM pointer events, and frames what it is asked to.
 *
 * @remarks
 * Middle drag, right drag, and left drag with Space held pan; the wheel zooms in pixel steps about
 * the cursor; a left click is reported to `onClick`. A press on a gizmo handle is left to the
 * gizmo, by the same rule as the 3D camera (S0.2 §4.2). It does nothing until
 * {@link EditorCamera2D.activate}.
 */
export class EditorCamera2D extends Script implements ScriptCallbacks {
  /** The type id; the host leaves it out of the schemas it reports. */
  static typeId = "ignifx-editor/EditorCamera2D";

  /** The scene view runs in edit mode, where only these scripts get callbacks. */
  static runInEditMode = true;

  /** The world x at the view's centre, in metres. */
  centerX = 0;

  /** The world y at the view's centre, in metres. */
  centerY = 0;

  /** Screen pixels per layer pixel, as `Camera2D.zoom`. */
  zoom = 1;

  /**
   * Reads the layer pixels per metre: the project's `twoD.pixelsPerUnit`.
   *
   * @returns The pixels per unit.
   */
  pixelsPerUnit: () => number = () => DEFAULT_PIXELS_PER_UNIT;

  /** The gizmo dispatcher, once the view has one. */
  claims: PointerClaims | null = null;

  /** Receives each click on the view. */
  onClick: ((click: ViewClick) => void) | null = null;

  #active = false;

  #eye: Camera | null = null;

  #camera2D: Camera2DLike | null = null;

  #canvas: HTMLCanvasElement | null = null;

  #gesture: Gesture2D = "none";

  #pointer = -1;

  #lastX = 0;

  #lastY = 0;

  #downX = 0;

  #downY = 0;

  #moved = false;

  #space = false;

  #wheel = 0;

  /** Whether the entity holds the 2D pose since the last {@link EditorCamera2D.activate}. */
  #posed = false;

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (!this.#active || this.#pointer !== -1) {
      return;
    }
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#moved = false;
    if (event.button === 0) {
      this.#gesture = this.#space ? "pan" : this.claims?.pointerState().interacting === true ? "none" : "click";
    } else if (event.button === 1 || event.button === 2) {
      this.#gesture = "pan";
      event.preventDefault();
    } else {
      return;
    }
    this.#pointer = event.pointerId;
    setCapture(this.#canvas, event.pointerId, true);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) {
      return;
    }
    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    if (Math.hypot(event.offsetX - this.#downX, event.offsetY - this.#downY) > CLICK_SLOP_PX) {
      this.#moved = true;
    }
    if (this.#gesture === "pan") {
      const metresPerCssPixel = this.#backingRatio() / (this.zoom * this.pixelsPerUnit());
      this.centerX -= dx * metresPerCssPixel;
      this.centerY += dy * metresPerCssPixel;
      this.apply();
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) {
      return;
    }
    setCapture(this.#canvas, event.pointerId, false);
    this.#pointer = -1;
    const gesture = this.#gesture;
    this.#gesture = "none";
    if (event.button === 0 && gesture === "click" && !this.#moved && this.claims?.pointerState().dragging !== true) {
      this.onClick?.({
        x: event.offsetX,
        y: event.offsetY,
        toggle: event.shiftKey || event.ctrlKey || event.metaKey,
      });
    }
  };

  readonly #onWheel = (event: WheelEvent): void => {
    if (!this.#active) {
      return;
    }
    event.preventDefault();
    this.#wheel += event.deltaY;
    if (Math.abs(this.#wheel) < WHEEL_STEP_PX) {
      return;
    }
    const direction = this.#wheel < 0 ? 1 : -1;
    this.#wheel = 0;
    const ratio = this.#backingRatio();
    this.zoomTo(stepZoom(this.zoom, direction), event.offsetX * ratio, event.offsetY * ratio);
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      this.#space = true;
    }
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      this.#space = false;
    }
  };

  /**
   * Gives the camera the components it drives: the 3D editor camera, and the editor's own
   * `Camera2D` when the project has `@ignifx/2d`.
   *
   * @param eye - The 3D editor camera, on this script's entity.
   * @param camera2D - The editor's `Camera2D`, on this script's entity, or `null`.
   */
  attach(eye: Camera, camera2D: Camera2DLike | null): void {
    this.#eye = eye;
    this.#camera2D = camera2D;
  }

  /**
   * Whether the view is in 2D mode.
   *
   * @returns True between {@link EditorCamera2D.activate} and {@link EditorCamera2D.deactivate}.
   */
  get active(): boolean {
    return this.#active;
  }

  /** Enters 2D mode: enables the editor's `Camera2D` and makes the 3D editor camera orthographic. */
  activate(): void {
    this.#active = true;
    // The 3D camera left the entity turned; the next apply writes the pose whatever it is.
    this.#posed = false;
    if (this.#camera2D !== null) {
      this.#camera2D.enabled = true;
    }
    if (this.#eye !== null) {
      this.#eye.projection = "orthographic";
    }
    this.apply();
  }

  /** Leaves 2D mode: the level's cameras draw the sprites again, and the 3D camera is perspective. */
  deactivate(): void {
    this.#active = false;
    this.#pointer = -1;
    this.#gesture = "none";
    if (this.#camera2D !== null) {
      this.#camera2D.enabled = false;
    }
    if (this.#eye !== null) {
      this.#eye.projection = "perspective";
    }
  }

  /**
   * Starts listening to a canvas's pointer, wheel and Space key events.
   *
   * @param canvas - The scene view's canvas.
   */
  bind(canvas: HTMLCanvasElement): void {
    this.#canvas = canvas;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    canvas.ownerDocument.addEventListener("keydown", this.#onKeyDown);
    canvas.ownerDocument.addEventListener("keyup", this.#onKeyUp);
  }

  /** Stops listening. */
  onDestroy(): void {
    const canvas = this.#canvas;
    if (canvas === null) {
      return;
    }
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerup", this.#onPointerUp);
    canvas.removeEventListener("pointercancel", this.#onPointerUp);
    canvas.removeEventListener("wheel", this.#onWheel);
    canvas.ownerDocument.removeEventListener("keydown", this.#onKeyDown);
    canvas.ownerDocument.removeEventListener("keyup", this.#onKeyUp);
    this.#canvas = null;
  }

  /**
   * What the view shows now.
   *
   * @returns The centre, zoom, pixels per unit and backing-store size.
   */
  view(): View2D {
    return {
      centerX: this.centerX,
      centerY: this.centerY,
      zoom: this.zoom,
      pixelsPerUnit: this.pixelsPerUnit(),
      widthPx: Math.max(1, this.#canvas?.width ?? 1),
      heightPx: Math.max(1, this.#canvas?.height ?? 1),
    };
  }

  /**
   * The world point under a backing-store pixel.
   *
   * @param x - The pixel x.
   * @param y - The pixel y.
   * @returns The point, in metres, +Y up.
   */
  screenToWorld(x: number, y: number): { readonly x: number; readonly y: number } {
    return screenToWorld2D(this.view(), x, y);
  }

  /**
   * Shows a world rectangle: centred, at the zoom that fits it with a margin.
   *
   * @param box - The rectangle, in metres.
   */
  frame(box: Box2D): void {
    const view = this.view();
    const fit = fitView(box, view.widthPx, view.heightPx, view.pixelsPerUnit);
    this.centerX = fit.centerX;
    this.centerY = fit.centerY;
    this.zoom = fit.zoom;
    this.apply();
  }

  /**
   * Changes the zoom about a backing-store pixel, keeping the world point under it in place.
   *
   * @param zoom - The new zoom.
   * @param x - The pixel x.
   * @param y - The pixel y.
   */
  zoomTo(zoom: number, x: number, y: number): void {
    const centre = zoomAbout(this.view(), x, y, zoom);
    this.centerX = centre.centerX;
    this.centerY = centre.centerY;
    this.zoom = zoom;
    this.apply();
  }

  /** Keeps the shown size in step with the canvas, which can be resized at any time. */
  update(): void {
    if (this.#active) {
      this.apply();
    }
  }

  /**
   * Writes the view onto the entity and the two cameras: the entity sits on the view's centre,
   * {@link EYE_DISTANCE_2D} in front of the plane, looking along +Z with +Y up, so its x and y are
   * the `Camera2D`'s centre and its orthographic half-height is the `Camera2D`'s.
   */
  apply(): void {
    if (!this.#active) {
      return;
    }
    const view = this.view();
    const size = orthographicSizeFor(view.zoom, view.heightPx, view.pixelsPerUnit);
    const position = this.transform.localPosition;
    // Called every frame; an unchanged pose is not rewritten, so the transform stays clean.
    if (!this.#posed || position.x !== this.centerX || position.y !== this.centerY) {
      position.set(this.centerX, this.centerY, -EYE_DISTANCE_2D);
      this.transform.lookAt({ x: this.centerX, y: this.centerY, z: 0 });
      this.#posed = true;
    }
    if (this.#eye !== null && this.#eye.orthographicSize !== size) {
      this.#eye.orthographicSize = size;
    }
    if (this.#camera2D !== null && this.#camera2D.orthographicSize !== size) {
      this.#camera2D.orthographicSize = size;
    }
  }

  /**
   * The canvas's backing pixels per CSS pixel.
   *
   * @returns `canvas.width / canvas.clientWidth`, or 1 without a laid-out canvas.
   */
  #backingRatio(): number {
    const canvas = this.#canvas;
    return canvas === null || canvas.clientWidth <= 0 ? 1 : canvas.width / canvas.clientWidth;
  }
}
