/**
 * `@ignifx/core/prefab`: the scene-file and prefab helpers that need no renderer, so a tool such as
 * the editor's main process can apply or revert prefab overrides without loading Babylon Lite or
 * the rest of the engine. Every export here is also exported from `@ignifx/core`.
 *
 * @packageDocumentation
 */

export {
  applyOverridesToAsset,
  revertOverrides,
  type PrefabApplyOptions,
  type PrefabApplyResult,
  type PrefabComponentSkip,
  type PrefabOverrideSelection,
  type PrefabOverrideSkip,
} from "./serialization/prefab-overrides.js";
export { canonicalizeNumber } from "./schema/encode.js";
export {
  enumerateInstanceTargets,
  resolveInstancePath,
  type InstanceTarget,
  type PrefabReader,
} from "./serialization/instance-targets.js";
export { parseOverridePath, type EntityOverrideField, type OverridePath } from "./serialization/overrides.js";
export { computeSceneHash } from "./serialization/scene-asset.js";
export {
  isSceneFileHeader,
  SCENE_FILE_EXTENSIONS,
  SCENE_FILE_FORMAT,
  SCENE_FORMAT_VERSION,
  stringifySceneFile,
  type SceneFile,
  type SceneFileAssetRef,
  type SceneFileComponent,
  type SceneFileEntity,
  type SceneFileInstance,
  type SceneFileOverride,
  type SceneFileTransform,
} from "./serialization/scene-file.js";
export type { JsonArray, JsonObject, JsonValue } from "./schema/json.js";
