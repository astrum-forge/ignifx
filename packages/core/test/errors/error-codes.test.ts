/* eslint-disable ignifx/error-code-format -- The strings below are deliberately malformed or
   out-of-range codes: they are the negative test vectors for the validator itself. */
import { describe, expect, it } from "vitest";
import {
  CORE_ERROR_MESSAGES,
  CoreErrorCode,
  ErrorRange,
  isValidErrorCode,
  THIRD_PARTY_ERROR_PREFIX,
} from "../../src/errors/error-codes.js";

describe("error code table", () => {
  it("declares the fifteen subsystem ranges from the diagnostics architecture", () => {
    expect(Object.keys(ErrorRange)).toHaveLength(15);
    expect(ErrorRange.lifecycle).toBe("01");
    expect(ErrorRange.devtools).toBe("15");
  });

  it("reserves the leading digit nine for third-party extensions", () => {
    expect(THIRD_PARTY_ERROR_PREFIX).toBe("9");
  });

  it("gives every core code a message template", () => {
    for (const code of Object.values(CoreErrorCode)) {
      expect(CORE_ERROR_MESSAGES[code]).toBeTypeOf("string");
      expect(CORE_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it("has no message template that no code claims", () => {
    const codes = new Set<string>(Object.values(CoreErrorCode));
    for (const code of Object.keys(CORE_ERROR_MESSAGES)) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it("uses each code exactly once", () => {
    const codes = Object.values(CoreErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("re-homes the phase zero webgpu code into the rendering range", () => {
    expect(CoreErrorCode.webGpuUnavailable).toBe("IGX-0701");
    expect(CoreErrorCode.invalidRuntime).toBe("IGX-0702");
  });
});

describe("isValidErrorCode", () => {
  it("accepts every code the core owns", () => {
    for (const code of Object.values(CoreErrorCode)) {
      expect(isValidErrorCode(code)).toBe(true);
    }
  });

  it("accepts a code in the third-party range", () => {
    expect(isValidErrorCode("IGX-9042")).toBe(true);
  });

  it("rejects a range no subsystem owns", () => {
    expect(isValidErrorCode("IGX-1601")).toBe(false);
    expect(isValidErrorCode("IGX-0001")).toBe(false);
  });

  it("rejects a code of the wrong length", () => {
    expect(isValidErrorCode("IGX-101")).toBe(false);
    expect(isValidErrorCode("IGX-01011")).toBe(false);
  });

  it("rejects a code with the wrong prefix", () => {
    expect(isValidErrorCode("IGY-0101")).toBe(false);
  });

  it("rejects non-digits in the numeric part", () => {
    expect(isValidErrorCode("IGX-01A1")).toBe(false);
    expect(isValidErrorCode("IGX-0１01")).toBe(false);
  });
});
