import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createPlaneMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { loadTexture, releaseTextureHandle, retainTexture } from "../../../src/lite/gpu/texture.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { assetUrl } from "./fixtures/asset-urls.js";
import { createRenderHarness, framesUntil } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";

/**
 * The texture adapter and Lite's reference-counted texture pool
 * (`docs/architecture/07-rendering.md` §7). The BRDF lookup table doubles as a convenient 256×256
 * RGBA PNG to load; nothing here depends on what it contains.
 */

/** Frames to let the textured plane land. */
const FRAME_BUDGET = 30;

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Builds a lit scene looking at the origin.
 *
 * @returns The running harness.
 */
async function buildScene(): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    beforeRegister: (_engine, scene) => {
      addLightToScene(scene, createHemisphericLightInWorld(2));
      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -3);
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  return harness;
}

describe("loading a texture", () => {
  it("uploads the image and reports its size", async () => {
    const harness = await buildScene();
    const texture = await loadTexture(harness.engine, assetUrl("brdf-lut.png"), { srgb: true });
    expect(texture.width).toBe(256);
    expect(texture.height).toBe(256);
    expect(texture.texture).toBeDefined();
  });

  it("draws through a PBR base-colour slot", async () => {
    const harness = await buildScene();
    const texture = await loadTexture(harness.engine, assetUrl("brdf-lut.png"), { srgb: true });
    const plane = createPlaneMesh(harness.engine, { size: 4 });
    setMeshMaterial(
      plane,
      createPbrMaterialFromProps({ baseColor: [1, 1, 1, 1], baseColorTexture: texture, metallic: 0, roughness: 1 }),
    );
    addMeshToScene(harness.scene, plane);

    const background = harness.scene.clearColor;
    const drawn = await framesUntil(
      harness,
      (frame) => {
        const pixel = createPixelRgba();
        if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
          return false;
        }
        return Math.abs(pixel.b / 255 - background.b) > 0.1;
      },
      FRAME_BUDGET,
    );
    expect(drawn).not.toBeNull();
  });
});

describe("the reference-counted texture pool", () => {
  it("frees a texture that was never retained on the first release", async () => {
    const harness = await buildScene();
    const texture = await loadTexture(harness.engine, assetUrl("brdf-lut.png"));
    expect(releaseTextureHandle(texture)).toBe(true);
  });

  it("keeps a retained texture alive until every share is given back", async () => {
    const harness = await buildScene();
    const texture = await loadTexture(harness.engine, assetUrl("brdf-lut.png"));
    retainTexture(texture);
    retainTexture(texture);

    expect(releaseTextureHandle(texture)).toBe(false);
    expect(releaseTextureHandle(texture)).toBe(false);
    expect(releaseTextureHandle(texture)).toBe(true);
  });
});
