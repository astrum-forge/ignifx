import { describe, expect, it } from "vitest";
import { Color } from "../../src/math/color.js";

describe("Color construction", () => {
  it("defaults to transparent-free black: zero colour, opaque alpha", () => {
    const c = new Color();
    expect([c.r, c.g, c.b, c.a]).toEqual([0, 0, 0, 1]);
    expect(Color.black().equalsWithEpsilon(c)).toBe(true);
    expect(Color.white().equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(true);
    expect(Color.transparent().equalsWithEpsilon({ r: 0, g: 0, b: 0, a: 0 })).toBe(true);
  });

  it("copies and clones", () => {
    const c = Color.from({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 });
    expect(c.clone().equalsWithEpsilon(c)).toBe(true);
    expect(new Color().copyFrom(c).equalsWithEpsilon(c)).toBe(true);
    const set = new Color();
    expect(set.set(1, 1, 1, 1)).toBe(set);
  });
});

describe("Color spaces", () => {
  it("round-trips a channel between sRGB and linear", () => {
    for (const value of [0, 0.02, 0.04045, 0.5, 1]) {
      // 6 digits, not more: the curve's knee at 0.04045 loses about 3e-8 through the two powers.
      expect(Color.linearToSrgb(Color.srgbToLinear(value))).toBeCloseTo(value, 6);
    }
  });

  it("uses the piecewise curve, not a plain gamma, near black", () => {
    expect(Color.srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
    expect(Color.linearToSrgb(0.002)).toBeCloseTo(0.002 * 12.92, 12);
  });

  it("clamps out-of-range channels", () => {
    expect(Color.srgbToLinear(-1)).toBe(0);
    expect(Color.srgbToLinear(2)).toBe(1);
    expect(Color.linearToSrgb(-1)).toBe(0);
    // `1.055 * 1 ** (1 / 2.4) - 0.055` is a hair under 1 in binary floating point.
    expect(Color.linearToSrgb(2)).toBeCloseTo(1, 12);
  });

  it("stores sRGB input as linear, leaving alpha alone", () => {
    const c = Color.fromSrgb(0.5, 0.5, 0.5, 0.25);
    expect(c.r).toBeCloseTo(Color.srgbToLinear(0.5), 12);
    expect(c.r).toBeLessThan(0.5);
    expect(c.a).toBe(0.25);
  });

  it("writes sRGB components into an output colour", () => {
    const linear = Color.fromSrgb(0.5, 0.25, 0.75, 0.5);
    const srgb = linear.toSrgbToRef(new Color());
    expect(srgb.r).toBeCloseTo(0.5, 9);
    expect(srgb.g).toBeCloseTo(0.25, 9);
    expect(srgb.b).toBeCloseTo(0.75, 9);
    expect(srgb.a).toBe(0.5);
  });
});

describe("Color hex", () => {
  it("parses six and eight digit hex, with or without the hash, in either case", () => {
    const expected = Color.fromSrgb(1, 136 / 255, 0, 1);
    for (const hex of ["#ff8800", "ff8800", "#FF8800", "#ff8800ff"]) {
      const parsed = Color.fromHex(hex);
      expect(parsed).not.toBeNull();
      expect(parsed?.equalsWithEpsilon(expected, 1e-9)).toBe(true);
    }
  });

  it("reads the alpha byte of an eight digit hex", () => {
    const parsed = Color.fromHex("#00000080");
    expect(parsed?.a).toBeCloseTo(128 / 255, 9);
  });

  it("returns null for anything that is not a hex colour, leaving out untouched", () => {
    expect(Color.fromHex("#fff")).toBeNull();
    expect(Color.fromHex("nope")).toBeNull();
    expect(Color.fromHex("")).toBeNull();
    expect(Color.fromHex("#gggggg")).toBeNull();
    const out = Color.white();
    expect(Color.fromHexToRef("#12345", out)).toBe(false);
    expect(out.equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(true);
  });

  it("round-trips hex to linear and back", () => {
    for (const hex of ["#000000", "#ffffff", "#ff8800", "#123456"]) {
      expect(Color.fromHex(hex)?.toHex()).toBe(hex);
    }
  });

  it("emits eight digits only when the colour is translucent", () => {
    expect(Color.white().toHex()).toBe("#ffffff");
    expect(Color.fromHex("#11223344")?.toHex()).toBe("#11223344");
    expect(new Color(1, 1, 1, 2).toHex()).toBe("#ffffff");
  });
});

describe("Color operations", () => {
  it("multiplies and scales, and scaling leaves alpha alone", () => {
    const tint = new Color(0.5, 0.5, 0.5, 0.5);
    expect(
      tint.clone().multiply({ r: 0.5, g: 1, b: 1, a: 1 }).equalsWithEpsilon({ r: 0.25, g: 0.5, b: 0.5, a: 0.5 }),
    ).toBe(true);
    const brighter = tint.clone().scaleRgb(2);
    expect(brighter.equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 0.5 })).toBe(true);
  });

  it("interpolates in linear space", () => {
    const mid = new Color(0, 0, 0, 0).lerp({ r: 1, g: 1, b: 1, a: 1 }, 0.5);
    expect(mid.equalsWithEpsilon({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 })).toBe(true);
  });

  it("compares with a tolerance", () => {
    expect(new Color(1, 1, 1, 1).equalsWithEpsilon({ r: 1 + 1e-9, g: 1, b: 1, a: 1 })).toBe(true);
    expect(new Color(1, 1, 1, 1).equalsWithEpsilon({ r: 0.5, g: 1, b: 1, a: 1 })).toBe(false);
    expect(Color.equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 }, { r: 0.6, g: 1, b: 1, a: 1 }, 0.5)).toBe(true);
  });

  it("writes linear components into a Float32Array", () => {
    const buffer = new Float32Array(8);
    new Color(0.1, 0.2, 0.3, 0.4).toArray(buffer, 4);
    expect(buffer[4]).toBeCloseTo(0.1, 6);
    expect(buffer[7]).toBeCloseTo(0.4, 6);
  });

  it("writes into out and stays correct when out aliases an input", () => {
    const out = new Color();
    expect(Color.multiplyToRef({ r: 0.5, g: 0.5, b: 0.5, a: 1 }, { r: 2, g: 2, b: 2, a: 1 }, out)).toBe(out);
    expect(out.equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(true);

    const a = new Color(0.5, 0.5, 0.5, 0.5);
    expect(Color.multiplyToRef(a, { r: 2, g: 2, b: 2, a: 2 }, a).equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(
      true,
    );

    const b = new Color(0.25, 0.25, 0.25, 0.5);
    expect(Color.scaleRgbToRef(b, 4, b).equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 0.5 })).toBe(true);

    const c = new Color(1, 1, 1, 1);
    expect(
      Color.lerpToRef({ r: 0, g: 0, b: 0, a: 0 }, c, 0.5, c).equalsWithEpsilon({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 }),
    ).toBe(true);

    const d = Color.white();
    expect(d.toSrgbToRef(d).equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(true);

    const e = new Color();
    expect(Color.fromSrgbToRef(1, 1, 1, 1, e).equalsWithEpsilon({ r: 1, g: 1, b: 1, a: 1 })).toBe(true);
  });
});
