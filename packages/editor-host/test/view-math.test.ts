import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { RpcFailure } from "../src/channel.js";
import { HostCapability, PickUnit, RpcErrorCode, SCREENSHOT_MAX_SIZE } from "../src/protocol/index.js";
import { SceneHost } from "../src/scene/scene-host.js";
import { DragSnapper, readLocalTransform, screenshotSize, toCssPixels } from "../src/scene/view-math.js";
import type { App } from "@ignifx/core";

/**
 * The scene view's arithmetic that needs no GPU: the `pick` unit rule, the `screenshot` size rule,
 * the transforms the drag notifications carry, and gizmo snapping.
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
  it("passes CSS pixels through and converts backing pixels at the canvas's own ratio", () => {
    expect(toCssPixels({ x: 412.5 / 2, y: 115, unit: PickUnit.css }, RETINA)).toEqual({ x: 206.25, y: 115 });
    expect(toCssPixels({ x: 412.5, y: 230, unit: PickUnit.backing }, RETINA)).toEqual({ x: 206.25, y: 115 });
    expect(toCssPixels({ x: 10, y: 10, unit: PickUnit.backing }, { ...RETINA, width: 400, height: 300 })).toEqual({
      x: 10,
      y: 10,
    });
  });

  it("misses a point outside the canvas", () => {
    expect(toCssPixels({ x: -1, y: 10, unit: PickUnit.css }, RETINA)).toBeNull();
    expect(toCssPixels({ x: 400, y: 10, unit: PickUnit.css }, RETINA)).toBeNull();
    expect(toCssPixels({ x: 10, y: 600, unit: PickUnit.backing }, RETINA)).toBeNull();
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
