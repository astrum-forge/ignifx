/**
 * The scene view's 3D editor camera: an ordinary script on an entity of the host's persistent
 * `editor` scene, beside a `Camera` whose priority outranks every camera of the document.
 */

import { clamp, degToRad, Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/** What the camera asks the gizmo dispatcher before it takes a pointer gesture. */
export interface PointerClaims {
  /**
   * Reads the dispatcher's state for the current gesture.
   *
   * @returns Whether a handle is hovered or dragged, and whether a press is still being picked.
   */
  pointerState(): { readonly interacting: boolean; readonly dragging: boolean; readonly pickPending: boolean };
}

/** A sphere to fit in the view, in world space. */
export interface FrameTarget {
  /** Its centre. */
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  /** Its radius, in metres. */
  readonly radius: number;
}

/** A click on the view: where, and with which modifier keys. */
export interface ViewClick {
  /** The CSS pixel x, from the canvas's left edge. */
  readonly x: number;
  /** The CSS pixel y, from the canvas's top edge. */
  readonly y: number;
  /** Shift, Ctrl or Cmd was held: the click toggles rather than replaces. */
  readonly toggle: boolean;
}

/** The camera's vertical field of view, in degrees. */
export const EDITOR_CAMERA_FOV = 50;

/** The steepest the camera looks up or down, in degrees. */
const MAX_PITCH = 89;

/** How far a press may move, in CSS pixels, and still be a click. */
const CLICK_SLOP_PX = 4;

/** The gesture the current pointer press drives. */
type Gesture = "none" | "orbit" | "fly" | "pan";

/**
 * Orbits, flies and pans around a focus point on DOM pointer events, and frames what it is asked to.
 *
 * @remarks
 * Left drag orbits, middle drag pans, right drag looks around while W, A, S, D, Q and E fly (Shift
 * for speed), the wheel dollies, and a left click is reported to `onClick`. The camera listens in
 * the bubble phase, after Lite's gizmo dispatcher has seen the press in the capture phase, and it
 * yields to the gizmo by the three rules Lite documents for its own controls (S0.2 §4.2): no orbit
 * starts on a hovered handle, a move is held while the press is still being picked, and an orbit
 * stops once a gizmo drag begins.
 */
export class EditorCamera extends Script implements ScriptCallbacks {
  /** The type id; the host leaves it out of the schemas it reports. */
  static typeId = "ignifx-editor/EditorCamera";

  /** The scene view runs in edit mode, where only these scripts get callbacks. */
  static runInEditMode = true;

  /** The point the camera orbits and looks at. */
  focus = { x: 0, y: 1, z: 0 };

  /** The heading, in degrees; 0 looks along +Z. */
  yaw = 30;

  /** The tilt, in degrees; positive looks down. */
  pitch = 25;

  /** How far the eye is from the focus, in metres. */
  distance = 12;

  /** The gizmo dispatcher, once the view has one. */
  claims: PointerClaims | null = null;

  /** Receives each click on the view. */
  onClick: ((click: ViewClick) => void) | null = null;

  #canvas: HTMLCanvasElement | null = null;

  #gesture: Gesture = "none";

  #pointer = -1;

  #lastX = 0;

  #lastY = 0;

  #downX = 0;

  #downY = 0;

  #moved = false;

  #gizmoTookGesture = false;

  readonly #keys = new Set<string>();

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#pointer !== -1) {
      return;
    }
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#moved = false;
    this.#gizmoTookGesture = false;
    if (event.button === 0) {
      this.#gizmoTookGesture = this.claims?.pointerState().interacting === true;
      this.#gesture = this.#gizmoTookGesture ? "none" : "orbit";
    } else if (event.button === 1) {
      this.#gesture = "pan";
      event.preventDefault();
    } else if (event.button === 2) {
      this.#gesture = "fly";
    } else {
      return;
    }
    this.#pointer = event.pointerId;
    this.#canvas?.setPointerCapture(event.pointerId);
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
    if (this.#gesture === "orbit") {
      const state = this.claims?.pointerState();
      if (state?.dragging === true) {
        this.#gizmoTookGesture = true;
        this.#gesture = "none";
        return;
      }
      if (state?.pickPending !== true) {
        this.yaw += dx * 0.3;
        this.pitch = clamp(this.pitch + dy * 0.3, -MAX_PITCH, MAX_PITCH);
      }
    } else if (this.#gesture === "fly") {
      const eye = this.#eye();
      this.yaw += dx * 0.2;
      this.pitch = clamp(this.pitch + dy * 0.2, -MAX_PITCH, MAX_PITCH);
      const direction = this.#direction();
      this.focus = {
        x: eye.x + direction.x * this.distance,
        y: eye.y + direction.y * this.distance,
        z: eye.z + direction.z * this.distance,
      };
    } else if (this.#gesture === "pan") {
      const scale = (this.distance * 0.0016 * (this.#canvas?.clientHeight ?? 800)) / 800;
      const right = this.#right();
      const up = this.#up();
      this.focus = {
        x: this.focus.x + (-dx * right.x + dy * up.x) * scale,
        y: this.focus.y + (-dx * right.y + dy * up.y) * scale,
        z: this.focus.z + (-dx * right.z + dy * up.z) * scale,
      };
    }
    this.apply();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) {
      return;
    }
    this.#canvas?.releasePointerCapture(event.pointerId);
    this.#pointer = -1;
    this.#gesture = "none";
    this.#keys.clear();
    if (
      event.button === 0 &&
      !this.#moved &&
      !this.#gizmoTookGesture &&
      this.claims?.pointerState().dragging !== true
    ) {
      this.onClick?.({
        x: event.offsetX,
        y: event.offsetY,
        toggle: event.shiftKey || event.ctrlKey || event.metaKey,
      });
    }
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.0015), 0.2, 5000);
    this.apply();
  };

  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    this.#keys.add(event.code);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#keys.delete(event.code);
  };

  /**
   * Starts listening to a canvas's pointer, wheel and key events.
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
    canvas.addEventListener("contextmenu", this.#onContextMenu);
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
    canvas.removeEventListener("contextmenu", this.#onContextMenu);
    canvas.ownerDocument.removeEventListener("keydown", this.#onKeyDown);
    canvas.ownerDocument.removeEventListener("keyup", this.#onKeyUp);
    this.#canvas = null;
  }

  /**
   * Fits a sphere in the view: the focus moves to its centre and the distance fits its radius in
   * the field of view, with a margin.
   *
   * @param target - The sphere.
   */
  frame(target: FrameTarget): void {
    this.focus = { x: target.center.x, y: target.center.y, z: target.center.z };
    this.distance = Math.max(0.5, (Math.max(target.radius, 0.25) / Math.sin(degToRad(EDITOR_CAMERA_FOV / 2))) * 1.2);
    this.apply();
  }

  /**
   * Flies while the right button is held and a movement key is down.
   *
   * @param deltaTime - The frame's unscaled delta, in seconds.
   */
  update(deltaTime: number): void {
    if (this.#gesture !== "fly" || this.#keys.size === 0) {
      return;
    }
    const speed = 5 * (this.#keys.has("ShiftLeft") || this.#keys.has("ShiftRight") ? 4 : 1) * deltaTime;
    const direction = this.#direction();
    const right = this.#right();
    const along = (this.#keys.has("KeyW") ? speed : 0) - (this.#keys.has("KeyS") ? speed : 0);
    const across = (this.#keys.has("KeyD") ? speed : 0) - (this.#keys.has("KeyA") ? speed : 0);
    const rise = (this.#keys.has("KeyE") ? speed : 0) - (this.#keys.has("KeyQ") ? speed : 0);
    this.focus = {
      x: this.focus.x + direction.x * along + right.x * across,
      y: this.focus.y + direction.y * along + right.y * across + rise,
      z: this.focus.z + direction.z * along + right.z * across,
    };
    this.apply();
  }

  /** Places the camera's entity at the eye, looking at the focus. */
  apply(): void {
    const eye = this.#eye();
    this.transform.localPosition.set(eye.x, eye.y, eye.z);
    this.transform.lookAt(this.focus);
  }

  /**
   * The unit view direction; yaw 0 looks along +Z, positive pitch looks down.
   *
   * @returns The direction.
   */
  #direction(): { x: number; y: number; z: number } {
    const yaw = degToRad(this.yaw);
    const pitch = degToRad(this.pitch);
    return { x: Math.cos(pitch) * Math.sin(yaw), y: -Math.sin(pitch), z: Math.cos(pitch) * Math.cos(yaw) };
  }

  /**
   * The view's right vector, level with the ground.
   *
   * @returns The vector.
   */
  #right(): { x: number; y: number; z: number } {
    const yaw = degToRad(this.yaw);
    return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  }

  /**
   * The view's up vector.
   *
   * @returns The vector.
   */
  #up(): { x: number; y: number; z: number } {
    const d = this.#direction();
    const r = this.#right();
    return { x: d.y * r.z - d.z * r.y, y: d.z * r.x - d.x * r.z, z: d.x * r.y - d.y * r.x };
  }

  /**
   * The eye position.
   *
   * @returns The point `distance` behind the focus along the view direction.
   */
  #eye(): { x: number; y: number; z: number } {
    const d = this.#direction();
    return {
      x: this.focus.x - d.x * this.distance,
      y: this.focus.y - d.y * this.distance,
      z: this.focus.z - d.z * this.distance,
    };
  }
}
