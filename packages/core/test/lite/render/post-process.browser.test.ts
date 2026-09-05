import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import {
  appendPostProcessTask,
  createBloomTask,
  createChainColorTarget,
  createImageProcessingPass,
  createSmaaTask,
  disposePostProcessTask,
  setPostProcessTaskEnabled,
  surfaceRenderTarget,
} from "../../../src/lite/gpu/post-process.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../../src/lite/screenshot.js";
import { advanceFrames, createRenderHarness } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { ScenePresenter } from "../../../src/lite/gpu/render-path.js";

/**
 * Post-processing on a real device (`docs/architecture/07-rendering.md` §2.7). Three things are
 * being proved, and they are the three Lite makes awkward:
 *
 * 1. **The offscreen render path presents.** With no default render task, ignifx's own scene task
 *    plus its compositing copy have to put the frame on screen by themselves.
 * 2. **A chain reads the offscreen colour, not the swapchain.** The swapchain texture has no
 *    `TEXTURE_BINDING` (`lib/engine/surface.js` 30) and sampling it rejects the whole frame; the
 *    scene colour target has it, because `buildRenderTarget` always asks for it.
 * 3. **Insertion and removal.** `addTask` appends, so an effect runs after the scene; there is no
 *    removal, so `executionEnabled = false` is what "off" means.
 */

/** Frames to let a frame-graph change reach the screen. */
const SETTLE_FRAMES = 4;

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Builds a bright box on a black background, rendered through the offscreen path.
 *
 * @returns The running harness.
 */
async function buildScene(): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    offscreen: true,
    beforeRegister: (engine, scene) => {
      scene.clearColor = { r: 0, g: 0, b: 0, a: 1 };
      addLightToScene(scene, createHemisphericLightInWorld(1));
      const box = createBoxMesh(engine, 3);
      setMeshMaterial(box, createPbrMaterialFromProps({ baseColor: [1, 1, 1, 1], metallic: 0, roughness: 1 }));
      addMeshToScene(scene, box);

      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -4);
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  await advanceFrames(harness, SETTLE_FRAMES);
  return harness;
}

/**
 * The harness's presenter, or a failure that says the harness was not built for this suite.
 *
 * @param harness - The running harness.
 * @returns The presenter.
 */
function presenterOf(harness: RenderHarness): ScenePresenter {
  const presenter = harness.presenter;
  if (presenter === null) {
    throw new Error("the harness was not built with offscreen: true");
  }
  return presenter;
}

/**
 * The luminance of the centre pixel of the next capture.
 *
 * @param harness - The running harness.
 * @returns The luminance, 0 to 255.
 */
async function centreLuminance(harness: RenderHarness): Promise<number> {
  const frame = await captureFrame(harness.engine);
  const pixel = createPixelRgba();
  if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
    throw new Error("the capture was empty");
  }
  return pixelLuminance(pixel);
}

describe("the offscreen render path", () => {
  it("composites the scene onto the swapchain with no default render task", async () => {
    const harness = await buildScene();
    expect(presenterOf(harness).isPresentEnabled).toBe(true);
    // A black frame is exactly what the defect produced, so the assertion is on brightness.
    expect(await centreLuminance(harness)).toBeGreaterThan(60);
  });

  it("presents nothing to the swapchain once the compositing blit is switched off", async () => {
    const harness = await buildScene();
    const presenter = presenterOf(harness);
    const lit = await centreLuminance(harness);

    presenter.setPresentEnabled(false);
    await advanceFrames(harness, SETTLE_FRAMES);
    expect(await centreLuminance(harness)).toBeLessThan(lit / 2);

    presenter.setPresentEnabled(true);
    await advanceFrames(harness, SETTLE_FRAMES);
    expect(await centreLuminance(harness)).toBeGreaterThan(lit / 2);
  });
});

describe("appending an effect to a live scene", () => {
  it("runs it after the scene's own render pass, and stops when it is disabled", async () => {
    const harness = await buildScene();
    const presenter = presenterOf(harness);
    const litScene = await centreLuminance(harness);
    expect(litScene).toBeGreaterThan(60);

    // A link nothing ever draws into: an effect that reads it can only darken the frame, and only
    // if it ran *after* the scene task wrote the swapchain through the compositing blit.
    const empty = createChainColorTarget(harness.engine, "ignifx-test:blank");
    const filler = createBloomTask(harness.engine, harness.scene, presenter.sceneColor, empty, { weight: 0 });
    const smaa = createSmaaTask(harness.engine, harness.scene, empty, surfaceRenderTarget(harness.engine), {});
    try {
      appendPostProcessTask(harness.scene, filler);
      appendPostProcessTask(harness.scene, smaa);
      setPostProcessTaskEnabled(filler, false);
      await advanceFrames(harness, SETTLE_FRAMES);
      const overwritten = await centreLuminance(harness);
      expect(overwritten).toBeLessThan(litScene / 2);

      setPostProcessTaskEnabled(smaa, false);
      await advanceFrames(harness, SETTLE_FRAMES);
      expect(await centreLuminance(harness)).toBeGreaterThan(litScene / 2);
    } finally {
      setPostProcessTaskEnabled(smaa, false);
      setPostProcessTaskEnabled(filler, false);
      disposePostProcessTask(smaa);
      disposePostProcessTask(filler);
    }
  });

  it("keeps the frame on screen when the effect reads the scene colour instead", async () => {
    const harness = await buildScene();
    const presenter = presenterOf(harness);
    const litScene = await centreLuminance(harness);

    const smaa = createSmaaTask(
      harness.engine,
      harness.scene,
      presenter.sceneColor,
      surfaceRenderTarget(harness.engine),
      {},
    );
    try {
      appendPostProcessTask(harness.scene, smaa);
      presenter.setPresentEnabled(false);
      await advanceFrames(harness, SETTLE_FRAMES);
      // The effect, not the blit, is now what puts the frame on the swapchain.
      expect(await centreLuminance(harness)).toBeGreaterThan(litScene / 2);
    } finally {
      setPostProcessTaskEnabled(smaa, false);
      presenter.setPresentEnabled(true);
      disposePostProcessTask(smaa);
    }
  });
});

describe("building each effect the MVP ships", () => {
  it("creates a bloom task from ignifx settings", async () => {
    const harness = await buildScene();
    const source = createChainColorTarget(harness.engine, "ignifx-test:bloom-source");
    const bloom = createBloomTask(harness.engine, harness.scene, source, null, {
      weight: 0.5,
      kernel: 32,
      threshold: 0.8,
      exposure: 1.2,
      scale: 0.5,
    });
    try {
      expect(bloom.name).toBe("ignifx:bloom");
      expect(bloom.threshold).toBe(0.8);
      expect(bloom.weight).toBe(0.5);
      expect(bloom.kernel).toBe(32);
    } finally {
      disposePostProcessTask(bloom);
    }
  });

  it("creates an SMAA task from ignifx settings", async () => {
    const harness = await buildScene();
    const source = createChainColorTarget(harness.engine, "ignifx-test:smaa-source");
    const smaa = createSmaaTask(harness.engine, harness.scene, source, null, {
      threshold: 0.08,
      maxSearchSteps: 8,
      diagonalDetection: true,
      cornerDetection: true,
      sourceIsSrgb: false,
    });
    try {
      expect(smaa.name).toBe("ignifx:smaa");
      expect(smaa.threshold).toBe(0.08);
      expect(smaa.maxSearchSteps).toBe(8);
      expect(smaa.diagonalDetection).toBe(true);
      expect(smaa.cornerDetection).toBe(true);
    } finally {
      disposePostProcessTask(smaa);
    }
  });

  it("creates an image-processing task over the scene colour", async () => {
    const harness = await buildScene();
    const grade = createImageProcessingPass(harness.engine, harness.scene, presenterOf(harness).sceneColor);
    try {
      expect(grade.name).toBe("ignifx:image-processing");
    } finally {
      disposePostProcessTask(grade);
    }
  });
});
