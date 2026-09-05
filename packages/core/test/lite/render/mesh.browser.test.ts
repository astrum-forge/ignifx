import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMeshToScene,
  cloneMeshUnderNode,
  createBoxMesh,
  createGroundMesh,
  createMeshFromGeometry,
  createPlaneMesh,
  createSphereMesh,
  disposeMeshTemplate,
  removeMeshFromScene,
  setMeshId,
  setMeshMaterial,
  setMeshPickable,
  setMeshReceiveShadows,
  setMeshRenderOrder,
  setMeshSubtreeVisible,
} from "../../../src/lite/gpu/mesh.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import { createRenderHarness, settleGpu } from "./fixtures/gpu-harness.js";
import { geometryOwnerCount, geometryUpload, isGeometryDisposed } from "./fixtures/lite-internals.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { Mesh } from "@babylonjs/lite";

/**
 * Spike S2.4, the half that does not need a memory profiler: `cloneTransformNode` shares GPU
 * buffers, and a template that never joins a scene keeps them alive however many clones come and
 * go.
 *
 * `performance.measureUserAgentSpecificMemory()` is not available in the test runner, so sharing is
 * proved **structurally**: Lite's clone keeps a reference to the very same `_gpu` wrapper object
 * and bumps its reference count (`lib/scene/transform-node.js`, `cloneMeshNode`). Object identity
 * is a stronger proof than a byte count — it cannot drift with allocator noise.
 *
 * One engine serves the whole file. A WebGPU device is expensive on the CI software adapter, and
 * creating one per test exhausts SwiftShader's adapter.
 */

let harness: RenderHarness;

beforeAll(async () => {
  harness = await createRenderHarness({ size: 32, msaaSamples: 1 });
});

afterAll(() => {
  harness.dispose();
});

describe("primitives", () => {
  it("build every shape the MVP exposes", () => {
    const { engine } = harness;
    expect(createBoxMesh(engine, 1).name).toBe("box");
    expect(createSphereMesh(engine, { segments: 4 }).name).toBe("sphere");
    expect(createPlaneMesh(engine, { size: 1 }).name).toBe("plane");
    expect(createGroundMesh(engine, { width: 2, height: 2 }).name).toBe("ground");
  });

  it("build a mesh from raw vertex data and keep its bounds", () => {
    const mesh = createMeshFromGeometry(
      harness.engine,
      "triangle",
      Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
      Uint32Array.from([0, 1, 2]),
    );
    expect(mesh.boundMin).toEqual([0, 0, 0]);
    expect(mesh.boundMax).toEqual([1, 1, 0]);
  });
});

describe("S2.4 · cloning shares GPU buffers", () => {
  it("gives every clone the identical buffer wrapper the template owns", () => {
    const template = createBoxMesh(harness.engine, 1);
    const first = cloneMeshUnderNode(template, null);
    const second = cloneMeshUnderNode(template, null);

    expect(geometryUpload(first)).toBe(geometryUpload(template));
    expect(geometryUpload(second)).toBe(geometryUpload(template));
    expect(first).not.toBe(second);
  });

  it("counts one owner per clone, so the buffers outlive any one of them", () => {
    const template = createBoxMesh(harness.engine, 1);
    expect(geometryOwnerCount(template)).toBeUndefined();

    cloneMeshUnderNode(template, null);
    expect(geometryOwnerCount(template)).toBe(2);
    cloneMeshUnderNode(template, null);
    expect(geometryOwnerCount(template)).toBe(3);
  });

  it("gives each clone its own transform", () => {
    const template = createBoxMesh(harness.engine, 1);
    const node = createNode("entity");
    const clone = cloneMeshUnderNode(template, node);

    node.position.set(4, 0, 0);
    expect(clone.worldMatrix[12]).toBeCloseTo(4, 5);
    expect(template.worldMatrix[12]).toBeCloseTo(0, 5);
  });
});

describe("template lifetime", () => {
  it("defers a removed mesh's teardown to a GPU drain point rather than doing it on the spot", async () => {
    const template = createBoxMesh(harness.engine, 1);
    const clone = cloneMeshUnderNode(template, null);
    addMeshToScene(harness.scene, clone);
    removeMeshFromScene(harness.scene, clone);

    // Still two owners: `removeFromScene` only queued the teardown
    // (`lib/scene/scene-remove.js`, `retireMeshTeardown`).
    expect(geometryOwnerCount(template)).toBe(2);

    await settleGpu(harness);
    expect(geometryOwnerCount(template)).toBe(1);
  });

  it("keeps the buffers alive after every clone has left the scene", async () => {
    const template = createBoxMesh(harness.engine, 1);
    const clones = Array.from({ length: 3 }, () => cloneMeshUnderNode(template, null));
    for (const clone of clones) {
      addMeshToScene(harness.scene, clone);
    }
    for (const clone of clones) {
      removeMeshFromScene(harness.scene, clone);
    }
    await settleGpu(harness);

    // The count has come back to the template's own share, and the template can still be cloned —
    // which is only true while its buffers exist.
    expect(geometryOwnerCount(template)).toBe(1);
    expect(isGeometryDisposed(template)).toBe(false);
    expect(() => cloneMeshUnderNode(template, null)).not.toThrow();
  });

  it("releases the buffers only through a round trip into a scene", async () => {
    const template = createBoxMesh(harness.engine, 1);
    disposeMeshTemplate(harness.scene, template);
    await settleGpu(harness);

    expect(isGeometryDisposed(template)).toBe(true);
    // Lite refuses to clone a mesh whose buffers went with its last scene.
    expect(() => cloneMeshUnderNode(template, null)).toThrow(/disposed/u);
  });
});

describe("per-mesh flags", () => {
  it("are plain property writes on the Lite mesh", () => {
    const mesh: Mesh = createBoxMesh(harness.engine, 1);
    setMeshMaterial(mesh, createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1] }));
    setMeshReceiveShadows(mesh, true);
    setMeshRenderOrder(mesh, 7);
    setMeshPickable(mesh, false);
    setMeshId(mesh, "hero:body");
    setMeshSubtreeVisible(mesh, false);

    expect(mesh.receiveShadows).toBe(true);
    expect(mesh.renderOrder).toBe(7);
    expect(mesh.pickable).toBe(false);
    expect(mesh.id).toBe("hero:body");
    expect(mesh.visible).toBe(false);
  });
});

describe("the null engine", () => {
  it("cannot build a mesh at all, which is why this whole module is GPU-only", () => {
    const { engine, scene } = createHeadlessScene();
    try {
      expect(() => createBoxMesh(engine, 1)).toThrow();
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
