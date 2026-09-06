import { Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import {
  cameraRelativeToRef,
  JumpTimers,
  jumpVelocity,
  projectOnSlopeToRef,
  slopeAngleDegrees,
  turnTowardsDegrees,
  yawFromDirection,
} from "../../src/character/movement.js";

/** World forward in ignifx's left-handed space. */
const FORWARD = { x: 0, y: 0, z: 1 };

describe("cameraRelativeToRef", () => {
  it("sends stick-forward along the camera's forward", () => {
    const out = new Vec3();
    cameraRelativeToRef(0, 1, FORWARD, out);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(1, 6);
  });

  it("sends stick-right along the camera's right, which is up x forward", () => {
    const out = new Vec3();
    cameraRelativeToRef(1, 0, FORWARD, out);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it("rotates with the camera", () => {
    const out = new Vec3();
    // A camera facing world +X: stick-forward should send the character along +X.
    cameraRelativeToRef(0, 1, { x: 1, y: 0, z: 0 }, out);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it("ignores the camera's pitch", () => {
    const steep = new Vec3();
    const flat = new Vec3();
    cameraRelativeToRef(0, 1, { x: 0, y: -0.95, z: 0.31 }, steep);
    cameraRelativeToRef(0, 1, FORWARD, flat);
    expect(steep.x).toBeCloseTo(flat.x, 6);
    expect(steep.y).toBe(0);
    expect(steep.z).toBeCloseTo(flat.z, 6);
  });

  it("normalizes the result and zeroes a centred stick", () => {
    const out = new Vec3();
    cameraRelativeToRef(1, 1, FORWARD, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 6);
    cameraRelativeToRef(0, 0, FORWARD, out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it("falls back to world forward for a camera looking straight down", () => {
    const out = new Vec3();
    cameraRelativeToRef(0, 1, { x: 0, y: -1, z: 0 }, out);
    expect(out.z).toBeCloseTo(1, 6);
  });
});

describe("yawFromDirection", () => {
  it("returns the yaw that faces a direction", () => {
    expect(yawFromDirection(0, 1)).toBeCloseTo(0, 6);
    expect(yawFromDirection(1, 0)).toBeCloseTo(90, 6);
    expect(yawFromDirection(0, -1)).toBeCloseTo(180, 6);
    expect(yawFromDirection(-1, 0)).toBeCloseTo(-90, 6);
  });

  it("returns null for a degenerate direction", () => {
    expect(yawFromDirection(0, 0)).toBeNull();
  });
});

describe("turnTowardsDegrees", () => {
  it("takes the short way round the wrap", () => {
    expect(turnTowardsDegrees(170, -170, 3600, 1 / 60)).toBeGreaterThan(170);
  });

  it("moves at most the rate allows", () => {
    expect(turnTowardsDegrees(0, 90, 60, 0.5)).toBeCloseTo(30, 6);
  });

  it("arrives exactly when the step covers the difference", () => {
    expect(turnTowardsDegrees(0, 10, 3600, 1)).toBeCloseTo(10, 6);
  });

  it("snaps when the rate is zero", () => {
    expect(turnTowardsDegrees(0, 90, 0, 1 / 60)).toBeCloseTo(90, 6);
  });
});

describe("jumpVelocity", () => {
  it("reaches the requested height under the requested gravity", () => {
    const velocity = jumpVelocity(1.25, 20);
    // v squared over 2g is the apex height.
    expect((velocity * velocity) / (2 * 20)).toBeCloseTo(1.25, 6);
  });

  it("is zero for a zero height or a zero gravity", () => {
    expect(jumpVelocity(0, 20)).toBe(0);
    expect(jumpVelocity(-1, 20)).toBe(0);
    expect(jumpVelocity(1, 0)).toBe(0);
  });
});

describe("JumpTimers", () => {
  it("allows a jump one frame after walking off a ledge", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, true, false, 0.12, 0.12);
    // Left the ground; the button comes a frame later.
    timers.step(1 / 60, false, true, 0.12, 0.12);
    expect(timers.consume()).toBe(true);
  });

  it("refuses a jump once coyote time has run out", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, true, false, 0.1, 0.1);
    for (let frame = 0; frame < 10; frame += 1) {
      timers.step(1 / 60, false, false, 0.1, 0.1);
    }
    timers.step(1 / 60, false, true, 0.1, 0.1);
    expect(timers.consume()).toBe(false);
  });

  it("remembers a jump pressed just before landing", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, false, true, 0.12, 0.12);
    expect(timers.consume()).toBe(false);
    timers.step(1 / 60, true, false, 0.12, 0.12);
    expect(timers.consume()).toBe(true);
  });

  it("forgets a buffered jump once the window closes", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, false, true, 0.12, 0.05);
    for (let frame = 0; frame < 6; frame += 1) {
      timers.step(1 / 60, false, false, 0.12, 0.05);
    }
    timers.step(1 / 60, true, false, 0.12, 0.05);
    expect(timers.consume()).toBe(false);
  });

  it("consumes exactly once", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, true, true, 0.12, 0.12);
    expect(timers.consume()).toBe(true);
    expect(timers.consume()).toBe(false);
  });

  it("exposes both remaining windows and resets them", () => {
    const timers = new JumpTimers();
    timers.step(1 / 60, true, true, 0.12, 0.2);
    expect(timers.coyoteRemaining).toBeCloseTo(0.12, 6);
    expect(timers.bufferRemaining).toBeCloseTo(0.2, 6);
    timers.reset();
    expect(timers.coyoteRemaining).toBe(0);
    expect(timers.bufferRemaining).toBe(0);
  });
});

describe("slopes", () => {
  it("projects movement onto a slope", () => {
    const out = new Vec3();
    // A 45-degree slope rising towards +Z.
    const normal = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
    projectOnSlopeToRef({ x: 0, y: 0, z: 1 }, normal, out);
    expect(out.y).toBeGreaterThan(0);
    expect(out.x * normal.x + out.y * normal.y + out.z * normal.z).toBeCloseTo(0, 6);
  });

  it("measures a slope angle", () => {
    expect(slopeAngleDegrees({ x: 0, y: 1, z: 0 })).toBeCloseTo(0, 6);
    expect(slopeAngleDegrees({ x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 })).toBeCloseTo(45, 4);
    expect(slopeAngleDegrees({ x: 0, y: 0, z: 1 })).toBeCloseTo(90, 4);
    expect(slopeAngleDegrees({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});
