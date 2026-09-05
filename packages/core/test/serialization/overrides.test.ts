import { describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { applyOverrides, overrideOp, parseOverridePath } from "../../src/serialization/overrides.js";
import type { MutableSceneEntity, OverrideTarget } from "../../src/serialization/overrides.js";

/** The override path grammar and the patcher of `06-serialization-and-scene-format.md` §2. */

/** Builds a one-entity lookup with one component. */
function target(): { readonly data: MutableSceneEntity; readonly lookup: Map<string, OverrideTarget> } {
  const data: MutableSceneEntity = {
    uid: "R",
    name: "Root",
    parent: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    components: [
      {
        uid: "C",
        type: "test/Everything",
        props: { speed: 1, waypoints: [[0, 0, 0]], stats: { hp: 1, armor: 0 } },
      },
    ],
  };
  const lookup = new Map<string, OverrideTarget>([["R", { data, components: new Map([["C", "C"]]) }]]);
  return { data, lookup };
}

/** Collects the messages a patch reported. */
function run(overrides: Parameters<typeof applyOverrides>[0]): {
  readonly data: MutableSceneEntity;
  readonly messages: string[];
} {
  const { data, lookup } = target();
  const messages: string[] = [];
  applyOverrides(overrides, lookup, (message) => {
    messages.push(message);
  });
  return { data, messages };
}

describe("parseOverridePath", () => {
  it("parses every shape of the grammar", () => {
    expect(parseOverridePath("R")).toEqual({ kind: "entity", entity: "R" });
    expect(parseOverridePath("R/name")).toEqual({ kind: "entityField", entity: "R", field: "name" });
    expect(parseOverridePath("R/transform/scale")).toEqual({ kind: "transform", entity: "R", channel: "scale" });
    expect(parseOverridePath("R/components")).toEqual({ kind: "componentList", entity: "R" });
    expect(parseOverridePath("R/components/C")).toEqual({ kind: "component", entity: "R", component: "C" });
    expect(parseOverridePath("R/components/C/enabled")).toEqual({
      kind: "componentField",
      entity: "R",
      component: "C",
    });
    expect(parseOverridePath("R/components/C/props/a/b/0")).toEqual({
      kind: "prop",
      entity: "R",
      component: "C",
      steps: ["a", "b", "0"],
    });
  });

  it("rejects paths outside the grammar with IGX-0609", () => {
    for (const path of [
      "",
      "R/nope",
      "R/transform",
      "R/transform/x/y",
      "R/other/C",
      "R/components/",
      "R/components/C/x",
      "R/components/C/props",
    ]) {
      try {
        parseOverridePath(path);
        expect.unreachable(`"${path}" should not parse`);
      } catch (error) {
        expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.invalidOverridePath);
      }
    }
  });
});

describe("overrideOp", () => {
  it("defaults to replace", () => {
    expect(overrideOp({ path: "R/name", value: "x" })).toBe("replace");
    expect(overrideOp({ op: "remove", path: "R/components/C" })).toBe("remove");
  });
});

describe("applyOverrides", () => {
  it("replaces a nested prop through objects and arrays", () => {
    const { data } = run([
      { path: "R/components/C/props/stats/hp", value: 9 },
      { path: "R/components/C/props/waypoints/0", value: [1, 1, 1] },
    ]);
    expect(data.components[0]?.props).toEqual({
      speed: 1,
      waypoints: [[1, 1, 1]],
      stats: { hp: 9, armor: 0 },
    });
  });

  it("removes and adds inside a prop array", () => {
    const { data } = run([
      { op: "add", path: "R/components/C/props/waypoints/0", value: [2, 2, 2] },
      { op: "remove", path: "R/components/C/props/waypoints/1" },
    ]);
    expect(data.components[0]?.props?.["waypoints"]).toEqual([[2, 2, 2]]);
  });

  it("removes a prop key", () => {
    const { data } = run([{ op: "remove", path: "R/components/C/props/speed" }]);
    expect(data.components[0]?.props).not.toHaveProperty("speed");
  });

  it("patches every entity property", () => {
    const { data } = run([
      { path: "R/name", value: "Boss" },
      { path: "R/active", value: false },
      { path: "R/static", value: true },
      { path: "R/layer", value: "Enemy" },
      { path: "R/tags", value: ["a", 3] },
      { path: "R/transform/rotation", value: [0, 1, 0, 0] },
    ]);
    expect(data.name).toBe("Boss");
    expect(data.active).toBe(false);
    expect(data.static).toBe(true);
    expect(data.layer).toBe("Enemy");
    expect(data.tags).toEqual(["a"]);
    expect(data.transform.rotation).toEqual([0, 1, 0, 0]);
  });

  it("keeps the previous value when a patch has the wrong shape", () => {
    const { data, messages } = run([
      { path: "R/name", value: 7 },
      { path: "R/layer", value: 7 },
      { path: "R/tags", value: "x" },
      { path: "R/transform/position", value: "x" },
    ]);
    expect(data.name).toBe("Root");
    expect(data.layer).toBeUndefined();
    expect(data.tags).toBeUndefined();
    expect(data.transform.position).toEqual([0, 0, 0]);
    expect(messages).toHaveLength(1);
  });

  it("toggles a component's enabled flag", () => {
    const { data } = run([{ path: "R/components/C/enabled", value: false }]);
    expect(data.components[0]?.enabled).toBe(false);
  });

  it("reports the op mismatches and the paths that name nothing", () => {
    const { messages } = run([
      { path: "R" },
      { path: "R/components", value: 1 },
      { op: "add", path: "R/components", value: 1 },
      { path: "R/components/C" },
      { op: "remove", path: "R/components/GONE" },
      { path: "R/components/GONE/props/x", value: 1 },
      { path: "R/components/GONE/enabled", value: true },
      { path: "GHOST/name", value: "x" },
      { path: "R/components/C/props/speed/deeper", value: 1 },
      { path: "R/components/C/props/waypoints/x", value: 1 },
      { path: "R/components/C/props/waypoints/0/0/0", value: 1 },
    ]);
    expect(messages).toHaveLength(11);
  });

  it("adds a component with its optional fields", () => {
    const { data } = run([
      {
        op: "add",
        path: "R/components",
        value: { uid: "N", type: "test/Tagger", enabled: false, schemaVersion: 2, props: { note: "n" } },
      },
    ]);
    expect(data.components[1]).toEqual({
      uid: "N",
      type: "test/Tagger",
      enabled: false,
      schemaVersion: 2,
      props: { note: "n" },
    });
  });
});
