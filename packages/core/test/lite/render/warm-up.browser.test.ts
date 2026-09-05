import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { discardMaterialWarmUp, warmUpMaterials } from "../../../src/lite/gpu/warm-up.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps, createStandardMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { createRenderHarness, framesUntil } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { CapturedFrame } from "../../../src/lite/screenshot.js";
import type { Material } from "@babylonjs/lite";

/**
 * Spike S2.2: how long a mesh added **after** `registerScene` takes to appear, with and without its
 * material family already built, and what a warm-up therefore has to do.
 *
 * The measurement subtracts a baseline, because `captureScreenshot` is itself served at the end of a
 * later frame (`lib/engine/screenshot.js`): every test first measures how many rendered frames one
 * capture round trip costs on a scene that is already correct, then measures the same thing after
 * the runtime add. The difference is what the material swap cost.
 *
 * The findings are written up in ADR-0002's validation table and ADR-0014.
 */

/** How much red a pixel needs before it counts as "the box". */
const BOX_RED = 100;

/** The frame budget every wait gets. Generous: the point is to measure, not to time out. */
const FRAME_BUDGET = 240;

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Reports whether the centre pixel of a capture shows a red box.
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
 * Builds a registered scene with a camera and a light and nothing else, optionally warming material
 * families up first.
 *
 * @param warmUpWith - Materials whose families must be built before registration.
 * @returns The running harness.
 */
async function emptyScene(warmUpWith: readonly Material[] = []): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    beforeRegister: (engine, scene) => {
      addLightToScene(scene, createHemisphericLightInWorld(1));
      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -5);
      setSceneCamera(scene, camera);
      if (warmUpWith.length > 0) {
        warmUpMaterials(engine, scene, warmUpWith);
      }
    },
  });
  current = harness;
  return harness;
}

/**
 * Adds a red box to a registered scene and measures how many extra rendered frames it took to
 * become visible, over and above one capture round trip.
 *
 * @param harness - The running harness.
 * @param material - The material to draw the box with.
 * @returns The baseline round trip, the total wait, and the difference.
 */
async function measureFramesToVisible(
  harness: RenderHarness,
  material: Material,
): Promise<{ baseline: number; total: number; extra: number }> {
  const baseline = await framesUntil(harness, () => true, FRAME_BUDGET);
  const box = createBoxMesh(harness.engine, 2);
  setMeshMaterial(box, material);
  addMeshToScene(harness.scene, box);

  const total = await framesUntil(harness, showsBox, FRAME_BUDGET);
  if (baseline === null || total === null) {
    throw new Error("the box never appeared inside the frame budget");
  }
  return { baseline, total, extra: Math.max(0, total - baseline) };
}

/** A fresh red PBR material; every one of them shares Lite's single PBR build group. */
function redPbr(): Material {
  return createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1], metallic: 0, roughness: 1 });
}

/** A fresh red Standard material; likewise one build group for the whole family. */
function redStandard(): Material {
  return createStandardMaterialFromProps({ diffuse: [1, 0, 0], specular: [0, 0, 0] });
}

describe("S2.2 · a mesh added after registerScene", () => {
  it("appears within a handful of frames when its family was never built", async () => {
    const harness = await emptyScene();
    const measured = await measureFramesToVisible(harness, redPbr());
    expect(measured.total).toBeLessThan(FRAME_BUDGET);
    expect(measured.extra).toBeLessThanOrEqual(6);
  });

  it("appears no slower once the PBR family has been warmed up", async () => {
    const material = redPbr();
    const harness = await emptyScene([redPbr()]);
    const measured = await measureFramesToVisible(harness, material);
    expect(measured.extra).toBeLessThanOrEqual(2);
  });

  it("appears no slower once the Standard family has been warmed up", async () => {
    const material = redStandard();
    const harness = await emptyScene([redStandard()]);
    const measured = await measureFramesToVisible(harness, material);
    expect(measured.extra).toBeLessThanOrEqual(2);
  });

  it("also works for a Standard material with no warm-up at all", async () => {
    const harness = await emptyScene();
    const measured = await measureFramesToVisible(harness, redStandard());
    expect(measured.total).toBeLessThan(FRAME_BUDGET);
  });
});

describe("S2.2 · what a warm-up installs", () => {
  it("adds one hidden probe per material and nothing else", async () => {
    const harness = await createRenderHarness({ size: 32, msaaSamples: 1 });
    current = harness;
    const before = harness.scene.meshes.length;
    const warmUp = warmUpMaterials(harness.engine, harness.scene, [redPbr(), redStandard()]);

    expect(warmUp.probes).toHaveLength(2);
    expect(harness.scene.meshes).toHaveLength(before + 2);
    for (const probe of warmUp.probes) {
      expect(probe.visible).toBe(false);
      expect(probe.pickable).toBe(false);
    }
  });

  it("can be discarded again", async () => {
    const harness = await createRenderHarness({ size: 32, msaaSamples: 1 });
    current = harness;
    const before = harness.scene.meshes.length;
    const warmUp = warmUpMaterials(harness.engine, harness.scene, [redPbr()]);
    discardMaterialWarmUp(harness.scene, warmUp);
    expect(harness.scene.meshes).toHaveLength(before);
  });
});
