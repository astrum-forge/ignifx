import { describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import {
  DEFAULT_ASSET_ROOT,
  DEFAULT_MANIFEST_FILE_NAME,
  DEFAULT_PUBLIC_PATH,
  resolvePluginOptions,
} from "../src/options.js";

describe("resolvePluginOptions", () => {
  it("applies the documented defaults", () => {
    expect(resolvePluginOptions({})).toEqual({
      assetRoot: DEFAULT_ASSET_ROOT,
      publicPath: DEFAULT_PUBLIC_PATH,
      manifestFileName: DEFAULT_MANIFEST_FILE_NAME,
      configFile: null,
      validate: true,
      schemas: null,
      hashLength: 8,
      scriptsPattern: "/src/scripts/**/*.ts",
    });
  });

  it("adds the trailing slash publicPath needs and strips a leading one", () => {
    expect(resolvePluginOptions({ publicPath: "/static" }).publicPath).toBe("static/");
  });

  it("normalizes backslashes in publicPath", () => {
    expect(resolvePluginOptions({ publicPath: "static\\game" }).publicPath).toBe("static/game/");
  });

  it("keeps a nested manifest file name without a trailing slash", () => {
    expect(resolvePluginOptions({ manifestFileName: "meta/assets.json" }).manifestFileName).toBe("meta/assets.json");
  });

  it("keeps config: false distinct from an unset config", () => {
    expect(resolvePluginOptions({ config: false }).configFile).toBe(false);
    expect(resolvePluginOptions({ config: "./custom.config.ts" }).configFile).toBe("./custom.config.ts");
  });

  it("rewrites the scripts glob to be root-absolute", () => {
    expect(resolvePluginOptions({ scripts: "./game/*.ts" }).scriptsPattern).toBe("/game/*.ts");
  });

  it.each([
    ["a fractional hashLength", { hashLength: 8.5 }],
    ["a hashLength below 4", { hashLength: 3 }],
    ["a hashLength above 64", { hashLength: 65 }],
    ["an empty assetRoot", { assetRoot: "" }],
    ["an empty publicPath", { publicPath: "" }],
    ["a publicPath that escapes the output directory", { publicPath: "../outside" }],
    ["an empty manifestFileName", { manifestFileName: "/" }],
    ["an empty scripts glob", { scripts: "" }],
    ["a scripts glob that escapes the root", { scripts: "../elsewhere/*.ts" }],
  ])("rejects %s with IGX-0555", (_name, options) => {
    expect(() => resolvePluginOptions(options)).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidOption }),
    );
  });
});
