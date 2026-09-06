import { describe, expect, it, vi } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import { TweensImpl, tweensInternals } from "../../src/tween/tweens.js";
import type { Tweens } from "../../src/tween/tweens.js";

/** An easing name the table does not declare, as a JavaScript caller could pass. */
const BAD_EASE = "nope" as "linear";

/** Advances a list by `count` frames of `dt`, never paused. */
function run(tweens: TweensImpl, count: number, dt: number): void {
  for (let index = 0; index < count; index += 1) {
    tweens.advance(dt, dt, false);
  }
}

/** A target with one of every tweenable shape. */
class Target {
  value = 0;
  position = new Vec3(0, 0, 0);
  rotation = new Quat(0, 0, 0, 1);
  uv = { x: 0, y: 0 };
}

describe("Tweens.to", () => {
  it("interpolates a number linearly and completes exactly once", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const onComplete = vi.fn();
    const tween = tweens.to(target, { value: 10 }, { duration: 1, onComplete });
    expect(tweens.count).toBe(1);

    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(5, 6);
    expect(tween.progress).toBeCloseTo(0.5, 6);
    expect(onComplete).not.toHaveBeenCalled();

    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(10, 6);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(tween.isDone).toBe(true);
    expect(tweens.count).toBe(0);

    run(tweens, 5, 0.1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("emits onComplete on the signal as well as the callback", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const seen: unknown[] = [];
    const tween = tweens.to(target, { value: 1 }, { duration: 0.5 });
    tween.onComplete.connect((finished) => seen.push(finished));
    run(tweens, 5, 0.2);
    expect(seen).toEqual([tween]);
  });

  it("applies the easing curve", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 100 }, { duration: 1, ease: "quadIn" });
    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(25, 6);
  });

  it("accepts a custom curve", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 1 }, { duration: 1, ease: (t): number => (t < 1 ? 0 : 1) });
    run(tweens, 5, 0.1);
    expect(target.value).toBe(0);
    run(tweens, 5, 0.1);
    expect(target.value).toBe(1);
  });

  it("waits out the delay and latches the start value only then", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 10 }, { duration: 1, delay: 0.5 });
    run(tweens, 4, 0.1);
    expect(target.value).toBe(0);
    // A value written during the delay becomes the tween's start value.
    target.value = 100;
    run(tweens, 1, 0.1);
    expect(target.value).toBeCloseTo(100, 6);
    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(55, 6);
  });

  it("moves a Vec3 component-wise in place", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const before = target.position;
    tweens.to(target, { position: { x: 2, y: 4, z: -6 } }, { duration: 1 });
    run(tweens, 5, 0.1);
    expect(target.position).toBe(before);
    expect(target.position.x).toBeCloseTo(1, 6);
    expect(target.position.y).toBeCloseTo(2, 6);
    expect(target.position.z).toBeCloseTo(-3, 6);
  });

  it("moves a Vec2-shaped value component-wise", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { uv: { x: 1, y: 1 } }, { duration: 1 });
    run(tweens, 5, 0.1);
    expect(target.uv).toEqual({ x: 0.5, y: 0.5 });
  });

  it("slerps a Quat along the shortest arc", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const end = Quat.fromEulerDegrees(0, 90, 0);
    tweens.to(target, { rotation: end }, { duration: 1 });
    run(tweens, 5, 0.1);
    const halfway = Quat.fromEulerDegrees(0, 45, 0);
    expect(Quat.angleDegrees(target.rotation, halfway)).toBeLessThan(1e-4);
    run(tweens, 5, 0.1);
    expect(Quat.angleDegrees(target.rotation, end)).toBeLessThan(1e-4);
  });

  it("takes the shortest arc when the dot product is negative", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    // The same rotation, expressed with a negated quaternion: the long way round is 360 degrees.
    const end = Quat.fromEulerDegrees(0, 90, 0);
    const negated = new Quat(-end.x, -end.y, -end.z, -end.w);
    tweens.to(target, { rotation: negated }, { duration: 1 });
    run(tweens, 5, 0.1);
    expect(Quat.angleDegrees(target.rotation, Quat.fromEulerDegrees(0, 45, 0))).toBeLessThan(1e-4);
  });

  it("writes through a setter when the property has one", () => {
    const writes: number[] = [];
    const target = {
      stored: 0,
      get proxied(): number {
        return this.stored;
      },
      set proxied(next: number) {
        this.stored = next;
        writes.push(next);
      },
    };
    const tweens = new TweensImpl();
    tweens.to(target, { proxied: 4 }, { duration: 1 });
    run(tweens, 4, 0.25);
    expect(writes.at(-1)).toBeCloseTo(4, 6);
  });

  it("mutates a getter-only vector in place without assigning", () => {
    const live = new Vec3(0, 0, 0);
    const target = {
      get readOnlyVector(): Vec3 {
        return live;
      },
    };
    const tweens = new TweensImpl();
    tweens.to(target, { readOnlyVector: { x: 10, y: 0, z: 0 } }, { duration: 1 });
    run(tweens, 2, 0.25);
    expect(live.x).toBeCloseTo(5, 6);
  });
});

describe("Tween looping", () => {
  it("repeats the requested number of extra cycles", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const onComplete = vi.fn();
    tweens.to(target, { value: 1 }, { duration: 1, loop: 2, onComplete });
    run(tweens, 14, 0.2);
    expect(onComplete).not.toHaveBeenCalled();
    run(tweens, 1, 0.2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(target.value).toBeCloseTo(1, 6);
  });

  it("runs forever with loop -1 until stopped", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 1 }, { duration: 1, loop: -1 });
    run(tweens, 100, 0.1);
    expect(tweens.count).toBe(1);
    tweens.stopAll();
    expect(tweens.count).toBe(0);
  });

  it("reverses every other cycle with yoyo and ends where it started", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const tween = tweens.to(target, { value: 10 }, { duration: 1, yoyo: true, loop: 1 });
    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(5, 6);
    run(tweens, 10, 0.1);
    expect(target.value).toBeCloseTo(5, 6);
    expect(tween.progress).toBeCloseTo(0.5, 6);
    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(0, 6);
    expect(tween.isDone).toBe(true);
  });
});

describe("Tween control", () => {
  it("pauses and resumes", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const tween = tweens.to(target, { value: 10 }, { duration: 1 });
    run(tweens, 3, 0.1);
    tween.pause();
    expect(tween.isPaused).toBe(true);
    expect(tween.isPlaying).toBe(false);
    run(tweens, 5, 0.1);
    expect(target.value).toBeCloseTo(3, 6);
    tween.resume();
    run(tweens, 3, 0.1);
    expect(target.value).toBeCloseTo(6, 6);
  });

  it("stop leaves the value where it is and never completes", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const onComplete = vi.fn();
    const tween = tweens.to(target, { value: 10 }, { duration: 1, onComplete });
    run(tweens, 3, 0.1);
    tween.stop();
    run(tweens, 20, 0.1);
    expect(target.value).toBeCloseTo(3, 6);
    expect(onComplete).not.toHaveBeenCalled();
    expect(tweens.count).toBe(0);
  });

  it("complete jumps to the end and fires onComplete once", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const onComplete = vi.fn();
    const tween = tweens.to(target, { value: 10 }, { duration: 1, onComplete });
    tween.complete();
    expect(target.value).toBeCloseTo(10, 6);
    expect(onComplete).toHaveBeenCalledTimes(1);
    tween.complete();
    expect(onComplete).toHaveBeenCalledTimes(1);
    run(tweens, 1, 0.1);
    expect(tweens.count).toBe(0);
  });

  it("complete on a yoyo with an odd last cycle lands back at the start", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    target.value = 3;
    const tween = tweens.to(target, { value: 10 }, { duration: 1, yoyo: true, loop: 1 });
    tween.complete();
    expect(target.value).toBeCloseTo(3, 6);
  });

  it("stopAllOf stops only the tweens of one target", () => {
    const tweens = new TweensImpl();
    const a = new Target();
    const b = new Target();
    tweens.to(a, { value: 1 }, { duration: 1 });
    tweens.to(a, { position: { x: 1, y: 0, z: 0 } }, { duration: 1 });
    tweens.to(b, { value: 1 }, { duration: 1 });
    expect(tweens.stopAllOf(a)).toBe(2);
    expect(tweens.count).toBe(1);
    expect(tweens.stopAllOf(a)).toBe(0);
  });

  it("clear drops every tween without completing them", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    const onComplete = vi.fn();
    tweens.to(target, { value: 1 }, { duration: 1, onComplete });
    tweens.clear();
    expect(tweens.count).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("exposes the target for stopAllOf", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    expect(tweens.to(target, { value: 1 }, { duration: 1 }).target).toBe(target);
  });
});

describe("Tweens and pause", () => {
  it("freezes ordinary tweens while the app is paused", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 10 }, { duration: 1 });
    tweens.advance(0.1, 0.1, true);
    expect(target.value).toBe(0);
    tweens.advance(0.1, 0.1, false);
    expect(target.value).toBeCloseTo(1, 6);
  });

  it("advances updateWhenPaused tweens on unscaled time", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(target, { value: 10 }, { duration: 1, updateWhenPaused: true });
    // Scaled time is halved by a time scale; the paused tween ignores it.
    tweens.advance(0.05, 0.1, true);
    expect(target.value).toBeCloseTo(1, 6);
  });

  it("advances several tweens started in one frame and removes the finished ones", () => {
    const tweens = new TweensImpl();
    const a = new Target();
    const b = new Target();
    tweens.to(a, { value: 1 }, { duration: 0.1 });
    tweens.to(b, { value: 1 }, { duration: 10 });
    run(tweens, 1, 0.1);
    expect(tweens.count).toBe(1);
    expect(a.value).toBeCloseTo(1, 6);
  });

  it("does not advance a tween started by an onComplete handler in the same frame", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    tweens.to(
      target,
      { value: 1 },
      {
        duration: 0.1,
        onComplete: (): void => {
          tweens.to(target, { position: { x: 5, y: 0, z: 0 } }, { duration: 1 });
        },
      },
    );
    run(tweens, 1, 0.1);
    expect(tweens.count).toBe(1);
    expect(target.position.x).toBe(0);
  });
});

describe("Tween validation", () => {
  it("rejects a non-positive duration", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    expect(() => tweens.to(target, { value: 1 }, { duration: 0 })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.invalidTweenOptions }),
    );
  });

  it("rejects a negative delay, a bad loop count, and an unknown easing name", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    expect(() => tweens.to(target, { value: 1 }, { duration: 1, delay: -1 })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.invalidTweenOptions }),
    );
    expect(() => tweens.to(target, { value: 1 }, { duration: 1, loop: -2 })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.invalidTweenOptions }),
    );
    expect(() => tweens.to(target, { value: 1 }, { duration: 1, ease: BAD_EASE })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.invalidTweenOptions }),
    );
  });

  it("rejects a field that is not a number or a vector", () => {
    const tweens = new TweensImpl();
    const target = { label: "hello" };
    try {
      // A JavaScript caller reaches this by accident, so the runtime has to catch it: the mapped
      // type drops `label` entirely, so an excess-property-free object is the only way in.
      const props: Record<string, number> = { label: 1 };
      tweens.to(target, props, { duration: 1 });
      expect.unreachable("a string field is not tweenable");
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.tweenFieldNotTweenable);
    }
  });

  it("rejects a destination whose shape does not match the field", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    expect(() => tweens.to(target, { position: 3 } as never, { duration: 1 })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.tweenFieldNotTweenable }),
    );
  });

  it("rejects a read-only number field", () => {
    const target = {
      get frozen(): number {
        return 1;
      },
    };
    const tweens = new TweensImpl();
    expect(() => tweens.to(target, { frozen: 2 }, { duration: 1 })).toThrow(
      expect.objectContaining({ code: CoreErrorCode.tweenFieldNotTweenable }),
    );
  });

  it("ignores an explicitly undefined destination", () => {
    const tweens = new TweensImpl();
    const target = new Target();
    // `exactOptionalPropertyTypes` keeps the mapped type from accepting `undefined` outright, but a
    // spread of an optional field reaches the constructor with the key present and unset.
    const partial: { value?: number } = {};
    tweens.to(target, { ...partial }, { duration: 1 });
    run(tweens, 10, 0.1);
    expect(target.value).toBe(0);
  });

  it("tweens a field the target does not declare yet", () => {
    const tweens = new TweensImpl();
    const target: { extra?: number } = { extra: 0 };
    tweens.to(target, { extra: 5 }, { duration: 1 });
    run(tweens, 10, 0.1);
    expect(target.extra).toBeCloseTo(5, 6);
  });
});

describe("tweensInternals", () => {
  it("returns the implementation it was given", () => {
    const tweens = new TweensImpl();
    expect(tweensInternals(tweens)).toBe(tweens);
  });

  it("refuses a foreign implementation", () => {
    const foreign: Tweens = {
      count: 0,
      to: (): never => {
        throw new Error("no");
      },
      stopAll: (): void => {},
      stopAllOf: (): number => 0,
    };
    expect(() => tweensInternals(foreign)).toThrow(expect.objectContaining({ code: CoreErrorCode.invalidRuntime }));
  });
});
