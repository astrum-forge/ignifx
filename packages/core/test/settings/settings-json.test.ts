import { describe, expect, it } from "vitest";
import {
  array,
  asset,
  Camera,
  color,
  componentRef,
  entityRef,
  f64,
  map,
  optional,
  record,
  str,
  TextureAsset,
  vec3,
} from "../../src/index.js";
import { settingsValueToJson } from "../../src/settings/settings-json.js";

/**
 * `settingsValueToJson` on values that do not have the field's shape: a settings file may hold
 * anything, and a value the field cannot describe is left out (`undefined`) rather than written.
 */

describe("settingsValueToJson with a value of the wrong shape", () => {
  it("leaves out a vector, colour, array, record or map that is not one", () => {
    expect(settingsValueToJson(vec3(), 3)).toBeUndefined();
    expect(settingsValueToJson(color(), "red")).toBeUndefined();
    expect(settingsValueToJson(array(str()), { length: 1 })).toBeUndefined();
    expect(settingsValueToJson(record({ name: str() }), [1])).toBeUndefined();
    expect(settingsValueToJson(map(f64()), null)).toBeUndefined();
  });

  it("writes null for an absent optional, reference or asset, and leaves out a live one", () => {
    expect(settingsValueToJson(optional(vec3()), null)).toBeNull();
    expect(settingsValueToJson(entityRef(), null)).toBeNull();
    expect(settingsValueToJson(componentRef(Camera), { live: true })).toBeUndefined();
    expect(settingsValueToJson(asset(TextureAsset), null)).toBeNull();
    expect(settingsValueToJson(asset(TextureAsset), 7)).toBeUndefined();
  });

  it("writes an asset by address, with its type only when it names one", () => {
    expect(settingsValueToJson(asset(TextureAsset), { address: "a.png" })).toEqual({ address: "a.png" });
    expect(settingsValueToJson(asset(TextureAsset), { address: "a.png", type: "texture" })).toEqual({
      address: "a.png",
      type: "texture",
    });
  });

  it("drops non-finite numbers and non-JSON values inside plain values", () => {
    expect(settingsValueToJson(f64(), Number.NaN)).toBeUndefined();
    expect(settingsValueToJson(f64(), () => 1)).toBeUndefined();
    expect(settingsValueToJson(str(), ["a", Number.POSITIVE_INFINITY, { b: undefined }])).toEqual(["a", null, {}]);
    expect(settingsValueToJson(record({ name: str() }), { name: Symbol("x") })).toEqual({});
  });
});
