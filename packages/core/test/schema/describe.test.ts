import { describe, expect, it } from "vitest";
import { describeSchema, toJsonSchema } from "../../src/schema/describe.js";
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
} from "../../src/schema/field-kinds.js";
import { AudioClip, Camera, forgedField, moverSchema } from "./mover-fixture.js";
import type { JsonObject } from "../../src/schema/json.js";

/** Reads one property fragment out of a generated object schema. */
function propertyOf(schema: JsonObject, name: string): JsonObject {
  const properties = schema["properties"] as JsonObject;
  return properties[name] as JsonObject;
}

describe("describeSchema", () => {
  it("produces the shape the docs harness reads", () => {
    const described = describeSchema("mygame/Mover", moverSchema, { description: "Moves an entity." });
    expect(described.title).toBe("Mover");
    expect(described.format).toBe("components");
    expect(described.description).toBe("Moves an entity.");
    expect(Object.keys(described.fields)).toEqual(Object.keys(moverSchema));
    expect(described.fields["speed"]).toEqual({
      kind: "f32",
      default: 5,
      description: "Units per second",
    });
  });

  it("encodes object defaults as JSON", () => {
    const described = describeSchema("mygame/Mover", moverSchema);
    expect(described.fields["offset"]).toEqual({ kind: "vec3", default: [0, 1, 0] });
    expect(described.fields["tint"]).toEqual({ kind: "color", default: [1, 1, 1, 1] });
    expect(described.fields["target"]).toEqual({ kind: "entityRef", default: null });
    expect(described.fields["stats"]).toEqual({ kind: "record", default: { hp: 10, armor: 0 } });
  });

  it("omits the description when the field has no tooltip", () => {
    const described = describeSchema("mygame/Mover", moverSchema);
    expect(Object.hasOwn(described.fields["loops"] ?? {}, "description")).toBe(false);
  });

  it("takes the title from the last segment of the type id", () => {
    expect(describeSchema("ignifx/MeshRenderer", {}).title).toBe("MeshRenderer");
    expect(describeSchema("Bare", {}).title).toBe("Bare");
  });

  it("lets the caller override the title and format", () => {
    const described = describeSchema("ignifx/Material", {}, { title: "Standard material", format: "materials" });
    expect(described.title).toBe("Standard material");
    expect(described.format).toBe("materials");
    expect(described.description).toBeUndefined();
  });
});

describe("toJsonSchema", () => {
  it("describes props as an open-ended object with no required keys", () => {
    const schema = toJsonSchema({ speed: f32(5) });
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBe(false);
    expect(Object.hasOwn(schema, "required")).toBe(false);
  });

  it("maps the numeric kinds", () => {
    const schema = toJsonSchema({ a: f32(), b: f64(), c: i32(), d: u32() });
    expect(propertyOf(schema, "a")["type"]).toBe("number");
    expect(propertyOf(schema, "b")["type"]).toBe("number");
    expect(propertyOf(schema, "c")).toMatchObject({ type: "integer", minimum: -2147483648 });
    expect(propertyOf(schema, "d")).toMatchObject({ type: "integer", minimum: 0, maximum: 4294967295 });
  });

  it("carries tooltips, bounds, and defaults onto the fragment", () => {
    const schema = toJsonSchema({ speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" }) });
    expect(propertyOf(schema, "speed")).toEqual({
      type: "number",
      description: "Units per second",
      minimum: 0,
      maximum: 50,
      default: 5,
    });
  });

  it("maps scalars, vectors, and colors", () => {
    const schema = toJsonSchema({ a: bool(), b: str(), c: vec2(), d: quat(), e: color() });
    expect(propertyOf(schema, "a")["type"]).toBe("boolean");
    expect(propertyOf(schema, "b")["type"]).toBe("string");
    expect(propertyOf(schema, "c")).toMatchObject({ type: "array", minItems: 2, maxItems: 2 });
    expect(propertyOf(schema, "d")).toMatchObject({ minItems: 4, maxItems: 4 });
    expect(propertyOf(schema, "e")).toMatchObject({ minItems: 4, maxItems: 4 });
  });

  it("maps enumerations to a string enum", () => {
    const schema = toJsonSchema({ mode: enumOf(["walk", "run"] as const, "walk") });
    expect(propertyOf(schema, "mode")).toMatchObject({ type: "string", enum: ["walk", "run"] });
  });

  it("maps references to a tagged object or null", () => {
    const schema = toJsonSchema({ a: entityRef(), b: componentRef(Camera), c: asset(AudioClip) });
    expect(propertyOf(schema, "a")["oneOf"]).toMatchObject([
      { type: "object", required: ["$entity"] },
      { type: "null" },
    ]);
    expect(propertyOf(schema, "b")["oneOf"]).toMatchObject([{ required: ["$component"] }, { type: "null" }]);
    expect(propertyOf(schema, "c")["oneOf"]).toMatchObject([{ required: ["$asset"] }, { type: "null" }]);
  });

  it("recurses into arrays, records, maps, and optionals", () => {
    const schema = toJsonSchema({
      a: array(f32()),
      b: record({ hp: i32(1) }),
      c: map(str()),
      d: optional(str()),
    });
    expect(propertyOf(schema, "a")).toMatchObject({ type: "array", items: { type: "number" } });
    expect(propertyOf(schema, "b")).toMatchObject({ type: "object", additionalProperties: false });
    expect(propertyOf(schema, "c")).toMatchObject({ type: "object", additionalProperties: { type: "string" } });
    expect(propertyOf(schema, "d")["oneOf"]).toMatchObject([{ type: "string" }, { type: "null" }]);
  });

  it("maps layer masks and curves", () => {
    const schema = toJsonSchema({ a: layerMask(), b: curve() });
    expect(propertyOf(schema, "a")).toMatchObject({ type: "array", items: { type: "string" } });
    expect(propertyOf(schema, "b")).toMatchObject({ type: "object", required: ["keys"] });
  });

  it("takes a custom field's fragment from its codec", () => {
    const withSchema = custom({
      createDefault: () => 0,
      serialize: (value: number) => value,
      deserialize: () => 0,
      jsonSchema: { type: "integer" },
    });
    const withoutSchema = custom({
      createDefault: () => 0,
      serialize: (value: number) => value,
      deserialize: () => 0,
    });
    const schema = toJsonSchema({ a: withSchema, b: withoutSchema });
    expect(propertyOf(schema, "a")["type"]).toBe("integer");
    expect(propertyOf(schema, "b")).toEqual({ default: 0 });
  });

  it("throws on a forged field kind", () => {
    expect(() => toJsonSchema({ bogus: forgedField })).toThrow(/IGX-1505/u);
  });
});
