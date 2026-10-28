import { describe, expect, it } from "vitest";
import { CLIPPED_MARKER, clipHostText, hotReloadedParamsOf } from "../src/app-reports.js";
import { HOST_LIST_MAX_LENGTH, HOST_TEXT_MAX_LENGTH, isHotReloadedParams } from "../src/protocol/index.js";
import type { HotReloadReport } from "@ignifx/core";

/**
 * The caps `@ignifx/editor-protocol` puts on a host's reports (editor C6b): the editor drops a whole
 * report past one, so the host clips its strings and lists to them first.
 */

describe("clipHostText", () => {
  it("leaves a string at the cap alone", () => {
    const text = "a".repeat(HOST_TEXT_MAX_LENGTH);
    expect(clipHostText(text) === text).toBe(true);
  });

  it("cuts a longer string to the cap and marks the cut", () => {
    const clipped = clipHostText("a".repeat(HOST_TEXT_MAX_LENGTH + 1));
    expect(clipped).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(clipped.endsWith(`a${CLIPPED_MARKER}`)).toBe(true);
  });

  it("never splits a surrogate pair", () => {
    const keep = HOST_TEXT_MAX_LENGTH - CLIPPED_MARKER.length;
    // An emoji whose high half would be the last unit kept.
    const text = `${"a".repeat(keep - 1)}😀${"a".repeat(100)}`;
    const clipped = clipHostText(text);
    expect(clipped).toHaveLength(HOST_TEXT_MAX_LENGTH - 1);
    expect(clipped.endsWith(`a${CLIPPED_MARKER}`)).toBe(true);
  });
});

describe("hotReloadedParamsOf", () => {
  it("keeps a report past the caps within them, so the editor's guard accepts it", () => {
    const huge = "x".repeat(HOST_TEXT_MAX_LENGTH * 2);
    const error = new Error(huge);
    const report: HotReloadReport = {
      kind: "patch",
      typeIds: Array.from({ length: HOST_LIST_MAX_LENGTH + 5 }, (_, index) => `test/T${String(index)}`),
      instances: 0,
      durationMs: 1,
      errors: Array.from({ length: HOST_LIST_MAX_LENGTH + 1 }, () => error),
    };
    const params = hotReloadedParamsOf(report);
    expect(isHotReloadedParams(params)).toBe(true);
    expect(params.report.typeIds).toHaveLength(HOST_LIST_MAX_LENGTH);
    expect(params.report.errors).toHaveLength(HOST_LIST_MAX_LENGTH);
    const [first] = params.report.errors;
    expect(first?.message).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(first?.message.endsWith(CLIPPED_MARKER)).toBe(true);
    expect(first?.stack?.length).toBeLessThanOrEqual(HOST_TEXT_MAX_LENGTH);
    expect(first?.stack?.endsWith(CLIPPED_MARKER)).toBe(true);
  });
});
