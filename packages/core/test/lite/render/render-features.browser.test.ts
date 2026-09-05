import { enableMaterialStencil } from "@babylonjs/lite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import {
  enableGpuTiming,
  isGpuTimingAvailable,
  readRenderTaskGpuTimings,
  resizeToCanvas,
  setSurfaceSizePx,
  waitForGpuWork,
} from "../../../src/lite/gpu/render-diagnostics-gpu.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { disableGpuTiming, readDrawCallCount, readGpuFrameTimeMs } from "../../../src/lite/render-diagnostics.js";
import { applyRenderingFeatures, NO_RENDERING_FEATURES } from "../../../src/lite/render-features.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { advanceFrames, createRenderHarness, framesUntil } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { CapturedFrame } from "../../../src/lite/screenshot.js";

/**
 * Spike S2.3, feature-ordering half, plus the render diagnostics that need a device.
 *
 * The ordering finding is a **negative** one and is the reason ignifx polices the rule itself:
 * calling a feature opt-in after `registerScene` neither throws nor takes effect. Lite installs the
 * hook and says nothing; pipelines that were already compiled keep the behaviour they were compiled
 * with. There is no signal for a component to react to, so `assertRenderingFeatureAvailable`
 * (`IGX-0704`) is the only place the mistake can be caught.
 */

/** Frames to let the first draw land. */
const WARM_FRAMES = 6;

/** How much red a pixel needs before it counts as "the box". */
const BOX_RED = 100;

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Reports whether the centre pixel shows the red box.
 *
 * @param frame - The capture.
 * @returns `true` when the box is drawn.
 */
function showsBox(frame: CapturedFrame): boolean {
  const pixel = createPixelRgba();
  if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
    return false;
  }
  return pixel.r > BOX_RED && pixel.r > pixel.b * 2;
}

/**
 * Builds a red box scene, applying every device-free feature opt-in before registration.
 *
 * @param features - Which opt-ins to apply.
 * @returns The running harness.
 */
async function buildScene(features = NO_RENDERING_FEATURES): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    beforeRegister: async (engine, scene) => {
      await applyRenderingFeatures(engine, scene, features);
      addLightToScene(scene, createHemisphericLightInWorld(1));
      const box = createBoxMesh(engine, 2);
      setMeshMaterial(box, createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1], metallic: 0, roughness: 1 }));
      addMeshToScene(scene, box);

      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -5);
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  await advanceFrames(harness, WARM_FRAMES);
  return harness;
}

describe("S2.3 · applying the feature opt-ins on a real device", () => {
  it("registers and renders with every device-free opt-in switched on", async () => {
    const harness = await buildScene({
      shadows: false,
      postProcessing: false,
      skeletons: true,
      boneControl: true,
      stencil: true,
      lightmaps: true,
      materialPlugins: true,
      asyncPipelines: true,
      deviceLostRecovery: false,
    });
    expect(await framesUntil(harness, showsBox, 30)).not.toBeNull();
  }, 30_000);

  it("accepts a late opt-in silently, which is why ignifx refuses one itself", async () => {
    const harness = await buildScene();
    expect(await framesUntil(harness, showsBox, 30)).not.toBeNull();

    // No throw, no warning, no effect on what has already been compiled.
    expect(() => {
      enableMaterialStencil();
    }).not.toThrow();

    await advanceFrames(harness, WARM_FRAMES);
    expect(await framesUntil(harness, showsBox, 30)).not.toBeNull();
  });
});

describe("render diagnostics on a real device", () => {
  it("counts draw calls after a rendered frame", async () => {
    const harness = await buildScene();
    expect(readDrawCallCount(harness.engine)).toBeGreaterThanOrEqual(1);
  });

  it("reports GPU timing as unsupported on the CI software adapter", async () => {
    const harness = await buildScene();
    const supported = isGpuTimingAvailable(harness.engine);

    enableGpuTiming(harness.engine);
    await harness.nextFrame();
    const timings = readRenderTaskGpuTimings(harness.engine);

    // SwiftShader has no `timestamp-query`, so coding standards §10 says the numbers are skipped in
    // CI — but the calls must still be safe, and the snapshot must say why it is empty.
    expect(timings.supported).toBe(supported);
    if (!supported) {
      expect(timings.status).toBe("unsupported");
      expect(timings.tasks).toEqual([]);
      expect(readGpuFrameTimeMs(harness.engine)).toBe(0);
    }

    disableGpuTiming(harness.engine);
    expect(readGpuFrameTimeMs(harness.engine)).toBe(0);
  });

  it("resizes the swapchain explicitly, and a laid-out canvas takes it straight back", async () => {
    const harness = await buildScene();
    setSurfaceSizePx(harness.engine, 64, 32);
    expect(harness.canvas.width).toBe(64);
    expect(harness.canvas.height).toBe(32);

    // Lite re-reads a DOM canvas's CSS size at the start of every frame (`lib/engine/engine.js`,
    // `startEngine` calls `resizeEngine`), so an explicit size on a laid-out canvas survives exactly
    // until the next frame. `setSurfaceSize` is for an `OffscreenCanvas`, which has no layout box
    // and which `resizeSurface` therefore skips.
    await harness.nextFrame();
    await harness.nextFrame();
    expect(harness.canvas.width).toBe(48);
    expect(harness.canvas.height).toBe(48);
  });

  it("re-reads the canvas size without throwing", async () => {
    const harness = await buildScene();
    expect(() => {
      resizeToCanvas(harness.engine);
    }).not.toThrow();
  });

  it("waits for the GPU queue to drain", async () => {
    const harness = await buildScene();
    await expect(waitForGpuWork(harness.engine)).resolves.toBeUndefined();
  });
});
