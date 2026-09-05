import { describe, expect, it } from "vitest";
import { compositeIsVector, compositeParts, parseComposite } from "../../src/index.js";
import type { IgnifxError } from "@ignifx/core";

describe("composites", () => {
  it("names the parts of each composite in evaluation order", () => {
    expect(compositeParts("2DVector")).toEqual(["up", "down", "left", "right"]);
    expect(compositeParts("1DAxis")).toEqual(["negative", "positive"]);
    expect(compositeParts("ButtonWithModifier")).toEqual(["modifier", "button"]);
  });

  it("parses every documented composite name", () => {
    expect(parseComposite("2DVector")).toBe("2DVector");
    expect(parseComposite("1DAxis")).toBe("1DAxis");
    expect(parseComposite("ButtonWithModifier")).toBe("ButtonWithModifier");
  });

  it("rejects an unknown composite with IGX-0806", () => {
    let code = "";
    try {
      parseComposite("3DVector");
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0806");
  });

  it("reports which composites produce a vector", () => {
    expect(compositeIsVector("2DVector")).toBe(true);
    expect(compositeIsVector("1DAxis")).toBe(false);
    expect(compositeIsVector("ButtonWithModifier")).toBe(false);
  });
});
