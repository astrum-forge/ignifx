import { describe, expect, it } from "vitest";
import { spriteClipFrameAtTime } from "../../src/animation/clip-time.js";

describe("spriteClipFrameAtTime", () => {
  const looping = { frameCount: 4, fps: 10, loop: true };
  const once = { frameCount: 4, fps: 10, loop: false };

  it("shows frame n from n / fps seconds", () => {
    expect(spriteClipFrameAtTime(looping, 0)).toBe(0);
    expect(spriteClipFrameAtTime(looping, 0.099)).toBe(0);
    expect(spriteClipFrameAtTime(looping, 0.1)).toBe(1);
    expect(spriteClipFrameAtTime(looping, 0.35)).toBe(3);
  });

  it("wraps a looping clip both ways and holds a one-shot clip at its ends", () => {
    expect(spriteClipFrameAtTime(looping, 0.45)).toBe(0);
    expect(spriteClipFrameAtTime(looping, -0.05)).toBe(3);
    expect(spriteClipFrameAtTime(once, 9)).toBe(3);
    expect(spriteClipFrameAtTime(once, -1)).toBe(0);
  });

  it("scales the rate by speed", () => {
    expect(spriteClipFrameAtTime(once, 0.1, 2)).toBe(2);
  });

  it("answers 0 for an empty clip, a stopped rate or a time that is not finite", () => {
    expect(spriteClipFrameAtTime({ frameCount: 0, fps: 10, loop: true }, 1)).toBe(0);
    expect(spriteClipFrameAtTime(looping, 1, 0)).toBe(0);
    expect(spriteClipFrameAtTime(looping, Number.NaN)).toBe(0);
  });
});
