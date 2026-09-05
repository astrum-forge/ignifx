import { createScenePicker, pickScenePixel, pickScenePixelWhere } from "../../lite/gpu/picker.js";
import {
  enableGpuTiming,
  readRenderTaskGpuTimings,
  readSurfaceSizePx,
  resizeToCanvas,
  setSurfaceMaxDevicePixelRatio,
} from "../../lite/gpu/render-diagnostics-gpu.js";
import { warmUpMaterials } from "../../lite/gpu/warm-up.js";
import type { LiteGpuPicker } from "../../lite/gpu/picker.js";
import type { MaterialWarmUp } from "../../lite/gpu/warm-up.js";
import type { NodeTag } from "../../lite/node.js";
import type { LitePickInfo } from "../../lite/picking.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { MaterialAsset } from "../material-asset.js";
import type { RenderTaskTiming, RenderTaskTimings } from "../renderer.js";

/**
 * The device-only half of `app.renderer` (`docs/architecture/07-rendering.md` §1, §3, §5).
 *
 * Everything here fails or answers nothing under the null engine — a picker needs a device and a
 * rendered frame, a warm-up probe needs vertex buffers, GPU timing needs `timestamp-query`, and a
 * surface's backing store needs a canvas — so it lives under `src/render/gpu/`, which the root
 * Vitest coverage config excludes for the same reason it excludes `src/lite/gpu/`. `RendererImpl`
 * keeps every headless guard, and the browser project measures these lines.
 */

/**
 * Creates the app's one GPU picker.
 *
 * @param scene - The scene to pick in.
 * @returns The picker.
 *
 * @internal
 */
export function createPicker(scene: LiteScene): LiteGpuPicker {
  return createScenePicker(scene);
}

/**
 * Picks the object under one CSS pixel, optionally restricted to the meshes a predicate accepts.
 *
 * @param picker - The app's picker.
 * @param x - The CSS pixel x, from the canvas's left edge.
 * @param y - The CSS pixel y, from the canvas's top edge.
 * @param accept - The tag predicate, or `null` to consider every mesh.
 * @returns Lite's picking info.
 *
 * @internal
 */
export function pickPixel(
  picker: LiteGpuPicker,
  x: number,
  y: number,
  accept: ((tag: NodeTag | null) => boolean) | null,
): Promise<LitePickInfo> {
  return accept === null ? pickScenePixel(picker, x, y) : pickScenePixelWhere(picker, x, y, accept);
}

/**
 * Installs one hidden probe per material so their families are compiled at `registerScene`
 * (ADR-0014).
 *
 * @param engine - The engine that owns the probe geometry.
 * @param scene - The scene to warm up.
 * @param materials - The materials whose families must be compiled.
 * @returns The installed probes.
 *
 * @internal
 */
export function warmUpMaterialAssets(
  engine: LiteEngine,
  scene: LiteScene,
  materials: readonly MaterialAsset[],
): MaterialWarmUp {
  const lite = [];
  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    if (material !== undefined) {
      lite.push(material.lite.material);
    }
  }
  return warmUpMaterials(engine, scene, lite);
}

/**
 * Writes the effective device pixel ratio clamp onto the surface and resizes it.
 *
 * @param engine - The engine, which is its own primary surface.
 * @param maxDevicePixelRatio - The clamp to apply.
 *
 * @internal
 */
export function applySurfaceScale(engine: LiteEngine, maxDevicePixelRatio: number): void {
  setSurfaceMaxDevicePixelRatio(engine, maxDevicePixelRatio);
  resizeToCanvas(engine);
}

/**
 * Reads the render target's current size in device pixels, without allocating.
 *
 * @param engine - The engine, which is its own primary surface.
 * @param out - Receives the size.
 *
 * @param out.width - Receives the width, in device pixels.
 * @param out.height - Receives the height, in device pixels.
 * @internal
 */
export function readTargetSizePx(engine: LiteEngine, out: { width: number; height: number }): void {
  readSurfaceSizePx(engine, out);
}

/**
 * Turns whole-frame GPU timing on.
 *
 * @param engine - The engine to measure.
 *
 * @internal
 */
export function startGpuTiming(engine: LiteEngine): void {
  enableGpuTiming(engine);
}

/**
 * Reads the latest per-task GPU timing snapshot, in ignifx's own shape.
 *
 * @param engine - The engine to read.
 * @returns The snapshot.
 *
 * @internal
 */
export function readTaskTimings(engine: LiteEngine): RenderTaskTimings {
  const snapshot = readRenderTaskGpuTimings(engine);
  const tasks: RenderTaskTiming[] = [];
  const measured = snapshot.tasks;
  for (let index = 0; index < measured.length; index += 1) {
    const task = measured[index];
    if (task !== undefined) {
      tasks.push({ name: task.name, durationMs: task.durationMs });
    }
  }
  return { status: snapshot.status, tasks };
}
