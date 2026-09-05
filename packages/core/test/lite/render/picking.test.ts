import { describe, expect, it } from "vitest";
import { createNode, tagNode } from "../../../src/lite/node.js";
import { createPickRay, raycastMeshes, raycastScene, readPickedTag, setPickRay } from "../../../src/lite/picking.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import type { Mesh, PickingInfo } from "@babylonjs/lite";

/**
 * The CPU picking adapter. Lite's ray pick needs no device — it walks `scene.meshes` and tests the
 * CPU vertex copies — so the miss path and the ray plumbing are checked here; the hit path needs a
 * mesh, and meshes need a device, so it is checked in `picking.browser.test.ts`.
 */

/** Builds a `PickingInfo` that reports a hit on `mesh`, without needing a GPU to produce one. */
function hitOn(mesh: Mesh | null): PickingInfo {
  return {
    hit: mesh !== null,
    distance: 1,
    pickedPoint: null,
    pickedNormal: null,
    pickedNormalWorld: null,
    pickedFaceNormal: null,
    pickedFaceNormalWorld: null,
    pickedMesh: mesh,
    faceId: -1,
    bu: 0,
    bv: 0,
    subMeshId: 0,
    thinInstanceIndex: -1,
    ray: null,
  };
}

describe("the reusable ray", () => {
  it("starts at the origin pointing forward", () => {
    const ray = createPickRay();
    expect(ray.origin).toEqual([0, 0, 0]);
    expect(ray.direction).toEqual([0, 0, 1]);
  });

  it("normalizes the direction it is given", () => {
    const ray = createPickRay();
    setPickRay(ray, 1, 2, 3, 0, 0, 5, 100);

    expect(ray.origin).toEqual([1, 2, 3]);
    expect(ray.direction).toEqual([0, 0, 1]);
    expect(ray.length).toBe(100);
  });

  it("leaves a zero direction at zero rather than producing NaN", () => {
    const ray = createPickRay();
    setPickRay(ray, 0, 0, 0, 0, 0, 0, 10);
    expect(ray.direction).toEqual([0, 0, 0]);
  });

  it("is rewritten in place, so a picking loop allocates nothing", () => {
    const ray = createPickRay();
    const origin = ray.origin;
    const direction = ray.direction;
    setPickRay(ray, 5, 5, 5, 1, 0, 0, 1);
    expect(ray.origin).toBe(origin);
    expect(ray.direction).toBe(direction);
  });
});

describe("CPU ray picking under the null engine", () => {
  it("runs headlessly and reports a miss on an empty scene", () => {
    const { scene } = createHeadlessScene();
    try {
      const info = raycastScene(scene, createPickRay());
      expect(info.hit).toBe(false);
      expect(info.pickedMesh).toBeNull();
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("reports a miss for an empty mesh list", () => {
    expect(raycastMeshes([], createPickRay()).hit).toBe(false);
  });

  it("accepts a predicate without a scene", () => {
    const info = raycastMeshes([], createPickRay(), { skipPickableCheck: true, predicate: () => true });
    expect(info.hit).toBe(false);
  });
});

describe("resolving a hit back to an entity", () => {
  it("returns null when nothing was hit", () => {
    expect(readPickedTag(hitOn(null))).toBeNull();
  });

  it("returns null for a mesh ignifx never tagged", () => {
    expect(readPickedTag(hitOn(createNode("untagged") as unknown as Mesh))).toBeNull();
  });

  it("returns the entity and component that own a tagged mesh", () => {
    const node = createNode("hero");
    tagNode(node, { entity: 12, component: 34 });
    expect(readPickedTag(hitOn(node as unknown as Mesh))).toEqual({ entity: 12, component: 34 });
  });
});
