import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import { scanAssetRoot } from "../src/manifest.js";
import {
  formatValidationProblem,
  isFormatHeaderRequired,
  validateJsonAsset,
  validateJsonAssets,
} from "../src/validate.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, VALID_SCENE } from "./support/fixtures.js";
import type { JsonSchemaProvider } from "../src/validate.js";

afterAll(disposeFixtures);

/** A schema that pins the scene header and requires a name, enough to prove schemas are applied. */
const SCENE_SCHEMA: JsonSchemaProvider = {
  scene: {
    type: "object",
    required: ["format", "formatVersion", "name", "entities"],
    properties: {
      format: { const: "ignifx.scene" },
      formatVersion: { type: "integer", minimum: 1 },
      name: { type: "string" },
      entities: { type: "array", items: { type: "object", required: ["uid"] } },
    },
    additionalProperties: false,
  },
};

describe("isFormatHeaderRequired", () => {
  it.each([
    ["levels/a.scene.json", true],
    ["prefabs/a.prefab.json", true],
    ["materials/a.material.json", true],
    ["input/default.input.json", true],
    ["data/loot.json", false],
    ["sprites/hero.png", false],
  ] as const)("%s → %s", (address, expected) => {
    expect(isFormatHeaderRequired(address)).toBe(expected);
  });
});

describe("validateJsonAsset", () => {
  it("accepts a well-formed scene with no schema supplied", () => {
    expect(validateJsonAsset("a.scene.json", "/p/a.scene.json", VALID_SCENE, null)).toEqual([]);
  });

  it("reports IGX-0650 for unparseable JSON", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", "{oops", null);
    expect(problem?.code).toBe(VitePluginErrorCode.malformedJson);
    expect(problem?.pointer).toBe("");
  });

  it("reports IGX-0651 when a format-headed file has no header", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", "{}", null);
    expect(problem?.code).toBe(VitePluginErrorCode.missingFormatHeader);
    expect(problem?.message).toContain("formatVersion");
  });

  it("reports IGX-0651 when the document is not an object", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", "[]", null);
    expect(problem?.code).toBe(VitePluginErrorCode.missingFormatHeader);
  });

  it("reports IGX-0651 when format is present but formatVersion is missing", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", '{"format":"ignifx.scene"}', null);
    expect(problem?.message).toContain('"formatVersion" must be a positive integer');
  });

  it("reports IGX-0651 when format is not a string", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", '{"format":1,"formatVersion":1}', null);
    expect(problem?.message).toContain('"format" must be a non-empty string');
  });

  it("reports IGX-0651 when formatVersion is present but format is missing", () => {
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", '{"formatVersion":1}', null);
    expect(problem?.message).toContain('"format" must be a non-empty string');
  });

  it("reports IGX-0651 when formatVersion is not an integer", () => {
    const text = '{"format":"ignifx.scene","formatVersion":1.5}';
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", text, null);
    expect(problem?.message).toContain('"formatVersion" must be a positive integer');
  });

  it("reports IGX-0651 when formatVersion is zero", () => {
    const text = '{"format":"ignifx.scene","formatVersion":0}';
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", text, null);
    expect(problem?.message).toContain('"formatVersion" must be a positive integer');
  });

  it("leaves a plain .json file without a header alone", () => {
    expect(validateJsonAsset("data/loot.json", "/p/loot.json", '{"table":[]}', null)).toEqual([]);
  });

  it("still checks a plain .json file that declares a header of its own", () => {
    const text = '{"format":"","formatVersion":1}';
    const [problem] = validateJsonAsset("data/loot.json", "/p/loot.json", text, null);
    expect(problem?.code).toBe(VitePluginErrorCode.missingFormatHeader);
  });

  it("validates against the scene schema when one is supplied", () => {
    const text = JSON.stringify({ format: "ignifx.scene", formatVersion: 1, entities: [] });
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", text, SCENE_SCHEMA);
    expect(problem?.code).toBe(VitePluginErrorCode.schemaViolation);
    expect(problem?.message).toContain('missing required property "name"');
  });

  it("points at the offending entity with a JSON pointer", () => {
    const text = JSON.stringify({ format: "ignifx.scene", formatVersion: 1, name: "L", entities: [{}] });
    const [problem] = validateJsonAsset("a.scene.json", "/p/a.scene.json", text, SCENE_SCHEMA);
    expect(problem?.pointer).toBe("/entities/0");
  });

  it("applies a prefab file to the same scene schema", () => {
    const text = JSON.stringify({ format: "ignifx.scene", formatVersion: 1, entities: [] });
    expect(validateJsonAsset("a.prefab.json", "/p/a.prefab.json", text, SCENE_SCHEMA)).toHaveLength(1);
  });

  it("uses a schema keyed by format for a non-scene format", () => {
    const schemas: JsonSchemaProvider = {
      formats: { "ignifx.material": { type: "object", required: ["shader"] } },
    };
    const text = JSON.stringify({ format: "ignifx.material", formatVersion: 1 });
    const [problem] = validateJsonAsset("a.material.json", "/p/a.material.json", text, schemas);
    expect(problem?.message).toContain('missing required property "shader"');
  });

  it("skips schema validation for a format nothing covers", () => {
    const text = JSON.stringify({ format: "mygame.dialogue", formatVersion: 1 });
    expect(validateJsonAsset("a.dialogue.json", "/p/a.dialogue.json", text, SCENE_SCHEMA)).toEqual([]);
  });
});

describe("validateJsonAssets", () => {
  it("checks every JSON asset in a tree and ignores the rest", async () => {
    const root = await createFixtureTree({
      "assets/sprites/hero.png": PNG_BYTES,
      "assets/levels/good.scene.json": VALID_SCENE,
      "assets/levels/bad.scene.json": "{}",
      "assets/data/loot.json": '{"table":[]}',
    });
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    const problems = await validateJsonAssets(assets, null);
    expect(problems.map((problem) => problem.address)).toEqual(["levels/bad.scene.json"]);
  });
});

describe("formatValidationProblem", () => {
  it("renders address, pointer, message, and code", () => {
    expect(
      formatValidationProblem({
        address: "levels/a.scene.json",
        filePath: "/p/levels/a.scene.json",
        pointer: "/entities/0",
        message: 'missing required property "uid"',
        code: VitePluginErrorCode.schemaViolation,
      }),
    ).toBe('levels/a.scene.json /entities/0: missing required property "uid" (IGX-0652)');
  });

  it("omits the pointer when the problem is about the document", () => {
    expect(
      formatValidationProblem({
        address: "a.scene.json",
        filePath: "/p/a.scene.json",
        pointer: "",
        message: "is not valid JSON",
        code: VitePluginErrorCode.malformedJson,
      }),
    ).toBe("a.scene.json: is not valid JSON (IGX-0650)");
  });
});
