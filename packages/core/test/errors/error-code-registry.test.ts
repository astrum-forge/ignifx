/* eslint-disable ignifx/error-code-format -- `IGX-1601` below is a deliberately out-of-range code,
   used to prove the registry rejects it. */
import { describe, expect, it } from "vitest";
import { createErrorCodeRegistry } from "../../src/errors/error-code-registry.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";

describe("error code registry", () => {
  it("knows every core code out of the box", () => {
    const registry = createErrorCodeRegistry();
    expect(registry.isRegistered(CoreErrorCode.webGpuUnavailable)).toBe(true);
    expect(registry.describe(CoreErrorCode.webGpuUnavailable)?.message).toBe(
      "WebGPU is not available in this environment.",
    );
    expect(registry.describe(CoreErrorCode.webGpuUnavailable)?.owner).toBe("@ignifx/core");
  });

  it("returns null for a code nobody registered", () => {
    expect(createErrorCodeRegistry().describe("IGX-9999")).toBeNull();
    expect(createErrorCodeRegistry().isRegistered("IGX-9999")).toBe(false);
  });

  it("records the owner of codes an extension registers", () => {
    const registry = createErrorCodeRegistry();
    registry.register({ "IGX-9001": "The {thing} never spawned." }, "game/spawner");
    expect(registry.describe("IGX-9001")).toEqual({
      code: "IGX-9001",
      message: "The {thing} never spawned.",
      owner: "game/spawner",
    });
  });

  it("rejects a code that is not in a known range", () => {
    const registry = createErrorCodeRegistry();
    try {
      registry.register({ "IGX-1601": "nope" }, "game/spawner");
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.malformedErrorCode);
    }
  });

  it("rejects a second registration of the same code and names the first owner", () => {
    const registry = createErrorCodeRegistry();
    registry.register({ "IGX-9001": "first" }, "game/a");
    try {
      registry.register({ "IGX-9001": "second" }, "game/b");
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.duplicateErrorCode);
      expect(isIgnifxError(error) && error.context["existingOwner"]).toBe("game/a");
    }
  });

  it("rejects an extension trying to shadow a core code", () => {
    const registry = createErrorCodeRegistry();
    expect(() => registry.register({ "IGX-0701": "mine now" }, "game/rude")).toThrow(/IGX-1501/u);
  });

  it("keeps two registries independent so two apps can coexist", () => {
    const first = createErrorCodeRegistry();
    const second = createErrorCodeRegistry();
    first.register({ "IGX-9002": "only in the first app" }, "game/a");
    expect(second.isRegistered("IGX-9002")).toBe(false);
  });
});
