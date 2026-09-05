import { describe, expect, expectTypeOf, it } from "vitest";
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
  f64,
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
  vec4,
} from "../../src/schema/field-kinds.js";
import { AudioClip, Camera } from "./mover-fixture.js";
import type { FakeEntity } from "./mover-fixture.js";
import type { ColorLike, QuatLike, Vec2Like, Vec3Like, Vec4Like } from "../../src/math/types.js";
import type { AssetRefValue, CurveValue, FieldDefinition } from "../../src/schema/types.js";

describe("scalar field kinds", () => {
  it("defaults every numeric kind to zero and reports its own kind", () => {
    expect(f32().kind).toBe("f32");
    expect(f64().createDefault()).toBe(0);
    expect(i32().kind).toBe("i32");
    expect(u32(7).createDefault()).toBe(7);
  });

  it("mirrors the kind on the spec discriminant", () => {
    expect(f32().spec.kind).toBe(f32().kind);
  });

  it("keeps inspector options as given", () => {
    expect(f32(5, { min: 0, max: 50, tooltip: "Units per second" }).options).toEqual({
      min: 0,
      max: 50,
      tooltip: "Units per second",
    });
  });

  it("uses an empty options object when none is given", () => {
    expect(f32().options).toEqual({});
  });

  it("types the numeric kinds as numbers", () => {
    expectTypeOf(f32()).toEqualTypeOf<FieldDefinition<number>>();
    expectTypeOf(u32()).toEqualTypeOf<FieldDefinition<number>>();
  });

  it("defaults bool to false and str to the empty string", () => {
    expect(bool().createDefault()).toBe(false);
    expect(str().createDefault()).toBe("");
    expectTypeOf(bool()).toEqualTypeOf<FieldDefinition<boolean>>();
    expectTypeOf(str()).toEqualTypeOf<FieldDefinition<string>>();
  });
});

describe("vector field kinds", () => {
  it("defaults to the origin and the identity rotation", () => {
    expect(vec2().createDefault()).toEqual({ x: 0, y: 0 });
    expect(vec3().createDefault()).toEqual({ x: 0, y: 0, z: 0 });
    expect(vec4().createDefault()).toEqual({ x: 0, y: 0, z: 0, w: 0 });
    expect(quat().createDefault()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("records how many components the encoded array holds", () => {
    expect(vec2().spec).toMatchObject({ components: 2 });
    expect(vec3().spec).toMatchObject({ components: 3 });
    expect(quat().spec).toMatchObject({ components: 4 });
  });

  it("allocates a fresh object per instantiation", () => {
    const field = vec3({ x: 1, y: 2, z: 3 });
    expect(field.createDefault()).not.toBe(field.createDefault());
    expect(field.createDefault()).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("copies the supplied default so later mutation cannot leak in", () => {
    const source = { x: 1, y: 2, z: 3 };
    const field = vec3(source);
    Reflect.set(source, "x", 99);
    expect(field.createDefault()).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("types the vector kinds structurally", () => {
    expectTypeOf(vec2()).toEqualTypeOf<FieldDefinition<Vec2Like>>();
    expectTypeOf(vec3()).toEqualTypeOf<FieldDefinition<Vec3Like>>();
    expectTypeOf(vec4()).toEqualTypeOf<FieldDefinition<Vec4Like>>();
    expectTypeOf(quat()).toEqualTypeOf<FieldDefinition<QuatLike>>();
  });
});

describe("color", () => {
  it("defaults to opaque white", () => {
    expect(color().createDefault()).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expectTypeOf(color()).toEqualTypeOf<FieldDefinition<ColorLike>>();
  });

  it("accepts channels directly", () => {
    expect(color({ r: 0.5, g: 0.25, b: 0, a: 1 }).createDefault()).toEqual({ r: 0.5, g: 0.25, b: 0, a: 1 });
  });

  it("parses six-digit hexadecimal", () => {
    expect(color("#ff0000").createDefault()).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("parses eight-digit hexadecimal with alpha", () => {
    expect(color("#00ff0080").createDefault()).toEqual({ r: 0, g: 1, b: 0, a: 128 / 255 });
  });

  it("parses short hexadecimal", () => {
    expect(color("#f00").createDefault()).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(color("#0f08").createDefault()).toEqual({ r: 0, g: 1, b: 0, a: 8 / 15 });
  });

  it("rejects a string that is not a hexadecimal color", () => {
    expect(() => color("red")).toThrow(/IGX-0605/u);
  });
});

describe("enumOf", () => {
  it("narrows the value type to the declared literals", () => {
    const mode = enumOf(["walk", "run"] as const, "walk");
    expect(mode.createDefault()).toBe("walk");
    expectTypeOf(mode).toEqualTypeOf<FieldDefinition<"walk" | "run">>();
  });

  it("infers literals without an explicit const assertion", () => {
    expectTypeOf(enumOf(["a", "b"], "a")).toEqualTypeOf<FieldDefinition<"a" | "b">>();
  });

  it("copies the accepted values onto the spec", () => {
    expect(enumOf(["walk", "run"] as const, "run").spec).toMatchObject({ values: ["walk", "run"] });
  });

  it("rejects a default outside the accepted values", () => {
    // @ts-expect-error the default is deliberately not one of the declared values.
    expect(() => enumOf(["walk", "run"] as const, "fly")).toThrow(/IGX-0606/u);
  });
});

describe("reference field kinds", () => {
  it("defaults every reference to null", () => {
    expect(entityRef().createDefault()).toBeNull();
    expect(componentRef(Camera).createDefault()).toBeNull();
    expect(asset(AudioClip).createDefault()).toBeNull();
  });

  it("infers the referenced type from the class token", () => {
    expectTypeOf(componentRef(Camera)).toEqualTypeOf<FieldDefinition<Camera | null>>();
    expectTypeOf(asset(AudioClip)).toEqualTypeOf<FieldDefinition<AssetRefValue<AudioClip> | null>>();
    expectTypeOf(entityRef<FakeEntity>()).toEqualTypeOf<FieldDefinition<FakeEntity | null>>();
  });

  it("takes the file type discriminator from the asset class", () => {
    expect(asset(AudioClip).spec).toMatchObject({ typeName: "audio" });
  });

  it("records no type discriminator when the asset class declares none", () => {
    class Mesh {
      vertices = 0;
    }
    expect(asset(Mesh).spec).toMatchObject({ typeName: null });
  });

  it("keeps the component class on the spec", () => {
    expect(componentRef(Camera).spec).toMatchObject({ componentType: Camera });
  });
});

describe("composite field kinds", () => {
  it("gives arrays a mutable value type and a fresh default", () => {
    const waypoints = array(vec3());
    expectTypeOf(waypoints).toEqualTypeOf<FieldDefinition<Vec3Like[]>>();
    expect(waypoints.createDefault()).toEqual([]);
    expect(waypoints.createDefault()).not.toBe(waypoints.createDefault());
  });

  it("copies an array default per instantiation", () => {
    const field = array(f32(), [1, 2]);
    const first = field.createDefault();
    first.push(3);
    expect(field.createDefault()).toEqual([1, 2]);
  });

  it("projects a record's sub-fields onto an object type", () => {
    const stats = record({ hp: i32(10), armor: f32(0) });
    expect(stats.createDefault()).toEqual({ hp: 10, armor: 0 });
    expectTypeOf(stats.createDefault()).toEqualTypeOf<{ hp: number; armor: number }>();
  });

  it("gives maps an empty, freshly allocated default", () => {
    const ammo = map(i32(0));
    expectTypeOf(ammo).toEqualTypeOf<FieldDefinition<Record<string, number>>>();
    expect(ammo.createDefault()).toEqual({});
    expect(ammo.createDefault()).not.toBe(ammo.createDefault());
  });

  it("widens optional to null and defaults to it", () => {
    const nickname = optional(str("x"));
    expectTypeOf(nickname).toEqualTypeOf<FieldDefinition<string | null>>();
    expect(nickname.createDefault()).toBeNull();
  });
});

describe("layerMask and curve", () => {
  it("stores layer names, not bits", () => {
    const mask = layerMask(["Default", "Enemy"]);
    expectTypeOf(mask).toEqualTypeOf<FieldDefinition<readonly string[]>>();
    expect(mask.createDefault()).toEqual(["Default", "Enemy"]);
    expect(mask.createDefault()).not.toBe(mask.createDefault());
    expect(layerMask().createDefault()).toEqual([]);
  });

  it("copies curve keys per instantiation", () => {
    const falloff = curve({ keys: [[0, 1, 0, 0]] });
    expectTypeOf(falloff).toEqualTypeOf<FieldDefinition<CurveValue>>();
    expect(falloff.createDefault()).toEqual({ keys: [[0, 1, 0, 0]] });
    expect(falloff.createDefault().keys).not.toBe(falloff.createDefault().keys);
    expect(curve().createDefault()).toEqual({ keys: [] });
  });
});

describe("custom", () => {
  it("takes its default from the codec", () => {
    const grid = custom({
      createDefault: () => [0, 0],
      serialize: (value: number[]) => value,
      deserialize: () => [0, 0],
    });
    expectTypeOf(grid).toEqualTypeOf<FieldDefinition<number[]>>();
    expect(grid.createDefault()).toEqual([0, 0]);
    expect(grid.createDefault()).not.toBe(grid.createDefault());
  });
});
