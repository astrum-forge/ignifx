import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { RpcFailure } from "../src/channel.js";
import { HostCapability, PickUnit, RpcErrorCode, SCREENSHOT_MAX_SIZE } from "../src/protocol/index.js";
import { SceneHost } from "../src/scene/scene-host.js";
import {
  DragSnapper,
  pickRayMembers,
  readLocalTransform,
  screenshotSize,
  toBackingPixels,
} from "../src/scene/view-math.js";
import type { App, Vec3Like } from "@ignifx/core";

/**
 * The scene view's arithmetic that needs no GPU: the `pick` unit rule, the ray and plane point a
 * `pick` answers with, the `screenshot` size rule, the transforms the drag notifications carry, and
 * gizmo snapping.
 */

/** A canvas 400 × 300 CSS pixels at device pixel ratio 2. */
const RETINA = { width: 800, height: 600, clientWidth: 400, clientHeight: 300 };

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

describe("the pick unit rule", () => {
  it("passes backing pixels through and converts CSS pixels at the canvas's own ratio", () => {
    expect(toBackingPixels({ x: 412.5, y: 230, unit: PickUnit.backing }, RETINA)).toEqual({ x: 412.5, y: 230 });
    expect(toBackingPixels({ x: 206.25, y: 115, unit: PickUnit.css }, RETINA)).toEqual({ x: 412.5, y: 230 });
    expect(toBackingPixels({ x: 10, y: 10, unit: PickUnit.css }, { ...RETINA, width: 400, height: 300 })).toEqual({
      x: 10,
      y: 10,
    });
  });

  it("misses a point outside the canvas", () => {
    expect(toBackingPixels({ x: -1, y: 10, unit: PickUnit.css }, RETINA)).toBeNull();
    expect(toBackingPixels({ x: 400, y: 10, unit: PickUnit.css }, RETINA)).toBeNull();
    expect(toBackingPixels({ x: 10, y: 600, unit: PickUnit.backing }, RETINA)).toBeNull();
  });
});

/**
 * A ray from `origin` towards `target`, with a unit direction, as `Camera.screenToRay` builds it.
 *
 * @param origin - Where it starts.
 * @param target - A point it passes through.
 * @returns The ray.
 */
function rayTowards(
  origin: readonly [number, number, number],
  target: readonly [number, number, number],
): { origin: Vec3Like; direction: Vec3Like; length: number } {
  const [dx, dy, dz] = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const length = Math.hypot(dx, dy, dz);
  return {
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    direction: { x: dx / length, y: dy / length, z: dz / length },
    length: 1,
  };
}

describe("the ray a pick answers with", () => {
  it("rounds the ray and puts the plane point where it meets z = 0", () => {
    const members = pickRayMembers(rayTowards([0, 4.95, 9.9], [2.5, 0, -1.5]));
    expect(members).toEqual({
      ray: { origin: [0, 4.95, 9.9], direction: [0.197204, -0.390463, -0.899249] },
      plane: [2.171053, 0.651316, 0],
    });
  });

  it("gives the 2D world point straight down an orthographic camera's axis", () => {
    const members = pickRayMembers(rayTowards([3.5, -1.25, 9.95], [3.5, -1.25, -1]));
    expect(members).toEqual({ ray: { origin: [3.5, -1.25, 9.95], direction: [0, 0, -1] }, plane: [3.5, -1.25, 0] });
    expect(Object.is(members.plane?.[2], 0)).toBe(true);
  });

  it("leaves the plane point out for a ray parallel to z = 0 or one that meets it behind the camera", () => {
    expect(pickRayMembers(rayTowards([0, 2, 5], [1, 2, 5]))).not.toHaveProperty("plane");
    expect(pickRayMembers(rayTowards([0, 2, 5], [0, 1, 6]))).not.toHaveProperty("plane");
    // A ray that starts on the plane meets it at its origin.
    expect(pickRayMembers(rayTowards([0, 2, 0], [0, 1, 1]))).toMatchObject({ plane: [0, 2, 0] });
  });
});

describe("the screenshot size rule", () => {
  it("keeps a requested size, follows the aspect for one side, and fits the view to 2048", () => {
    const view = { width: 2560, height: 1440 };
    expect(screenshotSize({ format: "png", width: 1280, height: 720 }, view)).toEqual({ width: 1280, height: 720 });
    expect(screenshotSize({ format: "png", width: 640 }, view)).toEqual({ width: 640, height: 360 });
    expect(screenshotSize({ format: "jpeg", height: 360 }, view)).toEqual({ width: 640, height: 360 });
    expect(screenshotSize({ format: "png" }, view)).toEqual({ width: SCREENSHOT_MAX_SIZE, height: 1152 });
    expect(screenshotSize({ format: "png" }, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(screenshotSize({ format: "png", height: 2048 }, { width: 4000, height: 1000 })).toEqual({
      width: 2048,
      height: 2048,
    });
  });

  it("refuses a side over 2048 with the protocol's message", async () => {
    const app = await createApp({ headless: true });
    apps.push(app);
    const host = new SceneHost({
      capabilities: [HostCapability.heartbeat, HostCapability.screenshot],
      notify: () => undefined,
    });
    host.prepare(app);
    await host.start(null);
    const screenshot = host.methods.get("screenshot");

    let refusal: unknown = null;
    try {
      await screenshot?.({ width: 4096, height: 720, format: "png" });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(RpcFailure);
    expect(refusal).toMatchObject({
      code: RpcErrorCode.invalidParams,
      message: "screenshot takes a width and height from 1 to 2048 pixels.",
    });
    host.dispose();
  });
});

describe("drag transforms and snapping", () => {
  it("reads the local transform with the engine's numbers", async () => {
    const app = await createApp({ headless: true });
    apps.push(app);
    const entity = app.world.createEntity("E");
    entity.transform.localPosition.set(1.0000004, -0, 2);
    expect(readLocalTransform(entity)).toEqual({ position: [1, 0, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    expect(Object.is(readLocalTransform(entity).position[1], -0)).toBe(false);
  });

  it("snaps translation and scale to their steps from where the drag started", async () => {
    const app = await createApp({ headless: true });
    apps.push(app);
    const entity = app.world.createEntity("E");
    entity.transform.localPosition.set(0.1, 0, 0);
    const snap = { translate: 0.5, rotate: 0, scale: 0.25 };
    const move = new DragSnapper("translate", snap, entity);

    entity.transform.localPosition.set(0.3, 0, 0);
    move.apply(entity);
    expect(entity.transform.localPosition.x).toBeCloseTo(0.1);
    entity.transform.localPosition.set(0.4, 0, 0);
    move.apply(entity);
    expect(entity.transform.localPosition.x).toBeCloseTo(0.6);

    const grow = new DragSnapper("scale", snap, entity);
    entity.transform.localScale.set(1.3, 1, 1);
    grow.apply(entity);
    expect(entity.transform.localScale.x).toBeCloseTo(1.25);
  });

  it("snaps a rotation to whole steps about the dragged ring's axis", async () => {
    const app = await createApp({ headless: true });
    apps.push(app);
    const entity = app.world.createEntity("E");
    const turn = new DragSnapper("rotate", { translate: 0, rotate: 15, scale: 0 }, entity);
    const half = (20 * Math.PI) / 360;
    entity.transform.localRotation.set(0, Math.sin(half), 0, Math.cos(half));
    turn.apply(entity);
    const rotation = entity.transform.localRotation;
    expect((2 * Math.atan2(rotation.y, rotation.w) * 180) / Math.PI).toBeCloseTo(15);
    expect(rotation.x).toBeCloseTo(0);
    expect(rotation.z).toBeCloseTo(0);
  });
});
