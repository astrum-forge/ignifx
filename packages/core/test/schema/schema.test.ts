import { describe, expect, expectTypeOf, it } from "vitest";
import { f32, str } from "../../src/schema/field-kinds.js";
import { applyInit, createDefaults, defineSchema } from "../../src/schema/schema.js";
import { moverSchema } from "./mover-fixture.js";
import type { AudioClip, Camera, FakeEntity } from "./mover-fixture.js";
import type { ColorLike, Vec3Like } from "../../src/math/types.js";
import type { AssetRefValue, FieldsOf, PartialFieldsOf } from "../../src/schema/types.js";

describe("FieldsOf", () => {
  it("projects the Mover schema onto the property types Script.define exposes", () => {
    expectTypeOf<FieldsOf<typeof moverSchema>>().toEqualTypeOf<{
      speed: number;
      jumpHeight: number;
      loops: number;
      active: boolean;
      label: string;
      offset: Vec3Like;
      tint: ColorLike;
      mode: "walk" | "run";
      target: FakeEntity | null;
      follow: Camera | null;
      clip: AssetRefValue<AudioClip> | null;
      waypoints: Vec3Like[];
      stats: { hp: number; armor: number };
    }>();
  });

  it("strips readonly so game code can assign to a field", () => {
    const fields = createDefaults(moverSchema);
    fields.speed = 12;
    expect(fields.speed).toBe(12);
  });
});

describe("defineSchema", () => {
  it("returns the same object it was given", () => {
    const fields = { speed: f32(1) };
    expect(defineSchema(fields)).toBe(fields);
  });

  it("preserves the precise schema type", () => {
    const fields = defineSchema({ speed: f32(1), label: str("") });
    expectTypeOf<FieldsOf<typeof fields>>().toEqualTypeOf<{ speed: number; label: string }>();
  });

  it("rejects a name that collides with a Component member", () => {
    expect(() => defineSchema({ enabled: f32(1) })).toThrow(/collides with a Component or Script member/u);
  });

  it.each(["uid", "entity", "transform", "world", "app", "isDestroyed", "update", "stopAllCoroutines"])(
    "rejects the reserved name %s",
    (name) => {
      expect(() => defineSchema({ [name]: f32(1) })).toThrow(/IGX-0607/u);
    },
  );

  it("rejects a name starting with an underscore", () => {
    expect(() => defineSchema({ _hidden: f32(1) })).toThrow(/not a valid field name/u);
  });

  it("rejects a name that is not identifier-like", () => {
    expect(() => defineSchema({ "my field": f32(1) })).toThrow(/not a valid field name/u);
  });

  it("accepts an ordinary field name", () => {
    expect(() => defineSchema({ moveSpeed2: f32(1) })).not.toThrow();
  });
});

describe("createDefaults", () => {
  it("builds one value per declared field", () => {
    expect(createDefaults(moverSchema)).toEqual({
      speed: 5,
      jumpHeight: 2,
      loops: 1,
      active: true,
      label: "",
      offset: { x: 0, y: 1, z: 0 },
      tint: { r: 1, g: 1, b: 1, a: 1 },
      mode: "walk",
      target: null,
      follow: null,
      clip: null,
      waypoints: [],
      stats: { hp: 10, armor: 0 },
    });
  });

  it("never shares an object default between two components", () => {
    const first = createDefaults(moverSchema);
    const second = createDefaults(moverSchema);
    expect(first.offset).not.toBe(second.offset);
    expect(first.waypoints).not.toBe(second.waypoints);
    expect(first.stats).not.toBe(second.stats);
    first.offset = { x: 9, y: 9, z: 9 };
    expect(second.offset).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe("applyInit", () => {
  it("overwrites only the names it is given", () => {
    const fields = applyInit(createDefaults(moverSchema), moverSchema, { speed: 12, label: "hero" });
    expect(fields.speed).toBe(12);
    expect(fields.label).toBe("hero");
    expect(fields.jumpHeight).toBe(2);
  });

  it("returns the same object for chaining", () => {
    const target = createDefaults(moverSchema);
    expect(applyInit(target, moverSchema, {})).toBe(target);
  });

  it("treats undefined as absent so the default survives", () => {
    const fields = applyInit(createDefaults(moverSchema), moverSchema, { speed: undefined });
    expect(fields.speed).toBe(5);
  });

  it("ignores names the schema does not declare", () => {
    const schema = { speed: f32(5) };
    const fields = applyInit(createDefaults(schema), schema, { extra: 1 } as PartialFieldsOf<typeof schema>);
    expect(fields).toEqual({ speed: 5 });
  });
});
