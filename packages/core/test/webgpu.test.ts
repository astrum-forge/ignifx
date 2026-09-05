import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebGpuAvailable } from "../src/index.js";

describe("isWebGpuAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false when there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isWebGpuAvailable()).toBe(false);
  });

  it("is false when navigator exposes no gpu", () => {
    vi.stubGlobal("navigator", {});
    expect(isWebGpuAvailable()).toBe(false);
  });

  it("is true when navigator.gpu is present", () => {
    vi.stubGlobal("navigator", { gpu: {} });
    expect(isWebGpuAvailable()).toBe(true);
  });
});
