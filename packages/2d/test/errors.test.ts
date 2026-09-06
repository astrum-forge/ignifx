import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { TWO_D_ERROR_MESSAGES, twoDError, TwoDErrorCode } from "../src/errors.js";

/**
 * The `IGX-11##` space is **shared** with `@ignifx/physics-2d`, which owns `IGX-1101`
 * (`docs/architecture/11-2d-toolkit.md` §8) and everything from `IGX-1130` up. This suite is what
 * keeps the two halves from colliding.
 */

/** The code `@ignifx/physics-2d` owns, which this package must never claim. */
const PHYSICS_2D_CODE = "IGX-1101";

describe("the code table", () => {
  const codes = Object.values(TwoDErrorCode);

  it("declares every code in the 2D subsystem range", () => {
    for (const code of codes) {
      expect(code).toMatch(/^IGX-11\d\d$/u);
    }
  });

  it("leaves IGX-1101 to @ignifx/physics-2d", () => {
    expect(codes).not.toContain(PHYSICS_2D_CODE);
    expect(Object.keys(TWO_D_ERROR_MESSAGES)).not.toContain(PHYSICS_2D_CODE);
  });

  it("stays inside the 1102-1129 block this package reserved", () => {
    for (const code of codes) {
      const numeric = Number.parseInt(code.slice("IGX".length + 1), 10);
      expect(numeric).toBeGreaterThanOrEqual(1102);
      expect(numeric).toBeLessThanOrEqual(1129);
    }
  });

  it("declares no code twice", () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has a message template for every code and no orphans", () => {
    expect(Object.keys(TWO_D_ERROR_MESSAGES).toSorted()).toEqual([...codes].toSorted());
  });

  it("writes context keys in braces, matching the core table", () => {
    for (const template of Object.values(TWO_D_ERROR_MESSAGES)) {
      expect(template.length).toBeGreaterThan(0);
      expect(template.endsWith(".")).toBe(true);
    }
  });
});

describe("twoDError", () => {
  it("builds an IgnifxError carrying the code, the context and the hint", () => {
    const error = twoDError(TwoDErrorCode.unknownFrame, "no such frame", {
      context: { atlas: "a.atlas.json", frame: "idle_0" },
      hint: "check the names",
    });
    expect(isIgnifxError(error)).toBe(true);
    expect(error.code).toBe("IGX-1106");
    expect(error.message).toContain("no such frame");
  });

  it("carries a cause when one is given", () => {
    const cause = new Error("underlying");
    const error = twoDError(TwoDErrorCode.invalidAtlasFile, "bad file", { cause });
    expect(error.cause).toBe(cause);
  });

  it("omits the optional fields when they are absent", () => {
    const error = twoDError(TwoDErrorCode.duplicateExtension, "twice");
    expect(error.code).toBe("IGX-1112");
    expect(error.cause).toBeUndefined();
  });
});
