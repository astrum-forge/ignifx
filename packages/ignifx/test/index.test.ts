import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

// The full value surface of @ignifx/core. Types carry no runtime key, so they are not listed.
const expectedExports = [
  "createHeadlessRuntime",
  "createRenderEngine",
  "disposeHeadlessRuntime",
  "disposeRenderEngine",
  "ErrorCode",
  "IgnifxError",
  "isWebGpuAvailable",
  "stepHeadless",
];

describe("ignifx barrel", () => {
  it("imports without executing anything and re-exports the whole @ignifx/core value surface", () => {
    // Compared as sets: the key order of a namespace object is not part of the contract.
    expect(new Set(Object.keys(barrel))).toEqual(new Set(expectedExports));
  });
});
