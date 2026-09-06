/**
 * `@ignifx/vite-plugin` public barrel: asset manifest generation, scene and prefab JSON validation,
 * WASM and asset handling, and HMR hooks (`docs/architecture/00-overview.md` §2).
 *
 * The package depends on nothing from the engine — it is a build-time tool that produces the files
 * `@ignifx/core` consumes at runtime. Explicit named re-exports only, no `export *`
 * (coding standards §4), and no default export: the plugin is `ignifx`.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { ignifx } from "@ignifx/vite-plugin";
 *
 * export default defineConfig({ plugins: [ignifx()] });
 * ```
 *
 * @packageDocumentation
 */

export {
  ASSET_TYPE_BY_EXTENSION,
  ASSET_TYPE_BY_SUFFIX,
  assetTypeForAddress,
  DEFAULT_ASSET_TYPE,
  hashedAddress,
  isSidecarFileName,
  splitAssetFileName,
  type AssetType,
} from "./asset-types.js";
export { VitePluginError, VitePluginErrorCode } from "./errors.js";
export { collectExtensionPublicAssets, EXTENSION_KEYWORD, type ExtensionPublicAsset } from "./extension-assets.js";
export {
  defineConfig,
  findIgnifxConfigFile,
  IGNIFX_CONFIG_DEFINE_KEY,
  IGNIFX_CONFIG_FILE_NAMES,
  loadIgnifxConfig,
  type ResolvedIgnifxConfig,
} from "./ignifx-config.js";
export {
  appendPointer,
  validateJsonValue,
  type JsonSchemaObject,
  type SchemaViolation,
  type ValidateJsonOptions,
} from "./json-schema.js";
export {
  isJsonArray,
  isJsonObject,
  jsonProperty,
  parseJsonValue,
  type JsonArray,
  type JsonObject,
  type JsonValue,
} from "./json.js";
export {
  addressFromRelativePath,
  ASSET_MANIFEST_FORMAT,
  ASSET_MANIFEST_FORMAT_VERSION,
  buildManifest,
  DEFAULT_HASH_LENGTH,
  scanAssetRoot,
  serializeManifest,
  type AssetManifest,
  type AssetManifestEntry,
  type ScanAssetRootOptions,
  type ScannedAsset,
} from "./manifest.js";
export {
  DEFAULT_ASSET_ROOT,
  DEFAULT_MANIFEST_FILE_NAME,
  DEFAULT_PUBLIC_PATH,
  resolvePluginOptions,
  type IgnifxPluginOptions,
  type ResolvedIgnifxPluginOptions,
} from "./options.js";
export { ignifx, PLUGIN_NAME, type IgnifxPluginApi } from "./plugin.js";
export {
  formatValidationProblem,
  requiresFormatHeader,
  validateJsonAsset,
  validateJsonAssets,
  type FormatHeader,
  type JsonSchemaProvider,
  type ValidationProblem,
} from "./validate.js";
export {
  ASSET_CHANGED_EVENT,
  DEFAULT_SCRIPTS_PATTERN,
  MANIFEST_MODULE_ID,
  manifestModuleSource,
  normalizeScriptsPattern,
  RESOLVED_MANIFEST_MODULE_ID,
  RESOLVED_SCRIPTS_MODULE_ID,
  resolveVirtualModuleId,
  SCRIPTS_HOT_RELOAD_EXPORT,
  SCRIPTS_MODULE_ID,
  scriptsModuleSource,
  type AssetChangedPayload,
  type ScriptsModuleOptions,
} from "./virtual-modules.js";
