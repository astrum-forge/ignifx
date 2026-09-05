import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import {
  computeSceneHash,
  createSceneAsset,
  findSceneDependency,
  isSceneAsset,
} from "../../src/serialization/scene-asset.js";
import {
  describeSceneFileFormat,
  isSceneFileHeader,
  SCENE_ASSET_TYPE,
  SCENE_FILE_EXTENSIONS,
  SCENE_FILE_FORMAT,
  SCENE_FORMAT_VERSION,
  sceneFileJsonSchema,
  stringifySceneFile,
} from "../../src/serialization/scene-file.js";
import { validateSceneFile } from "../../src/serialization/validate.js";
import {
  Anonymous,
  Everything,
  Tagger,
  buildFile,
  createSerializationWorld,
  entityRecord,
  fakeHandle,
} from "./fixtures.js";
import type { JsonObject } from "../../src/schema/json.js";
import type { TestWorld } from "../support/create-test-world.js";

/** The file types, the generated JSON Schema, the structural validator, and the content hash. */

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

describe("constants and the header check", () => {
  it("names the one format levels and prefabs share", () => {
    expect(SCENE_FILE_FORMAT).toBe("ignifx.scene");
    expect(SCENE_FORMAT_VERSION).toBe(1);
    expect(SCENE_ASSET_TYPE).toBe("scene");
    expect([...SCENE_FILE_EXTENSIONS]).toEqual([".scene.json", ".prefab.json"]);
  });

  it("recognises the header and rejects everything else", () => {
    expect(isSceneFileHeader({ format: SCENE_FILE_FORMAT })).toBe(true);
    expect(isSceneFileHeader({ format: "ignifx.material" })).toBe(false);
    expect(isSceneFileHeader([])).toBe(false);
    expect(isSceneFileHeader(null)).toBe(false);
    expect(isSceneFileHeader("scene")).toBe(false);
  });
});

describe("sceneFileJsonSchema", () => {
  it("narrows props per registered component typeId, in a stable order", () => {
    const harness = world();
    const schema = sceneFileJsonSchema(harness.world.registry);
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    const component = (schema["$defs"] as JsonObject)["component"] as JsonObject;
    const branches = component["allOf"] as readonly JsonObject[];
    const ids = branches.map((branch) => ((branch["if"] as JsonObject)["properties"] as JsonObject)["type"]);
    expect(ids).toEqual([
      { const: "test/AwakeRecorder" },
      { const: "test/Everything" },
      { const: "test/Tagger" },
      { const: "test/Versioned" },
    ]);
    const everything = branches[1]?.["then"] as JsonObject;
    expect(((everything["properties"] as JsonObject)["props"] as JsonObject)["type"]).toBe("object");
  });

  it("is stable across calls", () => {
    const harness = world();
    expect(JSON.stringify(sceneFileJsonSchema(harness.world.registry))).toBe(
      JSON.stringify(sceneFileJsonSchema(harness.world.registry)),
    );
  });
});

describe("describeSceneFileFormat", () => {
  it("answers in the docs-harness shape", () => {
    const description = describeSceneFileFormat();
    expect(description.format).toBe(SCENE_FILE_FORMAT);
    expect(description.title).toBe("Scene file");
    expect(Object.keys(description.fields)).toEqual([
      "format",
      "formatVersion",
      "engineVersion",
      "name",
      "settings",
      "entities",
    ]);
    expect(description.fields["format"]?.default).toBe(SCENE_FILE_FORMAT);
  });
});

describe("validateSceneFile", () => {
  it("accepts a well-formed file", () => {
    const file = buildFile({
      entities: [
        entityRecord({
          uid: "A",
          active: false,
          static: true,
          layer: "Enemy",
          tags: ["x"],
          components: [{ uid: "C", type: "test/Tagger", enabled: false, schemaVersion: 2, props: {} }],
          instance: {
            scene: { $asset: "p.prefab.json" },
            hash: "sha256:0",
            overrides: [{ op: "remove", path: "P/components/Q" }],
          },
        }),
      ],
    });
    expect(validateSceneFile(file)).toEqual([]);
  });

  it("reports every structural problem it finds", () => {
    const issues = validateSceneFile({
      format: "other",
      formatVersion: 2,
      name: 7,
      settings: [],
      entities: [
        7,
        { uid: "", name: 1, parent: 5, active: 1, static: 1, layer: 2, tags: [1], transform: {}, components: 3 },
        {
          uid: "A",
          name: "A",
          parent: null,
          transform: { position: [0, 0], rotation: [0, 0, 0, 1], scale: [0, 0, Number.NaN] },
          instance: { scene: {}, hash: 1, overrides: [{}, { path: "p", op: "nope" }] },
          components: [7, { uid: "A", type: "", enabled: 1, schemaVersion: 0, props: [] }],
        },
        {
          uid: "B",
          name: "B",
          parent: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          instance: 7,
        },
      ],
    });
    const paths = issues.map((issue) => issue.path);
    expect(paths).toContain("format");
    expect(paths).toContain("formatVersion");
    expect(paths).toContain("name");
    expect(paths).toContain("settings");
    expect(paths).toContain("entities/0");
    expect(paths).toContain("entities/1/uid");
    expect(paths).toContain("entities/1/components");
    expect(paths).toContain("entities/2/transform/position");
    expect(paths).toContain("entities/2/transform/scale/2");
    expect(paths).toContain("entities/2/instance/scene");
    expect(paths).toContain("entities/2/instance/hash");
    expect(paths).toContain("entities/2/instance/overrides/0");
    expect(paths).toContain("entities/2/instance/overrides/1/op");
    expect(paths).toContain("entities/2/components/0");
    expect(paths).toContain("entities/2/components/1/uid");
    expect(paths).toContain("entities/3/instance");
  });

  it("rejects a value that is not an object, and a missing entity list", () => {
    expect(validateSceneFile([])[0]?.path).toBe("");
    expect(validateSceneFile({ format: SCENE_FILE_FORMAT, formatVersion: 1, name: "n" })[0]?.path).toBe("entities");
  });

  it("reports a duplicate uid and a bad tags list", () => {
    const issues = validateSceneFile(
      buildFile({ entities: [entityRecord({ uid: "A", tags: 3 as never }), entityRecord({ uid: "A" })] }),
    );
    expect(issues.map((issue) => issue.path)).toEqual(["entities/0/tags", "entities/1/uid"]);
  });
});

describe("computeSceneHash", () => {
  it("hashes the canonical text, so equal files hash equally", async () => {
    const file = buildFile({ entities: [entityRecord({ uid: "A" })] });
    const other = buildFile({ entities: [entityRecord({ uid: "B" })] });
    const hash = await computeSceneHash(file);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await computeSceneHash(file)).toBe(hash);
    expect(await computeSceneHash(other)).not.toBe(hash);
    expect(stringifySceneFile(file)).toContain('"format": "ignifx.scene"');
  });
});

describe("computeSceneHash without Web Crypto", () => {
  it("reports IGX-1420 rather than producing a wrong hash", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      await expect(computeSceneHash(buildFile({ entities: [] }))).rejects.toThrow(/Web Crypto/u);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", original);
      }
    }
  });
});

describe("scene assets", () => {
  it("carries the address, the file, the dependencies, and the hash", async () => {
    const prefab = await createSceneAsset("p.prefab.json", buildFile({ entities: [] }));
    const handle = fakeHandle("p.prefab.json", prefab);
    const level = await createSceneAsset("l.scene.json", buildFile({ entities: [] }), [handle]);
    expect(level.address).toBe("l.scene.json");
    expect(level.dependencies).toEqual([handle]);
    expect(findSceneDependency(level, "p.prefab.json")?.value).toBe(prefab);
    expect(findSceneDependency(level, "nope")).toBeNull();
  });

  it("ignores dependencies that are not loaded scenes", async () => {
    const level = await createSceneAsset("l.scene.json", buildFile({ entities: [] }), [
      { ...fakeHandle("a", { file: {}, hash: "x" }), state: "loading" },
      fakeHandle("b", 7),
      fakeHandle("c", null),
    ]);
    expect(findSceneDependency(level, "a")).toBeNull();
    expect(findSceneDependency(level, "b")).toBeNull();
    expect(findSceneDependency(level, "c")).toBeNull();
    expect(isSceneAsset(7)).toBe(false);
    expect(isSceneAsset(null)).toBe(false);
    expect(isSceneAsset({ hash: "x", file: {} })).toBe(true);
  });
});

describe("registry helpers the schema generator needs", () => {
  it("lists registered classes with their ids", () => {
    const harness = world();
    const ids = harness.world.registry.registrations().map(([typeId]) => typeId);
    expect(ids).toContain("test/Everything");
    expect(ids).toContain("test/Tagger");
    expect(harness.world.registry.get("test/Everything")).toBe(Everything);
    expect(harness.world.registry.get("test/Tagger")).toBe(Tagger);
  });

  it("throws IGX-0204 for a class without a typeId", () => {
    const harness = world();
    try {
      harness.world.registry.requireTypeId(Anonymous);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.componentTypeIdMissing);
    }
  });
});
