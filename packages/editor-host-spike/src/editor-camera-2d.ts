// THROWAWAY spike S0.2 — not for merge. The 2D scene-view camera: an ignifx Script next to a
// `Camera2D` at a very high priority, driven by DOM pointer events.
//
//   middle drag, or Space + left drag   pan
//   wheel                               zoom in pixels-per-unit steps, about the cursor
//   left click                          pick (reported through `onClick`)
//
// Zoom is expressed as screen pixels per source pixel (`Camera2D.zoom`), stepped through a ladder of
// whole numbers and unit fractions so every step is pixel-exact; it is applied by writing
// `orthographicSize = viewportHeightPx / (2 · zoom · PPU)` (camera-2d.ts `resolve`, the inverse of
// `zoomForSize`). The grid and the selection rectangle are drawn on a DOM 2D canvas over the WebGPU
// canvas (see mode-2d.ts for why not Lite lines).
import { Camera2D } from "@ignifx/2d";
import { Script, Vec2 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

export const ZOOM_LADDER: readonly number[] = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export class EditorCamera2D extends Script implements ScriptCallbacks {
  static typeId = "editor/EditorCamera2D";
  /** See EditorCamera.runInEditMode. */
  static runInEditMode = true;

  zoomIndex = 6; // 4 screen px per source px
  pixelsPerUnit = 100;
  onClick: ((x: number, y: number) => void) | null = null;
  pans = 0;
  zooms = 0;

  #canvas: HTMLCanvasElement | null = null;
  #pointer = -1;
  #lastX = 0;
  #lastY = 0;
  #downX = 0;
  #downY = 0;
  #moved = false;
  #space = false;
  #panning = false;

  get zoom(): number {
    return ZOOM_LADDER[this.zoomIndex] ?? 1;
  }

  /** Screen (backing) pixels per world unit at the current step. */
  get screenPixelsPerUnit(): number {
    return this.zoom * this.pixelsPerUnit;
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#pointer !== -1) return;
    this.#panning = event.button === 1 || (event.button === 0 && this.#space);
    if (!this.#panning && event.button !== 0) return;
    if (event.button === 1) event.preventDefault();
    this.#pointer = event.pointerId;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    this.#moved = false;
    this.#canvas?.setPointerCapture(event.pointerId);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) return;
    const dpr = window.devicePixelRatio;
    const dx = (event.clientX - this.#lastX) * dpr;
    const dy = (event.clientY - this.#lastY) * dpr;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    if (Math.hypot(event.offsetX - this.#downX, event.offsetY - this.#downY) > 4) this.#moved = true;
    if (!this.#panning) return;
    // World is +Y up, screen is +Y down.
    const p = this.transform.localPosition;
    p.set(p.x - dx / this.screenPixelsPerUnit, p.y + dy / this.screenPixelsPerUnit, p.z);
    this.pans += 1;
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) return;
    this.#canvas?.releasePointerCapture(event.pointerId);
    this.#pointer = -1;
    if (!this.#panning && !this.#moved && event.button === 0) {
      this.onClick?.(event.offsetX, event.offsetY);
    }
    this.#panning = false;
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = this.entity.getComponent(Camera2D);
    if (camera === null) return;
    const dpr = window.devicePixelRatio;
    const sx = event.offsetX * dpr;
    const sy = event.offsetY * dpr;
    const before = camera.screenToWorld(sx, sy, new Vec2());
    const next = Math.min(ZOOM_LADDER.length - 1, Math.max(0, this.zoomIndex + (event.deltaY < 0 ? 1 : -1)));
    if (next === this.zoomIndex) return;
    // Keep the world point under the cursor fixed: after the step, that point must sit at (sx, sy).
    const view = camera.viewportSizePx;
    const nextScale = (ZOOM_LADDER[next] ?? 1) * this.pixelsPerUnit;
    const p = this.transform.localPosition;
    p.set(before.x - (sx - view.x / 2) / nextScale, before.y + (sy - view.y / 2) / nextScale, p.z);
    this.zoomIndex = next;
    this.zooms += 1;
  };

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.#space = event.type === "keydown";
  };

  bind(canvas: HTMLCanvasElement, pixelsPerUnit: number): void {
    this.#canvas = canvas;
    this.pixelsPerUnit = pixelsPerUnit;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener("keyup", this.#onKey);
  }

  onDestroy(): void {
    const canvas = this.#canvas;
    if (canvas === null) return;
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerup", this.#onPointerUp);
    canvas.removeEventListener("pointercancel", this.#onPointerUp);
    canvas.removeEventListener("wheel", this.#onWheel);
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener("keyup", this.#onKey);
  }

  update(): void {
    const camera = this.entity.getComponent(Camera2D);
    if (camera === null) return;
    const viewHeight = camera.viewportSizePx.y;
    if (viewHeight > 0) {
      camera.orthographicSize = viewHeight / (2 * this.zoom * this.pixelsPerUnit);
    }
  }
}
