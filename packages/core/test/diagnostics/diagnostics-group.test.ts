import { describe, expect, it } from "vitest";
import { createDiagnosticsGroup } from "../../src/diagnostics/diagnostics-group.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";

describe("diagnostics group", () => {
  it("resolves counter names to indices in declaration order", () => {
    const group = createDiagnosticsGroup("render", ["drawCalls", "triangles"]);
    expect(group.name).toBe("render");
    expect(group.index("drawCalls")).toBe(0);
    expect(group.index("triangles")).toBe(1);
    expect(group.counterNames).toEqual(["drawCalls", "triangles"]);
  });

  it("starts every counter at zero", () => {
    const group = createDiagnosticsGroup("render", ["drawCalls"]);
    expect(group.get(group.index("drawCalls"))).toBe(0);
  });

  it("sets and adds by index", () => {
    const group = createDiagnosticsGroup("physics", ["bodies"]);
    const bodies = group.index("bodies");
    group.set(bodies, 10);
    group.add(bodies, 5);
    expect(group.get(bodies)).toBe(15);
  });

  it("zeroes every counter on reset", () => {
    const group = createDiagnosticsGroup("assets", ["loaded", "failed"]);
    group.set(group.index("loaded"), 3);
    group.set(group.index("failed"), 1);
    group.reset();
    expect(group.get(0)).toBe(0);
    expect(group.get(1)).toBe(0);
  });

  it("throws IGX-1504 for a counter that was never declared", () => {
    const group = createDiagnosticsGroup("render", ["drawCalls"]);
    try {
      group.index("gpuMs");
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unknownDiagnosticsCounter);
      expect(isIgnifxError(error) && error.context["group"]).toBe("render");
    }
  });

  it("ignores writes outside the counter range and reads them as zero", () => {
    const group = createDiagnosticsGroup("render", ["drawCalls"]);
    group.set(5, 1);
    group.add(-1, 1);
    expect(group.get(5)).toBe(0);
    expect(group.get(-1)).toBe(0);
  });

  it("copies the counter names so the caller cannot renumber them afterwards", () => {
    const names = ["drawCalls"];
    const group = createDiagnosticsGroup("render", names);
    names.push("triangles");
    expect(group.counterNames).toEqual(["drawCalls"]);
  });
});
