import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import {
  FOG_MODES,
  loadSceneEnvironment,
  setSceneClearColor,
  setSceneEnvironmentBlur,
  setSceneEnvironmentRotation,
  setSceneFog,
  setSceneImageProcessingOptions,
  TONE_MAPPING_NAMES,
} from "../../../src/lite/gpu/environment.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../../src/lite/screenshot.js";
import { assetUrl } from "./fixtures/asset-urls.js";
import { advanceFrames, createRenderHarness } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { EnvironmentTextures } from "@babylonjs/lite";

/**
 * The environment adapter against the real sample assets in `tests/fixtures/assets/`: the studio
 * `.env` and the BRDF lookup table Lite requires alongside it.
 *
 * The proof that image based lighting is actually working is that a metal box, which has no diffuse
 * response at all, is *visible*: without an environment it reflects nothing and renders as black.
 */

/** Frames to let the first draw land. */
const WARM_FRAMES = 6;

let current: RenderHarness | null = null;
let loaded: EnvironmentTextures | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
  loaded = null;
});

/**
 * Builds a scene with a mirror-like metal box, optionally lit by the studio environment.
 *
 * @param withEnvironment - Whether to load `studio.env`.
 * @returns The running harness.
 */
async function buildScene(withEnvironment: boolean): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    beforeRegister: async (engine, scene) => {
      setSceneClearColor(scene, 0, 0, 0, 1);
      if (withEnvironment) {
        loaded = await loadSceneEnvironment(scene, {
          url: assetUrl("studio.env"),
          brdfUrl: assetUrl("brdf-lut.png"),
          skipSkybox: true,
          skipGround: true,
        });
      }
      const box = createBoxMesh(engine, 2);
      setMeshMaterial(box, createPbrMaterialFromProps({ baseColor: [1, 1, 1, 1], metallic: 1, roughness: 0.15 }));
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

describe("image based lighting from a .env file", () => {
  it("uploads the cube map, the BRDF table, and the spherical harmonics", async () => {
    await buildScene(true);
    expect(loaded).not.toBeNull();
    expect(loaded?.specularCube).toBeDefined();
    expect(loaded?.brdfLut).toBeDefined();
    expect(loaded?.sphericalHarmonics.length).toBe(36);
  });

  it("lights a metal box that has nothing else to reflect", async () => {
    const withEnvironment = await buildScene(true);
    const lit = await centreLuminance(withEnvironment);
    withEnvironment.dispose();
    current = null;

    const withoutEnvironment = await buildScene(false);
    const unlit = await centreLuminance(withoutEnvironment);

    expect(unlit).toBeLessThan(8);
    expect(lit).toBeGreaterThan(unlit + 10);
  });

  it("rotates and blurs the environment without an error", async () => {
    const harness = await buildScene(true);
    setSceneEnvironmentRotation(harness.scene, 90);
    setSceneEnvironmentBlur(harness.scene, 0.5);
    await harness.nextFrame();
    await harness.nextFrame();
    expect(await centreLuminance(harness)).toBeGreaterThan(0);
  });
});

describe("scene background and fog", () => {
  it("writes the clear colour in place", async () => {
    const harness = await buildScene(false);
    setSceneClearColor(harness.scene, 0.1, 0.2, 0.3, 1);
    expect(harness.scene.clearColor).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it("creates, updates, and clears the fog block", async () => {
    const harness = await buildScene(false);
    setSceneFog(harness.scene, "linear", 0.5, 0.5, 0.5, 0.01, 10, 50);
    expect(harness.scene.fog).toEqual({
      mode: FOG_MODES.linear,
      density: 0.01,
      start: 10,
      end: 50,
      color: [0.5, 0.5, 0.5],
    });

    const existing = harness.scene.fog;
    setSceneFog(harness.scene, "exp2", 1, 0, 0, 0.02, 1, 2);
    expect(harness.scene.fog).toBe(existing);
    expect(harness.scene.fog?.mode).toBe(FOG_MODES.exp2);

    setSceneFog(harness.scene, "none", 0, 0, 0, 0, 0, 0);
    expect(harness.scene.fog).toBeNull();
  });
});

describe("image processing", () => {
  it("applies every tone-mapping curve, recompiling the PBR pipelines each time", async () => {
    const harness = await buildScene(true);
    // Sequential on purpose: each curve recompiles the scene's PBR pipelines, and the next
    // assertion only means anything once the previous rebuild has finished.
    await TONE_MAPPING_NAMES.reduce<Promise<void>>(
      (chain, curve) =>
        chain.then(async () => {
          await setSceneImageProcessingOptions(harness.scene, 1.2, 1.1, curve);
          expect(harness.scene.imageProcessing.exposure).toBe(1.2);
          expect(harness.scene.imageProcessing.contrast).toBe(1.1);
          expect(harness.scene.imageProcessing.toneMappingEnabled).toBe(curve !== "none");
        }),
      Promise.resolve(),
    );
  }, 30_000);
});
