// THROWAWAY spike S0.2 — not for merge. The 3D scene-view camera: an ordinary ignifx Script on an
// entity carrying an ignifx `Camera` at a very high priority, driven by DOM pointer events on the
// canvas (the examples/gltf-viewer/src/orbit-camera.ts pattern), NOT Lite's attachControl.
//
//   left drag    orbit around the focus point          (yields to a gizmo, see below)
//   right drag   fly: mouse-look, WASD/QE move, Shift faster
//   middle drag  pan
//   wheel        dolly toward the focus
//   F            frame the selection
//   left click   pick (reported through `onClick`)
//
// Gizmo arbitration. Lite's gizmo dispatcher listens on the same canvas in the CAPTURE phase and only
// for button 0 (pointer-drag.js installDispatcher). Its pointer-down sets `pickPending = true`
// synchronously and then awaits a GPU pick of the utility layer, so the gizmo is known only a frame or
// more later. This camera listens in the bubble phase, so on a left press it can already read the
// dispatcher's state. The rule, the same one Lite's own attachControl options describe
// (index.d.ts 838-856):
//   1. pointer-down while a gizmo is hovered (`interacting`)  -> do not start an orbit at all;
//   2. pointer-move while the press's pick is pending          -> consume the move, apply nothing;
//   3. pointer-move once a gizmo drag is active (`dragging`)   -> abort the orbit for this gesture.
import { clamp, degToRad, Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

export interface GizmoClaims {
  pointerState(): { readonly interacting: boolean; readonly dragging: boolean; readonly pickPending: boolean };
}

export interface FocusTarget {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

export interface EditorCameraStats {
  orbitStarts: number;
  orbitMovesApplied: number;
  orbitMovesDeferred: number;
  orbitAbortedByGizmo: number;
  orbitRefusedOnHover: number;
  clicks: number;
}

const MAX_PITCH = 89;
const CLICK_SLOP_PX = 4;

type Gesture = "none" | "orbit" | "fly" | "pan";

export class EditorCamera extends Script implements ScriptCallbacks {
  static typeId = "editor/EditorCamera";
  /** E1 will need this, or the camera never receives `update` in edit mode (S0.7 §3.2). Inert today. */
  static runInEditMode = true;

  focus = { x: 0, y: 0.8, z: 0 };
  yaw = 20;
  pitch = 18;
  distance = 7;
  orbitSpeed = 0.3;
  lookSpeed = 0.2;
  flySpeed = 5;

  claims: GizmoClaims | null = null;
  focusTarget: (() => FocusTarget | null) | null = null;
  onClick: ((x: number, y: number) => void) | null = null;
  readonly stats: EditorCameraStats = {
    orbitStarts: 0,
    orbitMovesApplied: 0,
    orbitMovesDeferred: 0,
    orbitAbortedByGizmo: 0,
    orbitRefusedOnHover: 0,
    clicks: 0,
  };

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
    if (this.#pointer !== -1) return;
    const button = event.button;
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#moved = false;
    this.#gizmoTookGesture = false;
    if (button === 0) {
      const state = this.claims?.pointerState();
      if (state?.interacting === true) {
        // Rule 1: the press is on a hovered gizmo handle; it owns the gesture.
        this.stats.orbitRefusedOnHover += 1;
        this.#gizmoTookGesture = true;
        this.#gesture = "none";
      } else {
        this.#gesture = "orbit";
        this.stats.orbitStarts += 1;
      }
    } else if (button === 2) {
      this.#gesture = "fly";
    } else if (button === 1) {
      this.#gesture = "pan";
      event.preventDefault();
    } else {
      return;
    }
    this.#pointer = event.pointerId;
    this.#canvas?.setPointerCapture(event.pointerId);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) return;
    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    if (Math.hypot(event.offsetX - this.#downX, event.offsetY - this.#downY) > CLICK_SLOP_PX) this.#moved = true;
    if (this.#gesture === "orbit") {
      const state = this.claims?.pointerState();
      if (state?.dragging === true) {
        // Rule 3: a gizmo drag was recognised after the async pick; hand the gesture over.
        this.stats.orbitAbortedByGizmo += 1;
        this.#gizmoTookGesture = true;
        this.#gesture = "none";
        return;
      }
      if (state?.pickPending === true) {
        // Rule 2: the press might still turn out to be on a gizmo; do not apply anything yet.
        this.stats.orbitMovesDeferred += 1;
        return;
      }
      this.yaw += dx * this.orbitSpeed;
      this.pitch = clamp(this.pitch + dy * this.orbitSpeed, -MAX_PITCH, MAX_PITCH);
      this.stats.orbitMovesApplied += 1;
      return;
    }
    if (this.#gesture === "fly") {
      // Mouse-look around the eye: keep the eye fixed and move the focus with the view direction.
      const eye = this.#eye();
      this.yaw += dx * this.lookSpeed;
      this.pitch = clamp(this.pitch + dy * this.lookSpeed, -MAX_PITCH, MAX_PITCH);
      const dir = this.#direction();
      this.focus = { x: eye.x + dir.x * this.distance, y: eye.y + dir.y * this.distance, z: eye.z + dir.z * this.distance };
      return;
    }
    if (this.#gesture === "pan") {
      const scale = (this.distance * 0.0016 * (this.#canvas?.clientHeight ?? 800)) / 800;
      const right = this.#right();
      const up = this.#up();
      this.focus = {
        x: this.focus.x + (-dx * right.x + dy * up.x) * scale,
        y: this.focus.y + (-dx * right.y + dy * up.y) * scale,
        z: this.focus.z + (-dx * right.z + dy * up.z) * scale,
      };
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) return;
    const wasLeft = event.button === 0;
    this.#canvas?.releasePointerCapture(event.pointerId);
    this.#pointer = -1;
    this.#gesture = "none";
    this.#keys.clear();
    if (wasLeft && !this.#moved && !this.#gizmoTookGesture && this.claims?.pointerState().dragging !== true) {
      this.stats.clicks += 1;
      this.onClick?.(event.offsetX, event.offsetY);
    }
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.0015), 0.2, 500);
  };

  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyF" && this.#gesture !== "fly") {
      this.frameSelection();
      return;
    }
    this.#keys.add(event.code);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#keys.delete(event.code);
  };

  bind(canvas: HTMLCanvasElement): void {
    this.#canvas = canvas;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.#onContextMenu);
    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
  }

  onDestroy(): void {
    const canvas = this.#canvas;
    if (canvas === null) return;
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerup", this.#onPointerUp);
    canvas.removeEventListener("pointercancel", this.#onPointerUp);
    canvas.removeEventListener("wheel", this.#onWheel);
    canvas.removeEventListener("contextmenu", this.#onContextMenu);
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
  }

  frameSelection(): void {
    const target = this.focusTarget?.();
    if (target === null || target === undefined) return;
    this.focus = { x: target.center.x, y: target.center.y, z: target.center.z };
    // Fit a sphere of the target's radius in a 50-degree vertical field of view, with a margin.
    this.distance = Math.max(0.5, (target.radius / Math.sin(degToRad(25))) * 1.2);
  }

  update(dt: number): void {
    if (this.#gesture === "fly" && this.#keys.size > 0) {
      const speed = this.flySpeed * (this.#keys.has("ShiftLeft") || this.#keys.has("ShiftRight") ? 4 : 1) * dt;
      const dir = this.#direction();
      const right = this.#right();
      let mx = 0;
      let my = 0;
      let mz = 0;
      const add = (v: { x: number; y: number; z: number }, s: number): void => {
        mx += v.x * s;
        my += v.y * s;
        mz += v.z * s;
      };
      if (this.#keys.has("KeyW")) add(dir, speed);
      if (this.#keys.has("KeyS")) add(dir, -speed);
      if (this.#keys.has("KeyD")) add(right, speed);
      if (this.#keys.has("KeyA")) add(right, -speed);
      if (this.#keys.has("KeyE")) my += speed;
      if (this.#keys.has("KeyQ")) my -= speed;
      this.focus = { x: this.focus.x + mx, y: this.focus.y + my, z: this.focus.z + mz };
    }
    const eye = this.#eye();
    this.transform.localPosition.set(eye.x, eye.y, eye.z);
    this.transform.lookAt(this.focus);
  }

  /** Unit view direction; yaw 0 looks along +Z, positive pitch looks down. */
  #direction(): { x: number; y: number; z: number } {
    const yaw = degToRad(this.yaw);
    const pitch = degToRad(this.pitch);
    return { x: Math.cos(pitch) * Math.sin(yaw), y: -Math.sin(pitch), z: Math.cos(pitch) * Math.cos(yaw) };
  }

  #right(): { x: number; y: number; z: number } {
    const yaw = degToRad(this.yaw);
    return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  }

  #up(): { x: number; y: number; z: number } {
    const d = this.#direction();
    const r = this.#right();
    return { x: d.y * r.z - d.z * r.y, y: d.z * r.x - d.x * r.z, z: d.x * r.y - d.y * r.x };
  }

  #eye(): { x: number; y: number; z: number } {
    const d = this.#direction();
    return { x: this.focus.x - d.x * this.distance, y: this.focus.y - d.y * this.distance, z: this.focus.z - d.z * this.distance };
  }
}
