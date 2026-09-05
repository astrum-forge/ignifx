import { describe, expect, it } from "vitest";
import { isJsonArray, isJsonObject, jsonProperty, parseJsonValue } from "../src/json.js";

describe("isJsonObject", () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["s", false],
    [1, false],
    [true, false],
  ] as const)("narrows %j to %s", (value, expected) => {
    expect(isJsonObject(value)).toBe(expected);
  });
});

describe("isJsonArray", () => {
  it.each([
    [[], true],
    [[1, 2], true],
    [{}, false],
    [null, false],
    ["s", false],
  ] as const)("narrows %j to %s", (value, expected) => {
    expect(isJsonArray(value)).toBe(expected);
  });
});

describe("jsonProperty", () => {
  it("reads an own property", () => {
    expect(jsonProperty({ a: 1 }, "a")).toBe(1);
  });

  it("returns undefined for a missing property", () => {
    expect(jsonProperty({ a: 1 }, "b")).toBeUndefined();
  });

  it("never reaches the prototype chain", () => {
    expect(jsonProperty({}, "constructor")).toBeUndefined();
    expect(jsonProperty({}, "toString")).toBeUndefined();
  });
});

describe("parseJsonValue", () => {
  it("parses an object", () => {
    expect(parseJsonValue('{"a":[1,null,true]}')).toEqual({ a: [1, null, true] });
  });

  it("throws a SyntaxError on malformed input", () => {
    expect(() => parseJsonValue("{oops")).toThrow(SyntaxError);
  });
});
