import { describe, expect, it } from "vitest";
import { toLitePickCoordinate } from "../../src/lite/gpu/picker.js";

/**
 * The backing-to-CSS conversion in front of Lite's picker (`src/lite/gpu/picker.ts`). Lite multiplies
 * the CSS coordinate by `backing / client` again, so the round trip must not land below the caller's
 * backing coordinate — at a viewport edge that would be a miss. Device pixel ratio 2 is exact in
 * floating point; ratios like 1.5 and 1000/667 are not, which is where the nudge matters.
 */

/** Ratios Lite computes as `canvas.width / canvas.clientWidth` on real displays and zoom levels. */
const RATIOS = [1.5, 100 / 67, 1000 / 667];

/** Every whole and half backing coordinate up to a 4K canvas edge. */
const COORDINATES = Array.from({ length: 4096 * 2 }, (_, index) => index / 2);

describe("toLitePickCoordinate", () => {
  it("returns the coordinate unchanged at a ratio of 1", () => {
    expect(toLitePickCoordinate(37.25, 1)).toBe(37.25);
  });

  it.each(RATIOS)("never lets Lite's round trip fall below the coordinate, at ratio %d", (scale) => {
    for (const value of COORDINATES) {
      const css = toLitePickCoordinate(value, scale);
      const back = css * scale;
      expect(back).toBeGreaterThanOrEqual(value);
      expect(back - value).toBeLessThan(1e-9);
      expect(Math.floor(back)).toBe(Math.floor(value));
    }
  });

  // 1.5 happens to round-trip every coordinate here; these two do not.
  it.each([100 / 67, 1000 / 667])("is needed at ratio %d: a plain division falls below some", (scale) => {
    const below = COORDINATES.filter((value) => (value / scale) * scale < value);
    expect(below.length).toBeGreaterThan(0);
  });
});
