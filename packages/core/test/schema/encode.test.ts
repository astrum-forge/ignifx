import { describe, expect, it } from "vitest";
import { canonicalizeNumber, decodeProps, decodeValue, encodeProps, encodeValue } from "../../src/schema/encode.js";
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
  vec3,
} from "../../src/schema/field-kinds.js";
import { applyInit, createDefaults } from "../../src/schema/schema.js";
import {
  AudioClip,
  Camera,
  FakeEntity,
  fakeAssetHandle,
  fakeReferences,
  forgedField,
  moverSchema,
} from "./mover-fixture.js";
import type { SchemaIssue } from "../../src/schema/issues.js";

const target = new FakeEntity("01ENTITY");
const follow = new Camera("01CAMERA");
const { encoder, decoder } = fakeReferences([target], [follow]);

describe("canonicalizeNumber", () => {
  it("rounds to six decimal places", () => {
    expect(canonicalizeNumber(0.1 + 0.2)).toBe(0.3);
    expect(canonicalizeNumber(1.00000049)).toBe(1);
    expect(canonicalizeNumber(1.2345678)).toBe(1.234568);
  });

  it("normalizes negative zero", () => {
    expect(Object.is(canonicalizeNumber(-0), 0)).toBe(true);
    expect(Object.is(canonicalizeNumber(-0.0000001), 0)).toBe(true);
  });

  it("is idempotent", () => {
    const once = canonicalizeNumber(0.1 + 0.2);
    expect(canonicalizeNumber(once)).toBe(once);
  });
});

describe("encodeValue", () => {
  it("canonicalizes numbers", () => {
    expect(encodeValue(f32(), 2.00000049, encoder)).toBe(2);
  });

  it("reports NaN as IGX-0601 and writes null in its place", () => {
    const issues: SchemaIssue[] = [];
    expect(encodeValue(f32(), Number.NaN, encoder, issues)).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(["IGX-0601"]);
  });

  it("reports a wrong type as IGX-0605", () => {
    const issues: SchemaIssue[] = [];
    expect(encodeValue(f32(), "x" as unknown as number, encoder, issues)).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(["IGX-0605"]);
    expect(encodeValue(bool(), 1 as unknown as boolean, encoder)).toBeNull();
    expect(encodeValue(str(), 1 as unknown as string, encoder)).toBeNull();
    expect(encodeValue(enumOf(["a"] as const, "a"), 1 as never, encoder)).toBeNull();
  });

  it("writes booleans and strings as themselves", () => {
    expect(encodeValue(bool(), true, encoder)).toBe(true);
    expect(encodeValue(str(), "hero", encoder)).toBe("hero");
    expect(encodeValue(enumOf(["walk", "run"] as const, "walk"), "run", encoder)).toBe("run");
  });

  it("writes vectors and colors as arrays", () => {
    expect(encodeValue(vec3(), { x: 1, y: -0, z: 2.0000004 }, encoder)).toEqual([1, 0, 2]);
    expect(encodeValue(quat(), { x: 0, y: 0, z: 0, w: 1 }, encoder)).toEqual([0, 0, 0, 1]);
    expect(encodeValue(color(), { r: 1, g: 0.5, b: 0, a: 1 }, encoder)).toEqual([1, 0.5, 0, 1]);
  });

  it("writes null for a vector with an unusable component", () => {
    const issues: SchemaIssue[] = [];
    expect(encodeValue(vec3(), { x: 1, y: Number.NaN, z: 0 }, encoder, issues)).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(["IGX-0601"]);
    expect(encodeValue(vec3(), 1 as never, encoder)).toBeNull();
  });

  it("tags entity and component references", () => {
    expect(encodeValue(entityRef<FakeEntity>(), target, encoder)).toEqual({ $entity: "01ENTITY" });
    expect(encodeValue(componentRef(Camera), follow, encoder)).toEqual({ $component: "01CAMERA" });
    expect(encodeValue(entityRef<FakeEntity>(), null, encoder)).toBeNull();
    expect(encodeValue(componentRef(Camera), null, encoder)).toBeNull();
  });

  it("reports a reference outside the file as IGX-0602", () => {
    const issues: SchemaIssue[] = [];
    expect(encodeValue(entityRef(), new Camera("x") as unknown, encoder, issues)).toBeNull();
    expect(encodeValue(componentRef(Camera), new FakeEntity("x") as unknown as Camera, encoder, issues)).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(["IGX-0602", "IGX-0602"]);
  });

  it("tags asset references and carries the type discriminator", () => {
    expect(encodeValue(asset(AudioClip), fakeAssetHandle("audio/hit.wav", "audio") as never, encoder)).toEqual({
      $asset: "audio/hit.wav",
      type: "audio",
    });
    class Mesh {
      vertices = 0;
    }
    expect(encodeValue(asset(Mesh), { address: "models/hero.glb" } as never, encoder)).toEqual({
      $asset: "models/hero.glb",
    });
    expect(encodeValue(asset(AudioClip), null, encoder)).toBeNull();
    expect(encodeValue(asset(AudioClip), { address: 1 } as never, encoder)).toBeNull();
  });

  it("writes null for an in-code asset and reports the loss as IGX-0602", () => {
    const issues: SchemaIssue[] = [];
    const inCode = fakeAssetHandle("memory:mesh/1", "mesh");
    expect(encodeValue(asset(AudioClip), inCode as never, encoder, issues)).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(["IGX-0602"]);
  });

  it("writes arrays, records, and optionals", () => {
    expect(encodeValue(array(vec3()), [{ x: 1, y: 0, z: 0 }], encoder)).toEqual([[1, 0, 0]]);
    expect(encodeValue(array(f32()), 1 as never, encoder)).toBeNull();
    expect(encodeValue(record({ hp: i32(10), armor: f32(0) }), { hp: 3, armor: 1 }, encoder)).toEqual({
      hp: 3,
      armor: 1,
    });
    expect(encodeValue(record({ hp: i32(10) }), 1 as never, encoder)).toBeNull();
    expect(encodeValue(optional(str()), null, encoder)).toBeNull();
    expect(encodeValue(optional(str()), "hi", encoder)).toBe("hi");
  });

  it("writes map keys in lexicographic order", () => {
    const encoded = encodeValue(map(i32()), { rockets: 2, bullets: 1, arrows: 3 }, encoder);
    expect(Object.keys(encoded as Record<string, unknown>)).toEqual(["arrows", "bullets", "rockets"]);
    expect(encodeValue(map(i32()), 1 as never, encoder)).toBeNull();
  });

  it("writes layer names and curves", () => {
    expect(encodeValue(layerMask(), ["Default", "Enemy"], encoder)).toEqual(["Default", "Enemy"]);
    expect(encodeValue(layerMask(), 1 as never, encoder)).toBeNull();
    expect(encodeValue(layerMask(), [1] as never, encoder)).toBeNull();
    expect(encodeValue(curve(), { keys: [[0, 1, 0, 0]] }, encoder)).toEqual({ keys: [[0, 1, 0, 0]] });
    expect(encodeValue(curve(), 1 as never, encoder)).toBeNull();
    expect(encodeValue(curve(), {} as never, encoder)).toBeNull();
    expect(encodeValue(curve(), { keys: [[0, 1, 0]] } as never, encoder)).toBeNull();
  });

  it("hands custom fields to their codec", () => {
    const grid = custom({
      createDefault: () => [1, 2],
      serialize: (value: number[]) => [...value],
      deserialize: () => [1, 2],
    });
    expect(encodeValue(grid, [3, 4], encoder)).toEqual([3, 4]);
  });

  it("throws on a forged field kind", () => {
    expect(() => encodeValue(forgedField, 1, encoder)).toThrow(/IGX-1505/u);
  });
});

describe("encodeProps", () => {
  it("writes keys in schema declaration order", () => {
    const encoded = encodeProps(moverSchema, createDefaults(moverSchema), encoder);
    expect(Object.keys(encoded)).toEqual(Object.keys(moverSchema));
  });

  it("fills omitted props with schema defaults", () => {
    expect(encodeProps(moverSchema, {}, encoder)["speed"]).toBe(5);
  });

  it("skips fields marked transient", () => {
    const schema = { saved: f32(1), scratch: f32(2, { transient: true }) };
    expect(encodeProps(schema, {}, encoder)).toEqual({ saved: 1 });
  });
});

describe("decodeValue", () => {
  it("rebuilds vectors, colors, and curves", () => {
    expect(decodeValue(vec3(), [1, 2, 3], decoder).value).toEqual({ x: 1, y: 2, z: 3 });
    expect(decodeValue(color(), [1, 0.5, 0, 1], decoder).value).toEqual({ r: 1, g: 0.5, b: 0, a: 1 });
    expect(decodeValue(curve(), { keys: [[0, 1, 0, 0]] }, decoder).value).toEqual({ keys: [[0, 1, 0, 0]] });
  });

  it("canonicalizes on the way in so a reload is byte-identical", () => {
    expect(decodeValue(f32(), 2.00000049, decoder).value).toBe(2);
  });

  it("falls back to the field default and reports the problem", () => {
    const decoded = decodeValue(f32(7), "nope", decoder);
    expect(decoded.value).toBe(7);
    expect(decoded.issues.map((found) => found.code)).toEqual(["IGX-0605"]);
    expect(decodeValue(f32(7), Number.NaN, decoder).value).toBe(7);
    expect(decodeValue(bool(true), 1, decoder).value).toBe(true);
    expect(decodeValue(str("d"), 1, decoder).value).toBe("d");
    expect(decodeValue(vec3({ x: 9, y: 9, z: 9 }), [1, 2], decoder).value).toEqual({ x: 9, y: 9, z: 9 });
    expect(decodeValue(vec3({ x: 9, y: 9, z: 9 }), [1, 2, "3"], decoder).value).toEqual({ x: 9, y: 9, z: 9 });
    expect(decodeValue(enumOf(["a", "b"] as const, "a"), "c", decoder).value).toBe("a");
    expect(decodeValue(array(f32()), 1, decoder).value).toEqual([]);
    expect(decodeValue(record({ hp: i32(4) }), 1, decoder).value).toEqual({ hp: 4 });
    expect(decodeValue(map(i32()), 1, decoder).value).toEqual({});
    expect(decodeValue(layerMask(["D"]), 1, decoder).value).toEqual(["D"]);
    expect(decodeValue(layerMask(["D"]), [1], decoder).value).toEqual(["D"]);
    expect(decodeValue(curve(), 1, decoder).value).toEqual({ keys: [] });
    expect(decodeValue(curve(), {}, decoder).value).toEqual({ keys: [] });
    expect(decodeValue(curve(), { keys: [[0, 1, 0]] }, decoder).value).toEqual({ keys: [] });
    expect(decodeValue(asset(AudioClip), 1, decoder).value).toBeNull();
  });

  it("substitutes zero for an unreadable curve tangent", () => {
    expect(decodeValue(curve(), { keys: [[0, "x", null, 1]] }, decoder).value).toEqual({ keys: [[0, 0, 0, 1]] });
  });

  it("resolves tagged references through the decoder", () => {
    expect(decodeValue(entityRef<FakeEntity>(), { $entity: "01ENTITY" }, decoder).value).toBe(target);
    expect(decodeValue(componentRef(Camera), { $component: "01CAMERA" }, decoder).value).toBe(follow);
    expect(decodeValue(entityRef(), null, decoder).value).toBeNull();
  });

  it("reports an unknown uid as IGX-0602 and yields null", () => {
    const decoded = decodeValue(entityRef<FakeEntity>(), { $entity: "MISSING" }, decoder);
    expect(decoded.value).toBeNull();
    expect(decoded.issues.map((found) => found.code)).toEqual(["IGX-0602"]);
  });

  it("reports a malformed reference as IGX-0605", () => {
    expect(decodeValue(entityRef(), { nope: 1 }, decoder).issues.map((found) => found.code)).toEqual(["IGX-0605"]);
  });

  it("resolves asset references to the handle the scene already loaded", () => {
    expect(decodeValue(asset(AudioClip), { $asset: "audio/hit.wav" }, decoder).value).toEqual(
      fakeAssetHandle("audio/hit.wav", "audio"),
    );
    class Mesh {
      vertices = 0;
    }
    expect(decodeValue(asset(Mesh), { $asset: "models/hero.glb" }, decoder).value).toEqual(
      fakeAssetHandle("models/hero.glb", "unknown"),
    );
    expect(decodeValue(asset(AudioClip), null, decoder).value).toBeNull();
  });

  it("reports an address nothing loaded as IGX-0602 and yields null", () => {
    const empty = { entity: () => null, component: () => null, asset: () => null };
    const decoded = decodeValue(asset(AudioClip), { $asset: "audio/hit.wav" }, empty);
    expect(decoded.value).toBeNull();
    expect(decoded.issues.map((found) => found.code)).toEqual(["IGX-0602"]);
  });

  it("reads optionals, maps, and custom fields", () => {
    expect(decodeValue(optional(str()), null, decoder).value).toBeNull();
    expect(decodeValue(optional(str()), "hi", decoder).value).toBe("hi");
    expect(decodeValue(map(i32()), { b: 2, a: 1 }, decoder).value).toEqual({ a: 1, b: 2 });
    const grid = custom({
      createDefault: () => [0],
      serialize: (value: number[]) => [...value],
      deserialize: () => [9],
    });
    expect(decodeValue(grid, [3], decoder).value).toEqual([9]);
  });

  it("throws on a forged field kind", () => {
    expect(() => decodeValue(forgedField, 1, decoder)).toThrow(/IGX-1505/u);
  });
});

describe("decodeProps", () => {
  it("fills omitted props with defaults and reports undeclared ones", () => {
    const decoded = decodeProps(moverSchema, { speed: 9, nope: 1 }, decoder);
    expect(decoded.value.speed).toBe(9);
    expect(decoded.value.jumpHeight).toBe(2);
    expect(decoded.issues.map((found) => found.code)).toEqual(["IGX-0607"]);
  });
});

describe("round trips", () => {
  it("is byte-identical after one canonicalization pass", () => {
    const props = applyInit(createDefaults(moverSchema), moverSchema, {
      speed: 5.00000049,
      jumpHeight: -0,
      loops: 3,
      active: false,
      label: "hero",
      offset: { x: 0, y: 1.2345678, z: 0 },
      tint: { r: 1, g: 0.5, b: 0.25, a: 1 },
      mode: "run",
      target,
      follow,
      clip: fakeAssetHandle("audio/hit.wav", "audio") as never,
      waypoints: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      stats: { hp: 7, armor: 2 },
    });
    const encoded = encodeProps(moverSchema, props, encoder);
    const decoded = decodeProps(moverSchema, encoded, decoder);
    expect(decoded.issues).toEqual([]);
    const reencoded = encodeProps(moverSchema, decoded.value, encoder);
    expect(JSON.stringify(reencoded)).toBe(JSON.stringify(encoded));
  });

  it("round-trips every default", () => {
    const encoded = encodeProps(moverSchema, createDefaults(moverSchema), encoder);
    const decoded = decodeProps(moverSchema, encoded, decoder);
    expect(JSON.stringify(encodeProps(moverSchema, decoded.value, encoder))).toBe(JSON.stringify(encoded));
  });

  it("round-trips layer masks, curves, maps, and optionals", () => {
    const schema = {
      mask: layerMask(["Default"]),
      falloff: curve({ keys: [[0, 1, 0, 0]] }),
      ammo: map(i32()),
      nickname: optional(str()),
    };
    const props = applyInit(createDefaults(schema), schema, {
      mask: ["Player", "Enemy"],
      falloff: { keys: [[0, 1, 0, 0.5]] },
      ammo: { rockets: 2, arrows: 1 },
      nickname: "ace",
    });
    const encoded = encodeProps(schema, props, encoder);
    const decoded = decodeProps(schema, encoded, decoder);
    expect(JSON.stringify(encodeProps(schema, decoded.value, encoder))).toBe(JSON.stringify(encoded));
  });
});
