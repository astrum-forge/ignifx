import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/math/vec3.js";
import { TWEEN_SYSTEM_ORDER } from "../../src/tween/tween-system.js";
import { createTestApp } from "../support/app-harness.js";

describe("app.tweens", () => {
  it("advances on the app clock in PostUpdate and respects timeScale", async () => {
    const harness = await createTestApp();
    const target = { value: 0, position: new Vec3(0, 0, 0) };
    harness.app.tweens.to(target, { value: 10 }, { duration: 1 });
    await harness.app.start();

    // Steps stay under `time.maximumDeltaTime` (0.1 s), which clamps the frame delta.
    for (let frame = 0; frame < 5; frame += 1) {
      harness.step(0.1);
    }
    expect(target.value).toBeCloseTo(5, 6);

    harness.app.time.timeScale = 0.5;
    for (let frame = 0; frame < 5; frame += 1) {
      harness.step(0.1);
    }
    expect(target.value).toBeCloseTo(7.5, 6);

    harness.dispose();
  });

  it("freezes while the app is paused unless the tween opted out", async () => {
    const harness = await createTestApp();
    const scaled = { value: 0 };
    const realtime = { value: 0 };
    harness.app.tweens.to(scaled, { value: 10 }, { duration: 1 });
    harness.app.tweens.to(realtime, { value: 10 }, { duration: 1, updateWhenPaused: true });
    await harness.app.start();

    harness.app.pause();
    for (let frame = 0; frame < 5; frame += 1) {
      harness.step(0.1);
    }
    expect(scaled.value).toBe(0);
    expect(realtime.value).toBeCloseTo(5, 6);

    harness.app.resume();
    for (let frame = 0; frame < 5; frame += 1) {
      harness.step(0.1);
    }
    expect(scaled.value).toBeCloseTo(5, 6);
    harness.dispose();
  });

  it("drops every tween when the app is disposed", async () => {
    const harness = await createTestApp();
    harness.app.tweens.to({ value: 0 }, { value: 1 }, { duration: 1 });
    expect(harness.app.tweens.count).toBe(1);
    harness.dispose();
    expect(harness.app.tweens.count).toBe(0);
  });

  it("runs before the toolkits' animation systems", () => {
    expect(TWEEN_SYSTEM_ORDER).toBeLessThan(0);
  });
});
