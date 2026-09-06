import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebGpuAvailable } from "../../src/index.js";
import { detectPlatform } from "../../src/platform/platform.js";

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

  it("reports WebGPU as unavailable under Node", () => {
    expect(isWebGpuAvailable()).toBe(false);
  });
});

describe("detectPlatform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports node when there is no document", () => {
    expect(detectPlatform().kind).toBe("node");
  });

  it("reports browser when a document and a window are reachable", () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", {});
    expect(detectPlatform().kind).toBe("browser");
  });

  it("returns a mutable record, so `@ignifx/electron` can correct `kind`", () => {
    // Phase 1 froze the record; Phase 9 gave it `setKind`/`setWebGpu` behind `platformInternals`,
    // which `docs/architecture/14-platform-electron.md` §3 requires of the renderer extension.
    expect(Object.isFrozen(detectPlatform())).toBe(false);
  });
});
