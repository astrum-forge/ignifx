import { describe, expect, it } from "vitest";
import { describeInputActionsFormat, describeInputSchemas, describeSchemas } from "../src/index.js";

describe("the documentation harness view", () => {
  it("describes the PlayerInput component and the inputactions file format", () => {
    const schemas = describeSchemas();
    expect(Object.keys(schemas)).toEqual(["ignifx/PlayerInput", "ignifx/inputactions-file"]);
    expect(schemas["ignifx/PlayerInput"]?.fields["deviceSlot"]?.default).toBe(0);
    expect(schemas["ignifx/PlayerInput"]?.format).toBe("components");
    expect(schemas["ignifx/inputactions-file"]?.format).toBe("ignifx.inputactions");
  });

  it("exposes the same records under the package-specific name", () => {
    expect(describeInputSchemas()).toEqual(describeSchemas());
  });

  it("describes the file's four top-level fields", () => {
    const description = describeInputActionsFormat();
    expect(Object.keys(description.fields)).toEqual(["format", "formatVersion", "controlSchemes", "maps"]);
    expect(description.fields["format"]?.default).toBe("ignifx.inputactions");
  });
});
