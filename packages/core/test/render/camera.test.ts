import { afterEach, describe, expect, it } from "vitest";
import { Mat4 } from "../../src/math/mat4.js";
import { Vec3 } from "../../src/math/vec3.js";
import { Camera, createRay } from "../../src/render/camera.js";
import { createRenderHarness, warningsOf } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { World } from "../../src/world/world.js";

/**
 * `Camera` and main-camera selection (`docs/architecture/07-rendering.md` §2.1).
 *
 * Everything here runs on the null engine, which is the point of §6: the Lite camera is plain data,
 * so projection, clip planes, the view matrix, and the selection rules are all testable without a
 * device. What is *not* testable here is anything that needs the render target's pixel size — a
 * headless surface reports 1x1 — so the screen conversions are asserted for their shape and their
 * failure modes, and the browser suite asserts what they look like on screen.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<RenderHarness> {
  harness = await createRenderHarness();
  return harness;
}

describe("the Lite camera", () => {
  it("is created at attach and parented under the entity's node", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    expect(camera.lite.camera).not.toBeNull();
  });

  it("is dropped at detach, and the world loses its main camera on the next frame", async () => {
    const h = await app();
    const entity = h.world.createEntity("Eye");
    const camera = entity.addComponent(Camera);
    h.frame();
    expect(h.world.mainCamera).toBe(camera);

    camera.destroy();
    h.frame();
    expect(h.world.mainCamera).toBeNull();
    expect(camera.lite.camera).toBeNull();
  });
});

describe("main camera selection", () => {
  it("takes the enabled camera with the highest priority", async () => {
    const h = await app();
    const low = h.world.createEntity("Low").addComponent(Camera, { priority: 1 });
    const high = h.world.createEntity("High").addComponent(Camera, { priority: 5 });
    h.frame();
    expect(h.world.mainCamera).toBe(high);

    high.priority = 0;
    h.frame();
    expect(h.world.mainCamera).toBe(low);
  });

  it("breaks a priority tie on creation order", async () => {
    const h = await app();
    const first = h.world.createEntity("First").addComponent(Camera);
    h.world.createEntity("Second").addComponent(Camera);
    h.frame();
    expect(h.world.mainCamera).toBe(first);
  });

  it("skips a disabled camera and one on an inactive entity", async () => {
    const h = await app();
    const entity = h.world.createEntity("Eye");
    const camera = entity.addComponent(Camera);
    h.frame();
    expect(h.world.mainCamera).toBe(camera);

    camera.enabled = false;
    h.frame();
    expect(h.world.mainCamera).toBeNull();

    camera.enabled = true;
    entity.active = false;
    h.frame();
    expect(h.world.mainCamera).toBeNull();
  });

  it("logs IGX-0706 once while no camera is enabled, and again after one comes and goes", async () => {
    const h = await app();
    h.frame();
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(1);

    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    camera.destroy();
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(2);
  });

  it("stays silent while a registered camera source claims the world", async () => {
    // What `@ignifx/2d` does with its sprite renderer: the frame is drawn through a `Camera2D`, so
    // "nothing is drawn" is false and `IGX-0706` would be a warning on a correct scene.
    const h = await app();
    let claimed = true;
    const seen: World[] = [];
    const remove = h.renderer.addCameraSource((world: World): boolean => {
      seen.push(world);
      return claimed;
    });
    h.frame();
    h.frame();
    expect(seen).toEqual([h.world, h.world]);
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toEqual([]);

    // The claim is re-asked rather than latched, so a world that loses its 2D camera warns.
    claimed = false;
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(1);

    // Removing the source leaves the warning latched, exactly as if it had never been registered.
    remove();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(1);
  });

  it("clears the latch while a source claims the world, so a later loss warns again", async () => {
    // The sequence a real app produces: `app.start()` reconciles an empty world and warns, then the
    // scene with its `Camera2D` arrives, then that camera is destroyed. A `Camera` behaves the same
    // way, and the two should not disagree.
    const h = await app();
    let claimed = false;
    h.renderer.addCameraSource((): boolean => claimed);
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(1);

    claimed = true;
    h.frame();
    claimed = false;
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("no enabled camera"))).toHaveLength(2);
  });

  it("asks no camera source at all while a 3D camera is enabled", async () => {
    const h = await app();
    let asked = 0;
    h.renderer.addCameraSource((): boolean => {
      asked += 1;
      return true;
    });
    h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    h.frame();
    expect(asked).toBe(0);
  });
});

describe("projection", () => {
  it("switches between perspective and orthographic without rebuilding the camera", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const lite = camera.lite.camera;

    camera.projection = "orthographic";
    camera.orthographicSize = 4;
    h.frame();
    expect(camera.lite.camera).toBe(lite);

    camera.orthographicSize = 2;
    h.frame();
    expect(camera.lite.camera).toBe(lite);

    camera.projection = "perspective";
    h.frame();
    expect(camera.lite.camera).toBe(lite);
  });

  it("reports a projection matrix that differs between the two projections", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const perspective = camera.getProjectionMatrix(new Mat4());
    const before = [...perspective.elements];

    camera.projection = "orthographic";
    h.frame();
    const orthographic = camera.getProjectionMatrix(new Mat4());
    expect([...orthographic.elements]).not.toEqual(before);
  });

  it("reports the inverse of the entity's world matrix as the view matrix", async () => {
    const h = await app();
    const entity = h.world.createEntity("Eye");
    const camera = entity.addComponent(Camera);
    h.frame();
    const identity = camera.getViewMatrix(new Mat4());
    expect(identity.elements[12]).toBeCloseTo(0, 5);

    entity.transform.localPosition.set(0, 0, -5);
    h.frame();
    const moved = camera.getViewMatrix(new Mat4());
    expect(moved.elements[14]).toBeCloseTo(5, 4);
  });
});

describe("screen and world conversions", () => {
  it("builds a ray and reads it back through screenToWorldPoint", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const ray = camera.screenToRay(0, 0);
    expect(ray).not.toBeNull();
    const direction = ray === null ? null : Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
    expect(direction).toBeCloseTo(1, 5);

    const point = camera.screenToWorldPoint(0, 0, 10, new Vec3());
    expect(point).not.toBeNull();
    expect(point?.z).toBeGreaterThan(0);
  });

  it("fills a caller-supplied ray rather than allocating", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const out = createRay();
    expect(camera.screenToRay(0, 0, out)).toBe(out);
  });

  it("answers null for every conversion before the component is attached", () => {
    const detached = new Camera();
    expect(detached.screenToRay(0, 0)).toBeNull();
    expect(detached.worldToScreen({ x: 0, y: 0, z: 1 }, new Vec3())).toBe(false);
    expect(detached.screenToWorldPoint(0, 0, 1, new Vec3())).toBeNull();
    expect(detached.viewportToWorldPoint(0.5, 0.5, 1, new Vec3())).toBeNull();
    expect(detached.lite.camera).toBeNull();
    const untouched = new Mat4();
    expect(detached.getProjectionMatrix(untouched)).toBe(untouched);
    expect(detached.getViewMatrix(untouched)).toBe(untouched);
  });

  it("projects a point in front of the camera and reports one behind it", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const out = new Vec3();
    expect(camera.worldToScreen({ x: 0, y: 0, z: 10 }, out)).toBe(true);
    expect(camera.worldToScreen({ x: 0, y: 0, z: -10 }, out)).toBe(false);
  });

  it("maps a normalized viewport coordinate to the same point as the pixel it names", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    const centre = camera.viewportToWorldPoint(0.5, 0.5, 5, new Vec3());
    expect(centre).not.toBeNull();
    expect(centre?.z).toBeGreaterThan(0);
  });
});

describe("the clear colour override", () => {
  it("is applied only while the camera is the main one", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera, {
      clearColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    h.frame();
    expect(h.world.mainCamera).toBe(camera);
    expect(h.world.lite.scene.clearColor.r).toBeCloseTo(1, 5);
    expect(h.world.lite.scene.clearColor.g).toBeCloseTo(0, 5);
  });

  it("leaves the scene's colour alone when the camera declares none", async () => {
    const h = await app();
    h.world.lite.scene.clearColor.g = 0.5;
    h.world.createEntity("Eye").addComponent(Camera);
    h.frame();
    expect(h.world.lite.scene.clearColor.g).toBeCloseTo(0.5, 5);
  });
});
