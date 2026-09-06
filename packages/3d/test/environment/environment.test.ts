import { Camera, MeshRenderer, Quat } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { mainCamera, mainCameraForward } from "../../src/camera/main-camera.js";
import { Billboard } from "../../src/environment/billboard.js";
import { LOD_CULLED, LodGroup } from "../../src/environment/lod-group.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * `LodGroup` and `Billboard`, headless (`docs/architecture/12-3d-toolkit.md` §6). Neither needs a
 * GPU: one switches an `enabled` flag by distance and the other writes a rotation.
 */

/**
 * Adds a camera at a position.
 *
 * @param harness - The app harness.
 * @param x - Where to put it on the X axis.
 * @param priority - The camera's priority.
 * @returns The camera's entity.
 */
function addCamera(harness: ThreeDAppHarness, x: number, priority: number = 0): Entity {
  const entity = harness.world.createEntity("Camera", { position: { x, y: 0, z: 0 } });
  entity.addComponent(Camera, { priority });
  return entity;
}

describe("mainCamera", () => {
  it("picks the highest-priority enabled camera", async () => {
    const harness = await createThreeDApp();
    expect(mainCamera(harness.world)).toBeNull();
    expect(mainCameraForward(harness.world)).toEqual({ x: 0, y: 0, z: 1 });

    const low = addCamera(harness, 0, 1);
    const high = addCamera(harness, 5, 10);
    expect(mainCamera(harness.world)?.entity).toBe(high);

    high.getComponent(Camera)?.destroy();
    expect(mainCamera(harness.world)?.entity).toBe(low);
    harness.dispose();
  });
});

describe("LodGroup", () => {
  it("switches level by distance and culls past the last one", async () => {
    const harness = await createThreeDApp();
    const camera = addCamera(harness, 0);
    const tree = harness.world.createEntity("Tree", { position: { x: 5, y: 0, z: 0 } });
    const near = tree.addComponent(MeshRenderer);
    const far = harness.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
    const group = tree.addComponent(LodGroup, {
      levels: [
        { distance: 10, renderer: near },
        { distance: 30, renderer: far },
      ],
      hysteresis: 0,
    });
    const seen: number[] = [];
    group.onLevelChanged.connect((level) => seen.push(level));

    harness.step();
    expect(group.level).toBe(0);
    expect(near.enabled).toBe(true);
    expect(far.enabled).toBe(false);

    tree.transform.position = { x: 20, y: 0, z: 0 };
    harness.step();
    expect(group.level).toBe(1);
    expect(near.enabled).toBe(false);
    expect(far.enabled).toBe(true);

    tree.transform.position = { x: 100, y: 0, z: 0 };
    harness.step();
    expect(group.level).toBe(LOD_CULLED);
    expect(near.enabled).toBe(false);
    expect(far.enabled).toBe(false);
    expect(seen).toEqual([0, 1, LOD_CULLED]);
    expect(camera).toBeDefined();
    harness.dispose();
  });

  it("holds a level past its threshold by the hysteresis fraction", async () => {
    const harness = await createThreeDApp();
    addCamera(harness, 0);
    const tree = harness.world.createEntity("Tree", { position: { x: 5, y: 0, z: 0 } });
    const near = tree.addComponent(MeshRenderer);
    const far = harness.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
    const group = tree.addComponent(LodGroup, {
      levels: [
        { distance: 10, renderer: near },
        { distance: 100, renderer: far },
      ],
      hysteresis: 0.2,
    });
    harness.step();
    expect(group.level).toBe(0);

    // 11 metres is past the 10-metre threshold, but inside the widened 12-metre one.
    tree.transform.position = { x: 11, y: 0, z: 0 };
    harness.step();
    expect(group.level).toBe(0);

    tree.transform.position = { x: 13, y: 0, z: 0 };
    harness.step();
    expect(group.level).toBe(1);
    harness.dispose();
  });

  it("does nothing without a camera and turns everything off when detached", async () => {
    const harness = await createThreeDApp();
    const tree = harness.world.createEntity("Tree");
    const near = tree.addComponent(MeshRenderer);
    const group = tree.addComponent(LodGroup, { levels: [{ distance: 10, renderer: near }] });
    harness.step();
    expect(group.level).toBe(LOD_CULLED);

    addCamera(harness, 0);
    harness.step();
    expect(near.enabled).toBe(true);
    group.destroy();
    harness.step();
    expect(near.enabled).toBe(false);
    harness.dispose();
  });

  it("ignores a level whose renderer is not set", async () => {
    const harness = await createThreeDApp();
    addCamera(harness, 0);
    const tree = harness.world.createEntity("Tree");
    const group = tree.addComponent(LodGroup, { levels: [{ distance: 10, renderer: null }] });
    harness.step();
    expect(group.level).toBe(0);
    harness.dispose();
  });
});

describe("Billboard", () => {
  it("turns to face the camera", async () => {
    const harness = await createThreeDApp();
    addCamera(harness, 0);
    const sign = harness.world.createEntity("Sign", { position: { x: 10, y: 0, z: 0 } });
    sign.addComponent(Billboard);
    harness.step();
    // Facing away from a camera at the origin means facing +X.
    const forward = sign.transform.forward;
    expect(forward.x).toBeCloseTo(1, 4);
    expect(forward.z).toBeCloseTo(0, 4);
    harness.dispose();
  });

  it("stays upright in yAxis mode", async () => {
    const harness = await createThreeDApp();
    const camera = addCamera(harness, 0);
    camera.transform.position = { x: 0, y: 20, z: 0.001 };
    const sign = harness.world.createEntity("Sign", { position: { x: 0, y: 0, z: 10 } });
    sign.addComponent(Billboard, { mode: "yAxis" });
    harness.step();
    expect(sign.transform.forward.y).toBeCloseTo(0, 4);
    expect(sign.transform.up.y).toBeGreaterThan(0.99);
    harness.dispose();
  });

  it("aligns with the view plane when asked", async () => {
    const harness = await createThreeDApp();
    const camera = addCamera(harness, 0);
    camera.transform.rotation = Quat.fromEulerDegrees(0, 30, 0);
    const sign = harness.world.createEntity("Sign", { position: { x: 10, y: 0, z: 10 } });
    sign.addComponent(Billboard, { faceCameraPlane: true });
    harness.step();
    const cameraForward = camera.transform.forward;
    const signForward = sign.transform.forward;
    expect(signForward.x).toBeCloseTo(cameraForward.x, 4);
    expect(signForward.z).toBeCloseTo(cameraForward.z, 4);
    harness.dispose();
  });

  it("leaves a billboard sitting on the camera alone", async () => {
    const harness = await createThreeDApp();
    addCamera(harness, 0);
    const sign = harness.world.createEntity("Sign");
    sign.addComponent(Billboard);
    const before = Quat.from(sign.transform.rotation);
    harness.step();
    expect(Quat.angleDegrees(sign.transform.rotation, before)).toBeCloseTo(0, 4);
    harness.dispose();
  });
});
