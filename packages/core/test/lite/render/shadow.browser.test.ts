import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import {
  addMeshToScene,
  createBoxMesh,
  createGroundMesh,
  setMeshMaterial,
  setMeshReceiveShadows,
} from "../../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { createShadowGeneratorForLight } from "../../../src/lite/gpu/shadow-generator.js";
import { addLightToScene, createDirectionalLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../../src/lite/screenshot.js";
import { attachShadowGenerator, rebuildRenderables, setShadowCasters } from "../../../src/lite/shadow.js";
import { advanceFrames, createRenderHarness } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { CapturedFrame } from "../../../src/lite/screenshot.js";
import type { DirectionalLight, Mesh } from "@babylonjs/lite";

/**
 * Spike S2.3, shadow half: a scene registered through `registerSceneWithShadowSupport` really does
 * grow a shadow pass, and attaching a PCF generator to a directional light darkens the ground where
 * the caster blocks the light.
 *
 * The assertion is **differential and position-independent**: the same scene is captured before and
 * after the generator is attached, and the test counts how many pixels got materially darker. That
 * survives a software adapter's rounding, needs no guess about where the shadow lands, and cannot
 * pass by accident — nothing else in the scene changes between the two captures.
 */

/** How much darker a pixel has to get before it counts as newly shadowed, as a fraction. */
const SHADOW_DROP = 0.2;

/** How much brighter a pixel may get without the test calling it a regression. */
const BRIGHTEN_TOLERANCE = 0.05;

/** The frame budget for a rebuild to reach the screen. */
const SETTLE_FRAMES = 8;

/** The pieces a shadow test manipulates. */
interface ShadowScene {
  /** The running harness. */
  readonly harness: RenderHarness;
  /** The light that will cast. */
  readonly light: DirectionalLight;
  /** The box that will block it. */
  readonly caster: Mesh;
}

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Builds a white ground under a white box, lit by one slanted directional light, seen from above.
 *
 * @returns The pieces the test manipulates.
 */
async function buildShadowScene(): Promise<ShadowScene> {
  // One-element slots rather than `let`s: the callback runs inside `createRenderHarness`, which the
  // compiler cannot see, so a `let` would still be narrowed to `null` afterwards.
  const builtLight: DirectionalLight[] = [];
  const builtCaster: Mesh[] = [];
  const harness = await createRenderHarness({
    size: 64,
    msaaSamples: 1,
    shadows: true,
    beforeRegister: (engine, scene) => {
      const white = createPbrMaterialFromProps({ baseColor: [1, 1, 1, 1], metallic: 0, roughness: 1 });

      const ground = createGroundMesh(engine, { width: 12, height: 12 });
      ground.position.set(0, -1.5, 0);
      setMeshMaterial(ground, white);
      setMeshReceiveShadows(ground, true);
      addMeshToScene(scene, ground);

      const box = createBoxMesh(engine, 1.4);
      setMeshMaterial(box, white);
      addMeshToScene(scene, box);
      builtCaster.push(box);

      // Slanted so the shadow lands beside the box rather than under it, where the box itself would
      // hide it from a camera looking straight down.
      const sun = createDirectionalLightInWorld(3);
      sun.direction.set(0.5, -1, 0.25);
      sun.position.set(-4, 8, -2);
      addLightToScene(scene, sun);
      builtLight.push(sun);

      // Straight down at the ground.
      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.5, 100);
      cameraNode.position.set(0, 8, 0);
      const half = Math.PI / 4;
      cameraNode.rotationQuaternion.set(Math.sin(half), 0, 0, Math.cos(half));
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  const light = builtLight[0];
  const caster = builtCaster[0];
  if (light === undefined || caster === undefined) {
    throw new Error("the shadow scene was not built");
  }
  return { harness, light, caster };
}

/**
 * Counts how many pixels of `after` are materially darker or brighter than the same pixel of
 * `before`.
 *
 * @param before - The earlier capture.
 * @param after - The later capture.
 * @returns The two counts.
 */
function compareLuminance(before: CapturedFrame, after: CapturedFrame): { darker: number; brighter: number } {
  const a = createPixelRgba();
  const b = createPixelRgba();
  let darker = 0;
  let brighter = 0;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      if (samplePixel(before, x, y, a) === null || samplePixel(after, x, y, b) === null) {
        continue;
      }
      const start = pixelLuminance(a);
      const end = pixelLuminance(b);
      if (start < 1) {
        continue;
      }
      if (end < start * (1 - SHADOW_DROP)) {
        darker += 1;
      } else if (end > start * (1 + BRIGHTEN_TOLERANCE)) {
        brighter += 1;
      }
    }
  }
  return { darker, brighter };
}

/**
 * Waits a few frames so a rebuild reaches the screen, then captures.
 *
 * @param harness - The running harness.
 * @returns The capture.
 */
async function settleAndCapture(harness: RenderHarness): Promise<CapturedFrame> {
  await advanceFrames(harness, SETTLE_FRAMES);
  return captureFrame(harness.engine);
}

describe("S2.3 · PCF directional shadows", () => {
  it("darkens the ground once a generator is attached, and nothing gets brighter", async () => {
    const { harness, light, caster } = await buildShadowScene();
    const unshadowed = await settleAndCapture(harness);

    const generator = createShadowGeneratorForLight(harness.engine, light, { technique: "pcf", mapSize: 512 });
    attachShadowGenerator(light, generator);
    setShadowCasters(generator, [caster]);
    await rebuildRenderables(harness.scene);

    const shadowed = await settleAndCapture(harness);
    const { darker, brighter } = compareLuminance(unshadowed, shadowed);

    expect(darker).toBeGreaterThan(20);
    expect(brighter).toBe(0);
  });

  it("builds a generator for each technique without a device error", async () => {
    const { harness, light } = await buildShadowScene();
    for (const technique of ["esm", "pcf", "csm"] as const) {
      expect(createShadowGeneratorForLight(harness.engine, light, { technique, mapSize: 256 })).toBeDefined();
    }
  });
});
