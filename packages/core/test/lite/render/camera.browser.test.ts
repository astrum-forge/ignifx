import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  resetCameraViewport,
  resolveViewportPixels,
  screenToRay,
  setCameraClipPlanes,
  setCameraOrthographic,
  setCameraPerspective,
  setCameraViewport,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPickRay } from "../../../src/lite/picking.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { createRenderHarness, framesUntil } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { CapturedFrame } from "../../../src/lite/screenshot.js";
import type { FreeCamera, SceneNode } from "@babylonjs/lite";

/**
 * Spike S2.1, pixel proof: a Lite `FreeCamera` parented under an entity node really does follow the
 * node — moving the node moves what is drawn — and the orthographic toggle and the viewport
 * mapping behave the way `camera.test.ts` predicts numerically.
 *
 * The scene is a red box at the world origin under a white hemispheric light, seen from `z = -5`
 * down `+Z`. Assertions are on the **red channel** rather than an exact colour, so they hold on a
 * software adapter (coding standards §10).
 */

/** How much red a pixel needs before it counts as "the box". */
const BOX_RED = 100;

/** The frame budget every wait in this file gets. */
const FRAME_BUDGET = 30;

/** What the scene under test is made of, so a test can move the pieces. */
interface CameraScene {
  /** The running harness. */
  readonly harness: RenderHarness;
  /** The entity node the camera hangs under. */
  readonly cameraNode: SceneNode;
  /** The camera itself. */
  readonly camera: FreeCamera;
}

let current: CameraScene | null = null;

afterEach(() => {
  current?.harness.dispose();
  current = null;
});

/**
 * Builds a lit red box and a camera parented under a node, all before the scene is registered so
 * the first frame already draws it.
 *
 * @param size - The canvas edge, in pixels.
 * @returns The pieces the tests move.
 */
async function buildScene(size = 64): Promise<CameraScene> {
  const cameraNode = createNode("camera-entity");
  // A one-element slot rather than a `let`: the callback runs inside `createRenderHarness`, which
  // the compiler cannot see, so a `let` would still be narrowed to `null` afterwards.
  const built: FreeCamera[] = [];
  const harness = await createRenderHarness({
    size,
    msaaSamples: 1,
    beforeRegister: (engine, scene) => {
      addLightToScene(scene, createHemisphericLightInWorld(1));
      const box = createBoxMesh(engine, 2);
      setMeshMaterial(box, createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1], metallic: 0, roughness: 1 }));
      addMeshToScene(scene, box);

      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -5);
      setSceneCamera(scene, camera);
      built.push(camera);
    },
  });
  const camera = built[0];
  if (camera === undefined) {
    throw new Error("the camera was not built");
  }
  const scene: CameraScene = { harness, cameraNode, camera };
  current = scene;
  return scene;
}

/**
 * Reports whether a pixel of a capture is the red box rather than the background.
 *
 * @param frame - The capture.
 * @param x - The pixel column.
 * @param y - The pixel row.
 * @returns `true` when the pixel is red enough to be the box.
 */
function isBox(frame: CapturedFrame, x: number, y: number): boolean {
  const pixel = createPixelRgba();
  if (samplePixel(frame, x, y, pixel) === null) {
    return false;
  }
  return pixel.r > BOX_RED && pixel.r > pixel.b * 2;
}

describe("S2.1 · the rendered image follows the camera's parent node", () => {
  it("draws the box in the middle while the parent sits on the axis", async () => {
    const { harness } = await buildScene();
    const frames = await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET);
    expect(frames).not.toBeNull();
  });

  it("moves the box off centre when the parent node moves sideways", async () => {
    const { harness, cameraNode } = await buildScene();
    expect(await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET)).not.toBeNull();

    // Sliding the camera's parent to +X slides the box to the left of the image, because the
    // camera looks down +Z in a left-handed frame.
    cameraNode.position.set(3, 0, -5);

    const moved = await framesUntil(harness, (frame) => !isBox(frame, 32, 32) && isBox(frame, 8, 32), FRAME_BUDGET);
    expect(moved).not.toBeNull();
  });

  it("pushes the box out of frame when the parent node backs away", async () => {
    const { harness, cameraNode } = await buildScene();
    expect(await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET)).not.toBeNull();

    // Behind the box: nothing is in front of the camera any more.
    cameraNode.position.set(0, 0, 40);
    const gone = await framesUntil(harness, (frame) => !isBox(frame, 32, 32), FRAME_BUDGET);
    expect(gone).not.toBeNull();
  });
});

describe("S2.1 · the orthographic toggle", () => {
  it("changes the projection, and the silhouette with it", async () => {
    const { harness, camera } = await buildScene();
    expect(await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET)).not.toBeNull();

    const perspective = await captureFrame(harness.engine);
    const perspectiveEdge = isBox(perspective, 4, 32);

    // A half-height of 1 shows two world units of height across 64 pixels, so a two-unit box fills
    // the frame — far wider than the perspective view of the same box five metres away.
    setCameraOrthographic(camera, 1);
    const filled = await framesUntil(harness, (frame) => isBox(frame, 4, 32), FRAME_BUDGET);

    expect(perspectiveEdge).toBe(false);
    expect(filled).not.toBeNull();
  });
});

describe("S2.1 · viewport mapping", () => {
  it("draws only into the pixel rectangle resolveCameraViewport reports", async () => {
    const { harness, camera } = await buildScene();
    expect(await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET)).not.toBeNull();

    // Normalized y is measured from the bottom, so a band starting at 0.5 is the TOP half.
    setCameraViewport(camera, 0, 0.5, 1, 0.5);
    expect(resolveViewportPixels(camera, 64, 64)).toEqual({ x: 0, y: 0, width: 64, height: 32 });

    const split = await framesUntil(harness, (frame) => isBox(frame, 32, 16) && !isBox(frame, 32, 48), FRAME_BUDGET);
    expect(split).not.toBeNull();

    resetCameraViewport(camera);
  });
});

describe("S2.1 · screen to ray against the rendered image", () => {
  it("aims the centre ray at the box the centre pixel shows", async () => {
    const { harness, camera } = await buildScene();
    expect(await framesUntil(harness, (frame) => isBox(frame, 32, 32), FRAME_BUDGET)).not.toBeNull();

    const viewport = resolveViewportPixels(camera, harness.canvas.width, harness.canvas.height);
    const ray = createPickRay();
    expect(screenToRay(camera, 32, 32, viewport.width, viewport.height, ray)).toBe(ray);

    // The camera sits at z = -5 looking down +Z at a box centred on the origin.
    expect(ray.direction[2]).toBeGreaterThan(0.99);
    expect(ray.origin[2]).toBeGreaterThan(-5.5);
  });
});
