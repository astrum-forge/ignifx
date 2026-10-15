import { afterEach, describe, expect, it } from "vitest";
import { ComponentRegistry } from "../../src/component/component-registry.js";
import { Component, createApp, createManualClock, createMemorySink, describeSchemas } from "../../src/index.js";
import { describeRegisteredSchemas } from "../../src/schema/describe-registry.js";
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
  vec3,
  vec4,
} from "../../src/schema/field-kinds.js";
import { AudioClip, Camera } from "./mover-fixture.js";
import type { App } from "../../src/index.js";
import type { JsonObject } from "../../src/schema/json.js";
import type { FieldOptions } from "../../src/schema/types.js";

/**
 * Engine ask E19: the descriptions `describeSchema`, `describeRegisteredSchemas` and `toJsonSchema`
 * publish carry every piece of inspector metadata the declarations hold, so an inspector outside
 * the engine (the ignifx editor) can honour it.
 */

/** Every inspector option, declared at once. */
const ALL: FieldOptions = {
  tooltip: "Help",
  min: 0,
  max: 10,
  step: 0.5,
  hidden: true,
  readonly: true,
  group: "Tuning",
  transient: true,
};

/** How {@link ALL} reads on a field description. */
const DESCRIBED_ALL = {
  description: "Help",
  min: 0,
  max: 10,
  step: 0.5,
  hidden: true,
  readonly: true,
  group: "Tuning",
  transient: true,
};

/** A component class token that carries a type id. */
class Target extends Component.define({}) {
  static typeId = "mygame/Target";
}

/** One field of every kind, each declaring every option. */
const everyKind = {
  f32: f32(1, ALL),
  f64: f64(2, ALL),
  i32: i32(3, ALL),
  u32: u32(4, ALL),
  bool: bool(true, ALL),
  str: str("s", ALL),
  vec2: vec2({ x: 1, y: 2 }, ALL),
  vec3: vec3({ x: 1, y: 2, z: 3 }, ALL),
  vec4: vec4({ x: 1, y: 2, z: 3, w: 4 }, ALL),
  quat: quat(undefined, ALL),
  color: color("#ff0000", ALL),
  enum: enumOf(["walk", "run"] as const, "run", ALL),
  entityRef: entityRef(ALL),
  componentRef: componentRef(Target, ALL),
  untypedRef: componentRef(Camera, ALL),
  asset: asset(AudioClip, ALL),
  untypedAsset: asset({}, ALL),
  array: array(f32(0.5, { step: 0.25 }), [1, 2], ALL),
  record: record({ hp: i32(10, { min: 0, group: "Stats" }) }, ALL),
  map: map(str("x", { tooltip: "Value" }), ALL),
  optional: optional(asset(AudioClip), ALL),
  layerMask: layerMask(["default"], ALL),
  curve: curve({ keys: [[0, 1, 0, 0]] }, ALL),
  custom: custom(
    {
      createDefault: () => 7,
      serialize: (value: number) => value,
      deserialize: () => 7,
      jsonSchema: { type: "integer" },
    },
    ALL,
  ),
};

/**
 * Reads one property fragment out of a generated object schema.
 *
 * @param schema - The object schema.
 * @param name - The property.
 * @returns Its fragment.
 */
function propertyOf(schema: JsonObject, name: string): JsonObject {
  const properties = schema["properties"] as JsonObject;
  return properties[name] as JsonObject;
}

describe("describeSchema: inspector metadata", () => {
  const fields = describeSchema("mygame/EveryKind", everyKind).fields;

  it("describes the numeric kinds with every option", () => {
    expect(fields["f32"]).toEqual({ kind: "f32", default: 1, ...DESCRIBED_ALL });
    expect(fields["f64"]).toEqual({ kind: "f64", default: 2, ...DESCRIBED_ALL });
    expect(fields["i32"]).toEqual({ kind: "i32", default: 3, ...DESCRIBED_ALL });
    expect(fields["u32"]).toEqual({ kind: "u32", default: 4, ...DESCRIBED_ALL });
  });

  it("describes the scalar, vector, and colour kinds with every option", () => {
    expect(fields["bool"]).toEqual({ kind: "bool", default: true, ...DESCRIBED_ALL });
    expect(fields["str"]).toEqual({ kind: "str", default: "s", ...DESCRIBED_ALL });
    expect(fields["vec2"]).toEqual({ kind: "vec2", default: [1, 2], ...DESCRIBED_ALL });
    expect(fields["vec3"]).toEqual({ kind: "vec3", default: [1, 2, 3], ...DESCRIBED_ALL });
    expect(fields["vec4"]).toEqual({ kind: "vec4", default: [1, 2, 3, 4], ...DESCRIBED_ALL });
    expect(fields["quat"]).toEqual({ kind: "quat", default: [0, 0, 0, 1], ...DESCRIBED_ALL });
    expect(fields["color"]).toEqual({ kind: "color", default: [1, 0, 0, 1], ...DESCRIBED_ALL });
  });

  it("lists an enum's values in declaration order", () => {
    expect(fields["enum"]).toEqual({ kind: "enum", default: "run", ...DESCRIBED_ALL, values: ["walk", "run"] });
  });

  it("describes references with the type they accept", () => {
    expect(fields["entityRef"]).toEqual({ kind: "entityRef", default: null, ...DESCRIBED_ALL });
    expect(fields["componentRef"]).toEqual({
      kind: "componentRef",
      default: null,
      ...DESCRIBED_ALL,
      componentType: "mygame/Target",
    });
    expect(fields["untypedRef"]).toEqual({
      kind: "componentRef",
      default: null,
      ...DESCRIBED_ALL,
      componentType: null,
    });
    expect(fields["asset"]).toEqual({ kind: "asset", default: null, ...DESCRIBED_ALL, assetType: "audio" });
    expect(fields["untypedAsset"]).toEqual({ kind: "asset", default: null, ...DESCRIBED_ALL });
  });

  it("describes nested fields the same way", () => {
    expect(fields["array"]).toEqual({
      kind: "array",
      default: [1, 2],
      ...DESCRIBED_ALL,
      item: { kind: "f32", default: 0.5, step: 0.25 },
    });
    expect(fields["record"]).toEqual({
      kind: "record",
      default: { hp: 10 },
      ...DESCRIBED_ALL,
      fields: { hp: { kind: "i32", default: 10, min: 0, group: "Stats" } },
    });
    expect(fields["map"]).toEqual({
      kind: "map",
      default: {},
      ...DESCRIBED_ALL,
      value: { kind: "str", default: "x", description: "Value" },
    });
    expect(fields["optional"]).toEqual({
      kind: "optional",
      default: null,
      ...DESCRIBED_ALL,
      inner: { kind: "asset", default: null, assetType: "audio" },
    });
  });

  it("describes the remaining kinds with every option", () => {
    expect(fields["layerMask"]).toEqual({ kind: "layerMask", default: ["default"], ...DESCRIBED_ALL });
    expect(fields["curve"]).toEqual({ kind: "curve", default: { keys: [[0, 1, 0, 0]] }, ...DESCRIBED_ALL });
    expect(fields["custom"]).toEqual({ kind: "custom", default: 7, ...DESCRIBED_ALL });
  });

  it("leaves out every option a field does not declare", () => {
    expect(describeSchema("mygame/Bare", { speed: f32(5) }).fields["speed"]).toEqual({ kind: "f32", default: 5 });
  });

  it("copies an explicit false", () => {
    const described = describeSchema("mygame/Shown", { speed: f32(5, { hidden: false, readonly: false }) });
    expect(described.fields["speed"]).toEqual({ kind: "f32", default: 5, hidden: false, readonly: false });
  });

  it("carries allowMultiple and package only when the caller gives them", () => {
    const bare = describeSchema("mygame/Bare", {});
    expect(Object.hasOwn(bare, "allowMultiple")).toBe(false);
    expect(Object.hasOwn(bare, "package")).toBe(false);
    const given = describeSchema("mygame/Bare", {}, { allowMultiple: false, package: "mygame" });
    expect(given).toMatchObject({ allowMultiple: false, package: "mygame" });
  });
});

describe("toJsonSchema: inspector keywords", () => {
  const schema = toJsonSchema(everyKind);

  it("writes every option as an x-ignifx keyword next to the standard annotations", () => {
    expect(propertyOf(schema, "f32")).toEqual({
      type: "number",
      description: "Help",
      minimum: 0,
      maximum: 10,
      default: 1,
      readOnly: true,
      "x-ignifx-step": 0.5,
      "x-ignifx-hidden": true,
      "x-ignifx-readonly": true,
      "x-ignifx-group": "Tuning",
      "x-ignifx-transient": true,
    });
  });

  it("names the accepted asset and component types", () => {
    expect(propertyOf(schema, "asset")["x-ignifx-asset-type"]).toBe("audio");
    expect(propertyOf(schema, "componentRef")["x-ignifx-component-type"]).toBe("mygame/Target");
    expect(Object.hasOwn(propertyOf(schema, "untypedAsset"), "x-ignifx-asset-type")).toBe(false);
    expect(Object.hasOwn(propertyOf(schema, "untypedRef"), "x-ignifx-component-type")).toBe(false);
  });

  it("annotates nested fields too", () => {
    expect(propertyOf(schema, "array")["items"]).toEqual({ type: "number", "x-ignifx-step": 0.25 });
    const inner = (propertyOf(schema, "optional")["oneOf"] as readonly JsonObject[])[0];
    expect(inner?.["x-ignifx-asset-type"]).toBe("audio");
    expect(propertyOf(propertyOf(schema, "record"), "hp")["x-ignifx-group"]).toBe("Stats");
  });

  it("adds nothing to a field that declares no option", () => {
    expect(propertyOf(toJsonSchema({ speed: f32(5) }), "speed")).toEqual({ type: "number", default: 5 });
  });

  it("writes readOnly only for a read-only field", () => {
    const fragment = propertyOf(toJsonSchema({ speed: f32(5, { readonly: false }) }), "speed");
    expect(fragment["x-ignifx-readonly"]).toBe(false);
    expect(Object.hasOwn(fragment, "readOnly")).toBe(false);
  });
});

describe("ComponentRegistry.registrarOf", () => {
  class First extends Component.define({}) {
    static typeId = "acme/First";
  }

  class Replacement extends Component.define({}) {
    static typeId = "acme/First";
  }

  it("keeps the first registrar of an id, across a hot-reload replace", () => {
    const registry = new ComponentRegistry();
    registry.register(First, undefined, "@acme/one");
    registry.register(First, undefined, "@acme/two");
    expect(registry.registrarOf("acme/First")).toBe("@acme/one");
    registry.replace(Replacement);
    expect(registry.registrarOf("acme/First")).toBe("@acme/one");
  });

  it("answers null for an id registered without one, or not registered", () => {
    const registry = new ComponentRegistry();
    registry.registerAll([First]);
    expect(registry.registrarOf("acme/First")).toBeNull();
    expect(registry.registrarOf("acme/Missing")).toBeNull();
  });
});

describe("describeRegisteredSchemas", () => {
  class Beacon extends Component.define({ range: f32(5, { step: 0.5, group: "Light" }) }) {
    static typeId = "acme/Beacon";
    static allowMultiple = false;
  }

  class Note extends Component.define({ text: str("") }) {
    static typeId = "mygame/notes/Note";
  }

  let app: App | null = null;

  afterEach(() => {
    app?.dispose();
    app = null;
  });

  it("adds allowMultiple and the registering package to every registered component", async () => {
    app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [{ name: "@acme/beacons", version: "1.0.0", register: (ctx) => ctx.registerComponents([Beacon]) }],
    });
    app.registerComponents([Note]);
    const described = describeRegisteredSchemas(app.world.registry, describeSchemas());
    expect(described["ignifx/Camera"]).toMatchObject({
      title: "Camera",
      format: "components",
      description: describeSchemas()["ignifx/Camera"]?.description,
      allowMultiple: false,
      package: "@ignifx/core",
    });
    expect(described["ignifx/MeshRenderer"]).toMatchObject({ allowMultiple: true, package: "@ignifx/core" });
    expect(described["acme/Beacon"]).toEqual({
      title: "Beacon",
      format: "components",
      fields: { range: { kind: "f32", default: 5, step: 0.5, group: "Light" } },
      allowMultiple: false,
      package: "@acme/beacons",
    });
    // Registered by the game, not an extension: the package is the type id's namespace.
    expect(described["mygame/notes/Note"]).toMatchObject({ allowMultiple: true, package: "mygame/notes" });
    // File formats are not registered components.
    expect(described["ignifx/scene-file"]).toBeUndefined();
  });

  it("works on a bare registry", () => {
    const registry = new ComponentRegistry();
    registry.register(Note);
    expect(describeRegisteredSchemas(registry)).toEqual({
      "mygame/notes/Note": {
        title: "Note",
        format: "components",
        fields: { text: { kind: "str", default: "" } },
        allowMultiple: true,
        package: "mygame/notes",
      },
    });
  });
});
