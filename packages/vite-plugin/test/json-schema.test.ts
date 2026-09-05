import { describe, expect, it } from "vitest";
import { VitePluginError, VitePluginErrorCode } from "../src/errors.js";
import { appendPointer, validateJsonValue } from "../src/json-schema.js";
import type { JsonSchemaObject } from "../src/json-schema.js";
import type { JsonValue } from "../src/json.js";

/**
 * Validates and returns the messages only, so that a case reads as "what is wrong", not as a
 * structural comparison.
 */
function problems(value: JsonValue, schema: JsonSchemaObject): string[] {
  return validateJsonValue(value, schema).map((violation) => `${violation.pointer}: ${violation.message}`);
}

describe("validateJsonValue — accepts", () => {
  it.each([
    ["a string against type string", "hello", { type: "string" }],
    ["a number against type number", 3.5, { type: "number" }],
    ["a whole number against type integer", 4, { type: "integer" }],
    ["null against type null", null, { type: "null" }],
    ["a value against a type union", 4, { type: ["string", "integer"] }],
    ["an object with every required property", { a: 1, b: 2 }, { type: "object", required: ["a", "b"] }],
    [
      "an object whose extra properties are allowed",
      { a: 1, extra: true },
      { type: "object", properties: { a: { type: "integer" } } },
    ],
    [
      "an object whose extra properties match additionalProperties",
      { a: 1, b: 2 },
      { type: "object", additionalProperties: { type: "integer" } },
    ],
    ["an array whose items match", [1, 2, 3], { type: "array", items: { type: "integer" } }],
    ["an array within minItems and maxItems", [1, 2], { type: "array", minItems: 1, maxItems: 3 }],
    ["a number within minimum and maximum", 5, { type: "number", minimum: 0, maximum: 10 }],
    ["a value in the enum", "b", { enum: ["a", "b"] }],
    ["a value equal to const", "ignifx.scene", { const: "ignifx.scene" }],
    ["a deeply equal array const", [1, [2, 3]], { const: [1, [2, 3]] }],
    ["a value matching exactly one oneOf branch", 3, { oneOf: [{ type: "integer" }, { type: "string" }] }],
    ["a value matching several anyOf branches", 3, { anyOf: [{ type: "integer" }, { type: "number" }] }],
    [
      "a $ref into $defs",
      { position: [1, 2, 3] },
      {
        type: "object",
        properties: { position: { $ref: "#/$defs/vec3" } },
        $defs: { vec3: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } },
      },
    ],
    ["an empty schema against anything", { anything: true }, {}],
  ] as const)("%s", (_name, value, schema) => {
    expect(problems(value, schema)).toEqual([]);
  });
});

describe("validateJsonValue — rejects", () => {
  it("a wrong primitive type", () => {
    expect(problems(1, { type: "string" })).toEqual([": expected type string but got number"]);
  });

  it("a fractional value against type integer", () => {
    expect(problems(1.5, { type: "integer" })).toEqual([": expected type integer but got number"]);
  });

  it("a missing required property, naming the property", () => {
    expect(problems({ a: 1 }, { type: "object", required: ["a", "b"] })).toEqual([': missing required property "b"']);
  });

  it("an extra property when additionalProperties is false", () => {
    expect(
      problems(
        { a: 1, rogue: 2 },
        { type: "object", properties: { a: { type: "integer" } }, additionalProperties: false },
      ),
    ).toEqual(['/rogue: property "rogue" is not allowed here']);
  });

  it("a property whose value has the wrong type, with a pointer to it", () => {
    expect(problems({ a: "no" }, { type: "object", properties: { a: { type: "integer" } } })).toEqual([
      "/a: expected type integer but got string",
    ]);
  });

  it("an array item, with a pointer to the index", () => {
    expect(problems([1, "two"], { type: "array", items: { type: "integer" } })).toEqual([
      "/1: expected type integer but got string",
    ]);
  });

  it("an array that is too short", () => {
    expect(problems([1], { type: "array", minItems: 2 })).toEqual([": expected at least 2 items but got 1"]);
  });

  it("an array that is too long", () => {
    expect(problems([1, 2, 3], { type: "array", maxItems: 2 })).toEqual([": expected at most 2 items but got 3"]);
  });

  it("a number below minimum", () => {
    expect(problems(-1, { minimum: 0 })).toEqual([": expected a value >= 0 but got -1"]);
  });

  it("a number above maximum", () => {
    expect(problems(11, { maximum: 10 })).toEqual([": expected a value <= 10 but got 11"]);
  });

  it("a value outside the enum", () => {
    expect(problems("c", { enum: ["a", "b"] })).toEqual([': expected one of "a", "b" but got "c"']);
  });

  it("a value unequal to const", () => {
    expect(problems("ignifx.prefab", { const: "ignifx.scene" })).toEqual([
      ': expected the constant "ignifx.scene" but got "ignifx.prefab"',
    ]);
  });

  it("a value matching no oneOf branch", () => {
    expect(problems(true, { oneOf: [{ type: "integer" }, { type: "string" }] })).toEqual([
      ': true matches none of the 2 "oneOf" branches',
    ]);
  });

  it("a value matching more than one oneOf branch", () => {
    expect(problems(3, { oneOf: [{ type: "integer" }, { type: "number" }] })).toEqual([
      ': 3 matches 2 "oneOf" branches; exactly one must match',
    ]);
  });

  it("a value matching no anyOf branch", () => {
    expect(problems("x", { anyOf: [{ type: "integer" }, { type: "boolean" }] })).toEqual([
      ': "x" matches none of the 2 "anyOf" branches',
    ]);
  });

  it("reports every problem in one pass rather than stopping at the first", () => {
    expect(
      problems(
        { a: "no", b: [1, "two"] },
        {
          type: "object",
          required: ["c"],
          properties: { a: { type: "integer" }, b: { type: "array", items: { type: "integer" } } },
        },
      ),
    ).toEqual([
      ': missing required property "c"',
      "/a: expected type integer but got string",
      "/b/1: expected type integer but got string",
    ]);
  });

  it("truncates a long value in the message", () => {
    const long = "x".repeat(200);
    const [message] = problems(long, { const: "short" });
    expect(message).toContain("…");
    expect(message?.length).toBeLessThan(140);
  });
});

describe("validateJsonValue — schema errors", () => {
  it("rejects an unimplemented keyword with IGX-0653", () => {
    expect(() => validateJsonValue(1, { type: "number", multipleOf: 2 })).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.unsupportedSchema }),
    );
  });

  it("rejects a $ref that is not a #/$defs/* target", () => {
    let thrown: unknown;
    try {
      validateJsonValue(1, { $ref: "https://example.com/schema.json" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(VitePluginError);
    expect((thrown as VitePluginError).message).toContain("#/$defs/");
  });

  it("rejects a $ref to a definition that does not exist", () => {
    expect(() => validateJsonValue(1, { $ref: "#/$defs/missing", $defs: {} })).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.unsupportedSchema }),
    );
  });

  it("gives up on a schema that recurses past maxDepth", () => {
    const schema: JsonSchemaObject = {
      $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } } } },
      $ref: "#/$defs/node",
    };
    let value: JsonValue = {};
    for (let depth = 0; depth < 20; depth += 1) {
      value = { child: value };
    }
    expect(() => validateJsonValue(value, schema, { maxDepth: 8 })).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.unsupportedSchema }),
    );
  });

  it("resolves $ref against an explicit root document", () => {
    const root: JsonSchemaObject = { $defs: { name: { type: "string" } } };
    expect(validateJsonValue(1, { $ref: "#/$defs/name" }, { root })).toEqual([
      { pointer: "", message: "expected type string but got number" },
    ]);
  });
});

describe("appendPointer", () => {
  it("appends a plain segment", () => {
    expect(appendPointer("", "entities")).toBe("/entities");
  });

  it("escapes ~ and / per RFC 6901", () => {
    expect(appendPointer("/a", "b/c~d")).toBe("/a/b~1c~0d");
  });
});
