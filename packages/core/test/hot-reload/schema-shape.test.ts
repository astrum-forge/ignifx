import { describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { schemaShapeKey } from "../../src/hot-reload/schema-shape.js";
import {
  array,
  asset,
  color,
  componentRef,
  f32,
  i32,
  map,
  optional,
  record,
  str,
  vec3,
} from "../../src/schema/field-kinds.js";

/**
 * The field-layout comparison behind the `"patch"` fallback
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 */

/** A component class an `asset()` and a `componentRef()` field can point at. */
class Target extends Component.define({ note: str("") }) {
  static typeId = "test/ShapeTarget";
}

describe("schemaShapeKey", () => {
  it("is empty for a class that declares no schema", () => {
    expect(schemaShapeKey(null)).toBe("");
  });

  it("ignores presentation options and default values", () => {
    expect(schemaShapeKey({ speed: f32(5) })).toBe(schemaShapeKey({ speed: f32(9, { min: 0, tooltip: "how fast" }) }));
  });

  it("changes when a field is added, removed, renamed, or retyped", () => {
    const base = schemaShapeKey({ speed: f32(1) });
    expect(schemaShapeKey({ speed: f32(1), turbo: f32(2) })).not.toBe(base);
    expect(schemaShapeKey({})).not.toBe(base);
    expect(schemaShapeKey({ velocity: f32(1) })).not.toBe(base);
    expect(schemaShapeKey({ speed: i32(1) })).not.toBe(base);
  });

  it("changes when declaration order changes, because the file's key order does", () => {
    expect(schemaShapeKey({ a: f32(1), b: str("") })).not.toBe(schemaShapeKey({ b: str(""), a: f32(1) }));
  });

  it("recurses into array, map, optional, and record fields", () => {
    expect(schemaShapeKey({ path: array(vec3()) })).not.toBe(schemaShapeKey({ path: array(f32()) }));
    expect(schemaShapeKey({ table: map(f32()) })).not.toBe(schemaShapeKey({ table: map(str()) }));
    expect(schemaShapeKey({ tint: optional(color()) })).not.toBe(schemaShapeKey({ tint: optional(f32()) }));
    expect(schemaShapeKey({ box: record({ w: f32() }) })).not.toBe(schemaShapeKey({ box: record({ h: f32() }) }));
    expect(schemaShapeKey({ box: record({ w: f32() }) })).toBe(schemaShapeKey({ box: record({ w: f32(3) }) }));
  });

  it("treats reference and asset kinds by kind alone", () => {
    expect(schemaShapeKey({ link: componentRef(Target) })).toBe(schemaShapeKey({ link: componentRef(Target) }));
    expect(schemaShapeKey({ clip: asset(Target) })).not.toBe(schemaShapeKey({ clip: componentRef(Target) }));
  });
});
