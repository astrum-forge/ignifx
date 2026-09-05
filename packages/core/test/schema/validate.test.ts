import { describe, expect, it } from "vitest";
import {
  array,
  asset,
  bool,
  color,
  componentRef,
  curve,
  custom,
  entityRef,
  enumOf,
  f32,
  i32,
  layerMask,
  map,
  optional,
  quat,
  record,
  str,
  u32,
  vec2,
  vec3,
} from "../../src/schema/field-kinds.js";
import { validateProps, validateValue } from "../../src/schema/validate.js";
import { AudioClip, Camera, FakeEntity, forgedField, moverSchema } from "./mover-fixture.js";

/** The codes reported for a value, in discovery order. */
function codesFor(field: Parameters<typeof validateValue>[0], value: unknown): readonly string[] {
  return validateValue(field, value).map((found) => found.code);
}

describe("numeric validation", () => {
  it("accepts a finite number", () => {
    expect(validateValue(f32(), 1.5)).toEqual([]);
  });

  it("reports a wrong type as IGX-0605", () => {
    expect(codesFor(f32(), "1.5")).toEqual(["IGX-0605"]);
  });

  it("reports NaN and the infinities as IGX-0601", () => {
    expect(codesFor(f32(), Number.NaN)).toEqual(["IGX-0601"]);
    expect(codesFor(f32(), Number.POSITIVE_INFINITY)).toEqual(["IGX-0601"]);
  });

  it("reports a fractional value for an integer kind as IGX-0606", () => {
    expect(codesFor(i32(), 1.5)).toEqual(["IGX-0606"]);
    expect(validateValue(i32(), 1.5)[0]?.message).toMatch(/whole number/u);
  });

  it("reports a value outside the 32-bit range as IGX-0606", () => {
    expect(codesFor(i32(), 2147483648)).toEqual(["IGX-0606"]);
    expect(codesFor(u32(), -1)).toEqual(["IGX-0606"]);
    expect(codesFor(u32(), 4294967296)).toEqual(["IGX-0606"]);
    expect(validateValue(i32(), 2147483647)).toEqual([]);
    expect(validateValue(u32(), 0)).toEqual([]);
  });

  it("reports the declared min and max as IGX-0606", () => {
    const speed = f32(5, { min: 0, max: 50 });
    expect(codesFor(speed, -1)).toEqual(["IGX-0606"]);
    expect(codesFor(speed, 51)).toEqual(["IGX-0606"]);
    expect(validateValue(speed, 25)).toEqual([]);
  });
});

describe("scalar validation", () => {
  it("checks booleans and strings", () => {
    expect(validateValue(bool(), true)).toEqual([]);
    expect(codesFor(bool(), "true")).toEqual(["IGX-0605"]);
    expect(validateValue(str(), "hi")).toEqual([]);
    expect(codesFor(str(), 1)).toEqual(["IGX-0605"]);
  });
});

describe("vector and color validation", () => {
  it("accepts a structurally complete vector", () => {
    expect(validateValue(vec3(), { x: 1, y: 2, z: 3 })).toEqual([]);
    expect(validateValue(quat(), { x: 0, y: 0, z: 0, w: 1 })).toEqual([]);
  });

  it("reports a missing component with its own path", () => {
    const issues = validateValue(vec3(), { x: 1, y: 2 }, "offset");
    expect(issues).toEqual([{ path: "offset.z", code: "IGX-0605", message: "expected a number, received undefined." }]);
  });

  it("ignores components the kind does not declare", () => {
    expect(validateValue(vec2(), { x: 1, y: 2, z: Number.NaN })).toEqual([]);
  });

  it("reports a non-finite component as IGX-0601", () => {
    expect(codesFor(vec3(), { x: 1, y: Number.NaN, z: 3 })).toEqual(["IGX-0601"]);
  });

  it("reports a non-object as IGX-0605", () => {
    expect(codesFor(vec3(), 3)).toEqual(["IGX-0605"]);
  });

  it("holds colors to the sRGB 0-1 range the file format declares", () => {
    expect(validateValue(color(), { r: 0, g: 0.5, b: 1, a: 1 })).toEqual([]);
    expect(codesFor(color(), { r: 1.5, g: 0, b: 0, a: 1 })).toEqual(["IGX-0606"]);
    expect(codesFor(color(), { r: -0.1, g: 0, b: 0, a: 1 })).toEqual(["IGX-0606"]);
  });
});

describe("enum validation", () => {
  it("accepts a declared value", () => {
    expect(validateValue(enumOf(["walk", "run"] as const, "walk"), "run")).toEqual([]);
  });

  it("reports an undeclared value as IGX-0606", () => {
    expect(codesFor(enumOf(["walk", "run"] as const, "walk"), "fly")).toEqual(["IGX-0606"]);
  });

  it("reports a non-string as IGX-0605", () => {
    expect(codesFor(enumOf(["walk", "run"] as const, "walk"), 1)).toEqual(["IGX-0605"]);
  });
});

describe("reference validation", () => {
  it("accepts null and an object target", () => {
    expect(validateValue(entityRef(), null)).toEqual([]);
    expect(validateValue(entityRef(), new FakeEntity("a"))).toEqual([]);
    expect(validateValue(componentRef(Camera), new Camera("c"))).toEqual([]);
  });

  it("reports a primitive target as IGX-0605", () => {
    expect(codesFor(entityRef(), "a")).toEqual(["IGX-0605"]);
  });

  it("checks that an asset reference carries a string address", () => {
    expect(validateValue(asset(AudioClip), null)).toEqual([]);
    expect(validateValue(asset(AudioClip), { address: "audio/hit.wav" })).toEqual([]);
    expect(codesFor(asset(AudioClip), { address: 1 })).toEqual(["IGX-0605"]);
    expect(codesFor(asset(AudioClip), "audio/hit.wav")).toEqual(["IGX-0605"]);
  });
});

describe("composite validation", () => {
  it("recurses into array elements with an indexed path", () => {
    const issues = validateValue(
      array(vec3()),
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0 },
      ],
      "waypoints",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("waypoints[1].z");
  });

  it("reports a non-array as IGX-0605", () => {
    expect(codesFor(array(f32()), {})).toEqual(["IGX-0605"]);
  });

  it("recurses into record sub-fields and rejects unknown ones", () => {
    const stats = record({ hp: i32(10), armor: f32(0) });
    expect(validateValue(stats, { hp: 10, armor: 0 })).toEqual([]);
    expect(codesFor(stats, { hp: 1.5 })).toEqual(["IGX-0606"]);
    expect(codesFor(stats, { hp: 10, armor: 0, extra: 1 })).toEqual(["IGX-0607"]);
    expect(codesFor(stats, [])).toEqual(["IGX-0605"]);
  });

  it("recurses into map values with a quoted key path", () => {
    const issues = validateValue(map(i32()), { rockets: 1.5 }, "ammo");
    expect(issues[0]?.path).toBe('ammo["rockets"]');
    expect(codesFor(map(i32()), 1)).toEqual(["IGX-0605"]);
  });

  it("lets optional through on null and checks the inner field otherwise", () => {
    expect(validateValue(optional(str()), null)).toEqual([]);
    expect(validateValue(optional(str()), "hi")).toEqual([]);
    expect(codesFor(optional(str()), 1)).toEqual(["IGX-0605"]);
  });
});

describe("layerMask and curve validation", () => {
  it("requires an array of names", () => {
    expect(validateValue(layerMask(), ["Default"])).toEqual([]);
    expect(codesFor(layerMask(), "Default")).toEqual(["IGX-0605"]);
    expect(codesFor(layerMask(), [1])).toEqual(["IGX-0605"]);
  });

  it("requires four finite numbers per curve key", () => {
    expect(validateValue(curve(), { keys: [[0, 1, 0, 0]] })).toEqual([]);
    expect(codesFor(curve(), 1)).toEqual(["IGX-0605"]);
    expect(codesFor(curve(), {})).toEqual(["IGX-0605"]);
    expect(codesFor(curve(), { keys: [[0, 1, 0]] })).toEqual(["IGX-0605"]);
    expect(codesFor(curve(), { keys: [[0, "1", 0, 0]] })).toEqual(["IGX-0605"]);
    expect(codesFor(curve(), { keys: [[0, Number.NaN, 0, 0]] })).toEqual(["IGX-0601"]);
  });
});

describe("custom validation", () => {
  it("leaves the shape to the codec", () => {
    const grid = custom({ createDefault: () => 0, serialize: (value: number) => value, deserialize: () => 0 });
    expect(validateValue(grid, "anything")).toEqual([]);
  });
});

describe("validateProps", () => {
  it("accepts a complete, valid set of props", () => {
    expect(
      validateProps(moverSchema, {
        speed: 5,
        offset: { x: 0, y: 1, z: 0 },
        mode: "run",
        waypoints: [],
        stats: { hp: 1, armor: 0 },
      }),
    ).toEqual([]);
  });

  it("accepts omitted props, which take schema defaults", () => {
    expect(validateProps(moverSchema, {})).toEqual([]);
  });

  it("reports an undeclared prop as IGX-0607", () => {
    const issues = validateProps(moverSchema, { nope: 1 });
    expect(issues).toEqual([{ path: "nope", code: "IGX-0607", message: 'the schema declares no field "nope".' }]);
  });

  it("prefixes nested paths", () => {
    const issues = validateProps(moverSchema, { stats: { hp: 1.5 } }, "props");
    expect(issues[0]?.path).toBe("props.stats.hp");
  });
});

describe("unknown field kinds", () => {
  it("throws rather than silently accepting a forged field", () => {
    expect(() => validateValue(forgedField, 1)).toThrow(/IGX-1505/u);
  });
});
