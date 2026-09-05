import { describe, expect, expectTypeOf, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { array, bool, componentRef, entityRef, enumOf, f32, i32, str, vec3 } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { createTestWorld } from "../support/create-test-world.js";
import type { App } from "../../src/app/types.js";
import type { ConcreteComponentType, ScriptStatics } from "../../src/component/component-type.js";
import type { Entity } from "../../src/entity/entity.js";
import type { Vec3Like } from "../../src/math/types.js";

/** `docs/architecture/03-scripting-and-components.md` §3 and ADR-0004. */

/** A component covering the field kinds a typed base class has to project. */
class Mover extends Script.define({
  speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" }),
  loops: i32(1),
  active: bool(true),
  label: str(""),
  offset: vec3({ x: 0, y: 1, z: 0 }),
  mode: enumOf(["walk", "run"] as const, "walk"),
  waypoints: array(vec3()),
}) {
  static typeId = "test/Mover";

  /** Non-serialized runtime state is an ordinary field with a different name. */
  travelled = 0;
}

/** A plain component built with `Component.define`. */
class Config extends Component.define({ retries: i32(3) }) {
  static typeId = "test/Config";
}

describe("typing", () => {
  it("projects every schema field onto the instance with its runtime type", () => {
    expectTypeOf<Mover["speed"]>().toEqualTypeOf<number>();
    expectTypeOf<Mover["loops"]>().toEqualTypeOf<number>();
    expectTypeOf<Mover["active"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Mover["label"]>().toEqualTypeOf<string>();
    expectTypeOf<Mover["offset"]>().toEqualTypeOf<Vec3Like>();
    expectTypeOf<Mover["mode"]>().toEqualTypeOf<"walk" | "run">();
    expectTypeOf<Mover["waypoints"]>().toEqualTypeOf<Vec3Like[]>();
  });

  it("keeps a defined class a Component and a Script", () => {
    expectTypeOf<Mover>().toExtend<Script>();
    expectTypeOf<Mover>().toExtend<Component>();
    expectTypeOf<Config>().toExtend<Component>();
  });

  it("carries the schema on the class for the serializer and the inspector", () => {
    expect(Object.keys(Mover.schema)).toEqual(["speed", "loops", "active", "label", "offset", "mode", "waypoints"]);
    expect(Mover.schema.speed.options.tooltip).toBe("Units per second");
  });
});

describe("defaults", () => {
  it("applies a fresh default per instance", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const first = entity.addComponent(Mover);
    const second = entity.addComponent(Mover);
    expect(first.speed).toBe(5);
    expect(first.offset).toEqual({ x: 0, y: 1, z: 0 });
    expect(first.offset).not.toBe(second.offset);
    expect(first.waypoints).not.toBe(second.waypoints);
    harness.dispose();
  });

  it("leaves non-serialized fields to their own initialisers", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.addComponent(Mover).travelled).toBe(0);
    harness.dispose();
  });

  it("applies defaults to a plain Component.define class too", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.addComponent(Config).retries).toBe(3);
    expect(entity.addComponent(Config, { retries: 9 }).retries).toBe(9);
    harness.dispose();
  });
});

describe("init", () => {
  it("overwrites only the named fields", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const mover = entity.addComponent(Mover, { speed: 12, mode: "run" });
    expect(mover.speed).toBe(12);
    expect(mover.mode).toBe("run");
    expect(mover.loops).toBe(1);
    harness.dispose();
  });

  it("rejects a value outside the declared domain with IGX-0606", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => entity.addComponent(Mover, { speed: 500 })).toThrow(/IGX-0606/u);
    harness.dispose();
  });

  it("rejects a value of the wrong type with IGX-0605", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    // @ts-expect-error -- the schema declares `speed` as a number; the runtime check is the subject.
    expect(() => entity.addComponent(Mover, { speed: "fast" })).toThrow(/IGX-0605/u);
    harness.dispose();
  });

  it("rejects a name the schema does not declare with IGX-0607", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    // @ts-expect-error -- the schema has no `nope`; the runtime check is the subject.
    expect(() => entity.addComponent(Mover, { nope: 1 })).toThrow(/IGX-0607/u);
    harness.dispose();
  });
});

describe("reserved names", () => {
  it("refuses a schema field that would shadow a Component or Script member", () => {
    expect(() => Script.define({ enabled: bool(true) })).toThrow(/IGX-0607/u);
    expect(() => Script.define({ update: f32(0) })).toThrow(/IGX-0607/u);
    expect(() => Component.define({ entity: f32(0) })).toThrow(/IGX-0607/u);
  });
});

describe("reference fields", () => {
  it("declares entity and component references as nullable and defaults them to null", () => {
    const harness = createTestWorld();
    class Linker extends Script.define({ target: entityRef<Entity>(), config: componentRef(Config) }) {
      static typeId = "test/Linker";
    }
    const entity = harness.world.createEntity("entity");
    const linker = entity.addComponent(Linker);
    expectTypeOf<Linker["target"]>().toEqualTypeOf<Entity | null>();
    expectTypeOf<Linker["config"]>().toEqualTypeOf<Config | null>();
    expect(linker.target).toBeNull();
    expect(linker.config).toBeNull();
    harness.dispose();
  });
});

describe("statics without `override`", () => {
  it("accepts plain `static typeId` and `static executionOrder`, and registers the class", () => {
    // The subject is that this class body compiles under the package tsconfig, which turns on
    // `noImplicitOverride` (coding standards §3): the statics are structural
    // (`ComponentStatics`/`ScriptStatics`), not members of `Component`/`Script`, so neither line
    // needs an `override` modifier.
    class DemoMover extends Script.define({ speed: f32(1) }) {
      static typeId = "demo/Mover";
      static executionOrder = 5;
    }
    expectTypeOf<typeof DemoMover>().toExtend<ConcreteComponentType>();
    expectTypeOf<typeof DemoMover>().toExtend<ScriptStatics>();
    expectTypeOf<typeof DemoMover>().toExtend<Parameters<App["registerComponents"]>[0][number]>();

    const harness = createTestWorld();
    const app: App = harness.app;
    app.registerComponents([DemoMover]);
    const info = harness.world.registry.describe(DemoMover);
    expect(info.typeId).toBe("demo/Mover");
    expect(info.script?.executionOrder).toBe(5);
    expect(info.allowMultiple).toBe(true);
    expect(info.script?.updateWhenPaused).toBe(false);
    harness.dispose();
  });
});
