import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

describe("@ignifx/vite-plugin barrel", () => {
  it("exports the plugin factory and the config helper by name, with no default export", () => {
    expect(typeof barrel.ignifx).toBe("function");
    expect(typeof barrel.defineConfig).toBe("function");
    expect(Object.keys(barrel)).not.toContain("default");
  });

  it("exports every documented value", () => {
    expect(Object.keys(barrel).toSorted()).toEqual([
      "ASSET_CHANGED_EVENT",
      "ASSET_MANIFEST_FORMAT",
      "ASSET_MANIFEST_FORMAT_VERSION",
      "ASSET_TYPE_BY_EXTENSION",
      "ASSET_TYPE_BY_SUFFIX",
      "DEFAULT_ASSET_ROOT",
      "DEFAULT_ASSET_TYPE",
      "DEFAULT_HASH_LENGTH",
      "DEFAULT_MANIFEST_FILE_NAME",
      "DEFAULT_PUBLIC_PATH",
      "DEFAULT_SCRIPTS_PATTERN",
      "EXTENSION_KEYWORD",
      "IGNIFX_CONFIG_DEFINE_KEY",
      "IGNIFX_CONFIG_FILE_NAMES",
      "MANIFEST_MODULE_ID",
      "PLUGIN_NAME",
      "RESOLVED_MANIFEST_MODULE_ID",
      "RESOLVED_SCRIPTS_MODULE_ID",
      "SCRIPTS_HOT_RELOAD_EXPORT",
      "SCRIPTS_MODULE_ID",
      "VitePluginError",
      "VitePluginErrorCode",
      "addressFromRelativePath",
      "appendPointer",
      "assetTypeForAddress",
      "buildManifest",
      "collectExtensionPublicAssets",
      "defineConfig",
      "findIgnifxConfigFile",
      "formatValidationProblem",
      "hashedAddress",
      "ignifx",
      "isJsonArray",
      "isJsonObject",
      "isSidecarFileName",
      "jsonProperty",
      "loadIgnifxConfig",
      "manifestModuleSource",
      "normalizeScriptsPattern",
      "parseJsonValue",
      "requiresFormatHeader",
      "resolvePluginOptions",
      "resolveVirtualModuleId",
      "scanAssetRoot",
      "scriptsModuleSource",
      "serializeManifest",
      "splitAssetFileName",
      "validateJsonAsset",
      "validateJsonAssets",
      "validateJsonValue",
    ]);
  });

  it("allocates its error codes from the registered 05xx and 06xx ranges", () => {
    for (const code of Object.values(barrel.VitePluginErrorCode)) {
      expect(code).toMatch(/^IGX-0[56]\d\d$/u);
    }
  });

  it("pins the manifest entry contract @ignifx/core's assets service reads", () => {
    // `docs/architecture/05-assets-and-loading.md` §2/§7. The engine cannot import this package, so
    // the two declarations are kept in step by this list; changing it is a breaking change to the
    // manifest format and needs a `formatVersion` bump.
    const manifest = barrel.buildManifest(
      [
        {
          address: "a.png",
          filePath: "/p/a.png",
          bytes: 1,
          hash: "abcdef01",
          type: "texture",
          groups: ["boot"],
          meta: { texture: { srgb: true } },
        },
      ],
      "assets",
      (asset) => `/assets/${asset.address}`,
    );
    expect(Object.keys(manifest)).toEqual(["format", "formatVersion", "root", "entries"]);
    expect(Object.keys(manifest.entries[0] ?? {})).toEqual([
      "address",
      "url",
      "bytes",
      "hash",
      "type",
      "groups",
      "meta",
    ]);
  });
});
