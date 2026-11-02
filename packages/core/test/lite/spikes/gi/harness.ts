// Throwaway GI Phase 1 spike harness (S1–S4). Not for merge; see docs/plan/2026-11-gi-phase-1-execution-plan.md.
import {
  addToScene,
  createDefaultCamera,
  createEngine,
  createHemisphericLight,
  createPbrMaterial,
  createSceneContext,
  createSphere,
  renderFrame,
} from "@babylonjs/lite";
import type { EngineContext, Mesh, PbrMaterialProps, SceneContext, Texture2D } from "@babylonjs/lite";

export interface SpikeScene {
  readonly canvas: HTMLCanvasElement;
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly sphere: Mesh;
  readonly material: PbrMaterialProps;
  dispose(): void;
}

/** A 64×64 canvas, a white rough sphere and a hemispheric light of `intensity` (default 8, so lit pixels exceed 1.0 linear). */
export async function createSpikeScene(size = 64, intensity = 8): Promise<SpikeScene> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  document.body.append(canvas);
  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine, { defaultRenderTask: false });
  const sphere = createSphere(engine, { diameter: 2, segments: 16 });
  const material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  sphere.material = material;
  addToScene(scene, sphere);
  addToScene(scene, createHemisphericLight([0, 1, 0], intensity));
  createDefaultCamera(scene);
  return {
    canvas,
    engine,
    scene,
    sphere,
    material,
    dispose: (): void => {
      canvas.remove();
    },
  };
}

export function device(engine: EngineContext): GPUDevice {
  return (engine as unknown as { _device: GPUDevice })._device;
}

export async function frames(engine: EngineContext, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    renderFrame(engine, 16);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await device(engine).queue.onSubmittedWorkDone();
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) !== 0 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f === 0 ? s * Infinity : Number.NaN;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Reads one texel of an rgba16float / rgba8unorm / r32float / bgra8unorm texture as floats. */
export async function readTexel(engine: EngineContext, texture: GPUTexture, x: number, y: number): Promise<number[]> {
  const dev = device(engine);
  const buffer = dev.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = dev.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture, origin: { x, y } }, { buffer, bytesPerRow: 256 }, { width: 1, height: 1 });
  dev.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const bytes = buffer.getMappedRange().slice(0);
  buffer.unmap();
  buffer.destroy();
  switch (texture.format) {
    case "rgba16float": {
      const halves = new Uint16Array(bytes, 0, 4);
      return [...halves].map(halfToFloat);
    }
    case "r32float":
      return [new Float32Array(bytes, 0, 1)[0] ?? Number.NaN];
    case "rgba32float":
      return [...new Float32Array(bytes, 0, 4)];
    case "depth32float":
      return [new Float32Array(bytes, 0, 1)[0] ?? Number.NaN];
    default:
      return [...new Uint8Array(bytes, 0, 4)].map((v) => v / 255);
  }
}

export type { Texture2D };
