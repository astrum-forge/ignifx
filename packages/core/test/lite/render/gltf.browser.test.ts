import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import {
  addContainerToScene,
  instantiateContainer,
  loadGltfFromBytes,
  loadGltfFromUrl,
  removeContainerFromScene,
  takeAnimationGroups,
} from "../../../src/lite/gpu/gltf.js";
import { addMeshToScene, removeMeshFromScene } from "../../../src/lite/gpu/mesh.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { assetUrl } from "./fixtures/asset-urls.js";
import { createRenderHarness, framesUntil } from "./fixtures/gpu-harness.js";
import { geometryUpload } from "./fixtures/lite-internals.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { AssetContainer, SceneNode } from "@babylonjs/lite";

/**
 * Spike S2.4, glTF half: the Khronos `Box.glb` sample loads, instantiates, and renders, and two
 * instances of it share one upload of the geometry.
 *
 * `Box.glb` is 1.6 KB and its material is a plain red metallic-roughness PBR material, which makes
 * it a good "is anything drawn" probe as well as a container-shape probe.
 */

/** Frames to let the model reach the screen. */
const FRAME_BUDGET = 30;

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Collects every node in a subtree that carries GPU geometry.
 *
 * @param node - The subtree root.
 * @param out - The list to fill.
 */
function collectMeshes(node: SceneNode, out: SceneNode[]): void {
  if ("_gpu" in node) {
    out.push(node);
  }
  for (const child of node.children) {
    collectMeshes(child, out);
  }
}

/**
 * Builds a lit scene looking at the origin from `z = -5`.
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
      cameraNode.position.set(0, 0, -5);
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  return harness;
}

/**
 * Fetches `Box.glb` and hands it to Lite as bytes, the way the asset layer will.
 *
 * @param harness - The running harness.
 * @returns The loaded container.
 */
async function loadBox(harness: RenderHarness): Promise<AssetContainer> {
  const response = await fetch(assetUrl("Box.glb"));
  expect(response.ok).toBe(true);
  return loadGltfFromBytes(harness.engine, await response.arrayBuffer());
}

/**
 * Reports whether anything other than the background is drawn at the centre of a capture.
 *
 * @param harness - The running harness.
 * @returns A predicate for {@link framesUntil}.
 */
function centreIsNotBackground(
  harness: RenderHarness,
): (frame: Parameters<Parameters<typeof framesUntil>[1]>[0]) => boolean {
  const background = harness.scene.clearColor;
  return (frame) => {
    const pixel = createPixelRgba();
    if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
      return false;
    }
    return Math.abs(pixel.r / 255 - background.r) > 0.1 || Math.abs(pixel.g / 255 - background.g) > 0.1;
  };
}

describe("loading Box.glb", () => {
  it("returns a container with one transform-node root and no animation clips", async () => {
    const harness = await buildScene();
    const container = await loadBox(harness);

    expect(container.entities).toHaveLength(1);
    expect(takeAnimationGroups(container)).toEqual([]);
  });

  it("loads the same file from a URL when the asset layer is not in the way", async () => {
    const harness = await buildScene();
    const container = await loadGltfFromUrl(harness.engine, assetUrl("Box.glb"));
    expect(container.entities).toHaveLength(1);
  });

  it("renders once the container is added to the scene", async () => {
    const harness = await buildScene();
    const container = await loadBox(harness);
    takeAnimationGroups(container);
    addContainerToScene(harness.scene, container);

    expect(await framesUntil(harness, centreIsNotBackground(harness), FRAME_BUDGET)).not.toBeNull();
    removeContainerFromScene(harness.scene, container);
  });
});

describe("S2.4 · instancing a loaded model", () => {
  it("gives two instances the same geometry upload", async () => {
    const harness = await buildScene();
    const container = await loadBox(harness);
    takeAnimationGroups(container);

    const first = instantiateContainer(container, createNode("a"));
    const second = instantiateContainer(container, createNode("b"));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const firstMeshes: SceneNode[] = [];
    const secondMeshes: SceneNode[] = [];
    collectMeshes(first?.root ?? createNode("empty"), firstMeshes);
    collectMeshes(second?.root ?? createNode("empty"), secondMeshes);

    expect(firstMeshes.length).toBeGreaterThan(0);
    expect(secondMeshes).toHaveLength(firstMeshes.length);
    for (let i = 0; i < firstMeshes.length; i++) {
      const a = firstMeshes[i];
      const b = secondMeshes[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a === undefined ? null : geometryUpload(a)).toBe(b === undefined ? null : geometryUpload(b));
    }
  });

  it("renders an instance rather than the container itself", async () => {
    const harness = await buildScene();
    const container = await loadBox(harness);
    takeAnimationGroups(container);

    const node = createNode("model-entity");
    const instance = instantiateContainer(container, node);
    expect(instance).not.toBeNull();
    if (instance === null) {
      return;
    }
    addMeshToScene(harness.scene, instance.root);

    expect(await framesUntil(harness, centreIsNotBackground(harness), FRAME_BUDGET)).not.toBeNull();
    removeMeshFromScene(harness.scene, instance.root);
  });

  it("names the clone's nodes after the glTF nodes", async () => {
    const harness = await buildScene();
    const container = await loadBox(harness);
    const instance = instantiateContainer(container, null);
    expect(instance?.nodesByName.size).toBeGreaterThan(0);
    for (const name of instance?.nodesByName.keys() ?? []) {
      expect(name.endsWith("_clone")).toBe(false);
    }
  });
});
