import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial, setMeshPickable } from "../../../src/lite/gpu/mesh.js";
import {
  createScenePicker,
  disposeScenePicker,
  enableScenePickerDetail,
  pickScenePixel,
} from "../../../src/lite/gpu/picker.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode, tagNode } from "../../../src/lite/node.js";
import { createPickRay, raycastMeshes, raycastScene, readPickedTag, setPickRay } from "../../../src/lite/picking.js";
import { readDrawCallCount } from "../../../src/lite/render-diagnostics.js";
import { advanceFrames, createRenderHarness } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { Mesh } from "@babylonjs/lite";

/**
 * Picking on a real device (`docs/architecture/07-rendering.md` §3 and §5): the GPU picker resolves
 * the centre pixel to the box that is drawn there, the CPU ray test agrees with it, both resolve
 * back to the ignifx entity through the node tag, and one drawn box costs at least one draw call.
 */

/** The entity handle the box's node is tagged with. */
const BOX_ENTITY = 42;

/** The frame budget for the first drawn frame. */
const WARM_FRAMES = 6;

/** What a picking test needs to reach. */
interface PickScene {
  /** The running harness. */
  readonly harness: RenderHarness;
  /** The box under the centre pixel. */
  readonly box: Mesh;
}

let current: RenderHarness | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
});

/**
 * Builds one tagged, pickable box filling the middle of a 64-pixel canvas.
 *
 * @returns The harness and the box.
 */
async function buildPickScene(): Promise<PickScene> {
  // A one-element slot rather than a `let`: the callback runs inside `createRenderHarness`, which
  // the compiler cannot see, so a `let` would still be narrowed to `null` afterwards.
  const built: Mesh[] = [];
  const harness = await createRenderHarness({
    size: 64,
    msaaSamples: 1,
    beforeRegister: (engine, scene) => {
      addLightToScene(scene, createHemisphericLightInWorld(1));
      const mesh = createBoxMesh(engine, 2);
      setMeshMaterial(mesh, createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1], metallic: 0, roughness: 1 }));
      tagNode(mesh, { entity: BOX_ENTITY });
      addMeshToScene(scene, mesh);
      built.push(mesh);

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
  const box = built[0];
  if (box === undefined) {
    throw new Error("the pick scene was not built");
  }
  return { harness, box };
}

describe("GPU picking", () => {
  it("resolves the centre pixel to the box drawn there, and back to its entity", async () => {
    const { harness, box } = await buildPickScene();
    const picker = createScenePicker(harness.scene);
    try {
      const hit = await pickScenePixel(picker, 32, 32);
      expect(hit.hit).toBe(true);
      expect(hit.pickedMesh).toBe(box);
      expect(readPickedTag(hit)).toEqual({ entity: BOX_ENTITY });
    } finally {
      disposeScenePicker(picker);
    }
  });

  it("misses a corner where nothing is drawn", async () => {
    const { harness } = await buildPickScene();
    const picker = createScenePicker(harness.scene);
    try {
      expect((await pickScenePixel(picker, 1, 1)).hit).toBe(false);
    } finally {
      disposeScenePicker(picker);
    }
  });

  it("skips a mesh the adapter marked unpickable", async () => {
    const { harness, box } = await buildPickScene();
    setMeshPickable(box, false);
    const picker = createScenePicker(harness.scene);
    try {
      expect((await pickScenePixel(picker, 32, 32)).hit).toBe(false);
    } finally {
      disposeScenePicker(picker);
    }
  });

  it("honours a mesh filter", async () => {
    const { harness } = await buildPickScene();
    const picker = createScenePicker(harness.scene);
    try {
      expect((await pickScenePixel(picker, 32, 32, { filter: () => false })).hit).toBe(false);
    } finally {
      disposeScenePicker(picker);
    }
  });

  it("serialises overlapping picks on one picker rather than racing", async () => {
    const { harness, box } = await buildPickScene();
    const picker = createScenePicker(harness.scene);
    try {
      const hits = await Promise.all([
        pickScenePixel(picker, 32, 32),
        pickScenePixel(picker, 32, 32),
        pickScenePixel(picker, 32, 32),
      ]);
      for (const hit of hits) {
        expect(hit.pickedMesh).toBe(box);
      }
    } finally {
      disposeScenePicker(picker);
    }
  });

  it("reports a surface point once detailed picking is on", async () => {
    const { harness } = await buildPickScene();
    const picker = createScenePicker(harness.scene);
    try {
      enableScenePickerDetail(picker);
      const hit = await pickScenePixel(picker, 32, 32);
      expect(hit.hit).toBe(true);
      expect(hit.pickedPoint).not.toBeNull();
      // `faceId` stays at -1 on the CI software adapter even with detailed picking on, so the
      // component layer must not depend on it. `pickedPoint` is the field that is reliable here.
      expect(hit.faceId).toBeTypeOf("number");
    } finally {
      disposeScenePicker(picker);
    }
  });
});

describe("CPU ray picking against real geometry", () => {
  it("hits the box the GPU picker hits", async () => {
    const { harness, box } = await buildPickScene();
    const ray = createPickRay();
    setPickRay(ray, 0, 0, -5, 0, 0, 1, 100);

    const hit = raycastScene(harness.scene, ray);
    expect(hit.hit).toBe(true);
    expect(hit.pickedMesh).toBe(box);
    expect(hit.distance).toBeCloseTo(4, 1);
    expect(readPickedTag(hit)).toEqual({ entity: BOX_ENTITY });
  });

  it("hits the same box through an explicit mesh list", async () => {
    const { box } = await buildPickScene();
    const ray = createPickRay();
    setPickRay(ray, 0, 0, -5, 0, 0, 1, 100);
    expect(raycastMeshes([box], ray).pickedMesh).toBe(box);
  });

  it("misses when the ray points away", async () => {
    const { harness } = await buildPickScene();
    const ray = createPickRay();
    setPickRay(ray, 0, 0, -5, 0, 1, 0, 100);
    expect(raycastScene(harness.scene, ray).hit).toBe(false);
  });
});

describe("draw call counting", () => {
  it("reports at least one draw call once a box has been rendered", async () => {
    const { harness } = await buildPickScene();
    expect(readDrawCallCount(harness.engine)).toBeGreaterThanOrEqual(1);
  });
});
