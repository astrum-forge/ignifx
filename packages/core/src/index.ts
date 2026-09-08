/**
 * `@ignifx/core` public barrel. Explicit named re-exports only — no `export *`
 * (coding standards §4). Everything the adapter owns (`src/lite/**`) stays internal apart from the
 * two type aliases the `app.lite` escape hatch needs, and so does every `@internal` symbol the
 * kernel uses to talk to itself.
 *
 * @packageDocumentation
 */

// app — the root object, the frame phases, and the contracts extensions implement.
export { createApp, type AssetsCreateOptions, type CreateAppOptions } from "./app/app.js";
export {
  createServiceKey,
  PHASE_NAMES,
  PHASES,
  Phase,
  type App,
  type AppLiteHandles,
  type AppSettings,
  type Coroutine,
  type CoroutineHandle,
  type CoroutineHost,
  type CoroutineYield,
  type ErrorReport,
  type Extension,
  type ExtensionContext,
  type FrameState,
  type LayersSettings,
  type RegisterComponentOptions,
  type RegisterSystemOptions,
  type ServiceClassKey,
  type ServiceKey,
  type ServiceNameKey,
  type ServiceRegistry,
  type SortingLayersSettings,
  type System,
  type SystemContext,
  type Time,
  type TimeSettings,
  type WaitInstruction,
  type AppEvents,
  type DeviceLostInfo,
} from "./app/types.js";
export { VERSION } from "./app/version.js";

// assets — addressed, reference-counted, asynchronous loading (`app.assets`).
export { assetRef, isAssetRef } from "./assets/asset-ref.js";
export { ASSET_DIAGNOSTICS_COUNTERS, ASSET_DIAGNOSTICS_GROUP } from "./assets/assets-service.js";
export { binaryAssetLoader, jsonAssetLoader, textAssetLoader } from "./assets/generic-loaders.js";
export {
  ASSET_MANIFEST_FORMAT,
  ASSET_MANIFEST_VERSION,
  createAssetManifest,
  DEFAULT_ASSET_ROOT,
  EMPTY_ASSET_MANIFEST,
} from "./assets/manifest.js";
export { DEFAULT_ASSET_CONCURRENCY } from "./assets/request-queue.js";
export {
  AssetLoadError,
  type AssetHandle,
  type AssetLoader,
  type AssetLoadErrorOptions,
  type AssetManifest,
  type AssetManifestEntry,
  type AssetProgress,
  type AssetRef,
  type Assets,
  type AssetsSettings,
  type AssetState,
  type AssetTypeDefinition,
  type BatchHandle,
  type FetchLike,
  type LoaderContext,
  type LoadOptions,
  type RegisterAssetOptions,
} from "./assets/types.js";

// component — the base class, the registry, and the class metadata the engine derives once.
export {
  ComponentRegistry,
  type ComponentClassInfo,
  type ComponentReplacement,
  type ScriptClassInfo,
} from "./component/component-registry.js";
export type {
  ComponentInit,
  ComponentStatics,
  ComponentType,
  ConcreteComponentType,
  ScriptStatics,
} from "./component/component-type.js";
export { Component, type ComponentDefinition, type ComponentHooks } from "./component/component.js";

// coroutine — the wait instructions scripts yield live in `script/wait.ts`; the host is internal.

// diagnostics — per-frame counters and profiling scopes.
export { createDiagnosticsGroup, type DiagnosticsGroup } from "./diagnostics/diagnostics-group.js";
export {
  Diagnostics,
  FRAME_HISTORY_LENGTH,
  type DiagnosticsOptions,
  type ProfileScope,
} from "./diagnostics/diagnostics.js";
export {
  createFrameSample,
  PHASE_COUNT,
  resetFrameSample,
  type FrameSample,
  type PhaseIndex,
} from "./diagnostics/frame-sample.js";

// entity — the scene-graph node.
export { Entity, type EntityPrefabLink, type SetParentOptions } from "./entity/entity.js";

// errors — the code space, the error type, and the per-app code registry.
export {
  createErrorCodeRegistry,
  type ErrorCodeDescription,
  type ErrorCodeRegistry,
} from "./errors/error-code-registry.js";
export {
  CORE_ERROR_MESSAGES,
  CoreErrorCode,
  ErrorRange,
  isValidErrorCode,
  THIRD_PARTY_ERROR_PREFIX,
  type ErrorCode,
} from "./errors/error-codes.js";
export {
  assertNever,
  formatErrorMessage,
  IgnifxError,
  isIgnifxError,
  type ErrorContext,
  type ErrorFormatMode,
  type IgnifxErrorOptions,
} from "./errors/ignifx-error.js";

// extension — the factory helper and the implicit core extension.
export { coreExtension } from "./extension/core-extension.js";
export { defineExtension } from "./extension/define-extension.js";

// handles — dense runtime identifiers.
export { INVALID_HANDLE, type ComponentHandle, type EntityHandle } from "./handles/handle.js";

// hot-reload — the script and scene hot-reload contract (`app.hotReload`).
export type {
  HotReloadHost,
  HotReloadKind,
  HotReloadModule,
  HotReloadOptions,
  HotReloadPolicy,
  HotReloadReport,
  HotReloadStatics,
} from "./hot-reload/contract.js";

// ids — random sources and ULIDs.
export { createCryptoRandom, createSeededRandom, type RandomSource } from "./ids/random-source.js";
export { createUlidFactory, generateUlid, isUlid, MAX_ULID_TIME_MS, type UlidFactoryOptions } from "./ids/ulid.js";

// layers — the 32 layer slots and the masks built from them.
export { LayerMask } from "./layers/layer-mask.js";
export { createLayerTable, DEFAULT_LAYER, LayerTable, MAX_LAYERS, RESERVED_LAYER_NAMES } from "./layers/layer-table.js";

// lifecycle — the callback table and the physics callback names extensions dispatch by.
export { PhysicsCallbackName, ScriptCallbackKind } from "./lifecycle/callbacks.js";

// lite — the type aliases the `app.lite` and `component.lite` escape hatches name in their
// signatures. Nothing else crosses the boundary: these are handles, not an API.
export type { LiteCamera } from "./lite/camera.js";
export type { AdapterLight as LiteLight } from "./lite/light.js";
export type { LiteEngine, LiteScene } from "./lite/scene.js";
export type { LiteShadowGenerator } from "./lite/shadow.js";

// log — levels, the logger front end, and the sinks.
export { createConsoleSink, type ConsoleLike, type ConsoleSinkOptions } from "./log/console-sink.js";
export { LOG_LEVEL_SEVERITY, LogLevel, type LogRecord, type LogSink, type LogThreshold } from "./log/log-level.js";
export { createLogger, type Logger, type LoggerOptions } from "./log/logger.js";
export { createMemorySink, DEFAULT_MEMORY_SINK_LIMIT, type MemorySink } from "./log/memory-sink.js";

// math — vectors, quaternions, matrices, colours, and the scalar helpers.
export { Color } from "./math/color.js";
export { MAT4_IDENTITY, Mat4, type Mat4Elements } from "./math/mat4.js";
export {
  approximately,
  clamp,
  clamp01,
  DEG_TO_RAD,
  degToRad,
  deltaAngleDegrees,
  EPSILON,
  inverseLerp,
  lerp,
  lerpAngleDegrees,
  moveTowards,
  pingPong,
  RAD_TO_DEG,
  radToDeg,
  repeat,
  sign,
  smoothStep,
  wrapAngleDegrees,
} from "./math/math-utils.js";
export { QUAT_IDENTITY, Quat } from "./math/quat.js";
export type {
  ColorLike,
  Mat4Like,
  MutableQuat,
  MutableVec2,
  MutableVec3,
  MutableVec4,
  QuatLike,
  Vec2Like,
  Vec3Like,
  Vec4Like,
} from "./math/types.js";
export { VEC2_ONE, VEC2_ZERO, Vec2 } from "./math/vec2.js";
export {
  VEC3_BACKWARD,
  VEC3_DOWN,
  VEC3_FORWARD,
  VEC3_LEFT,
  VEC3_ONE,
  VEC3_RIGHT,
  VEC3_UP,
  VEC3_ZERO,
  Vec3,
} from "./math/vec3.js";
export { Vec4 } from "./math/vec4.js";

// platform — the host description and the WebGPU probe.
export {
  platformInternals,
  type GpuAdapterInfo,
  type PlatformInfo,
  type PlatformKind,
  type PlatformOs,
  type WebGpuInfo,
} from "./platform/platform.js";
export { isWebGpuAvailable, type RenderSurface } from "./platform/webgpu.js";

// render — the components, assets, loaders, and service that expose Babylon Lite's renderer.
export { Camera, createRay, type CameraProjection, type Ray, type RayVector } from "./render/camera.js";
export {
  ENVIRONMENT_ASSET_TYPE,
  ENVIRONMENT_FILE_EXTENSION,
  ENVIRONMENT_FILE_EXTENSIONS,
  ENVIRONMENT_FILE_FORMAT,
  ENVIRONMENT_FORMAT_VERSION,
  EnvironmentAsset,
  environmentDefinition,
  type EnvironmentAssetLiteHandles,
  type EnvironmentDefinition,
} from "./render/environment-asset.js";
export {
  Environment,
  type EnvironmentFogMode,
  type EnvironmentFogSettings,
  type EnvironmentSkyboxSettings,
  type ImageProcessingSettings,
  type ToneMappingCurve,
} from "./render/environment.js";
export { FONT_ASSET_TYPE, FONT_FILE_EXTENSIONS, FontAsset, type FontAssetLiteHandles } from "./render/font-asset.js";
export { Light, type LightShadowSettings, type LightType, type ShadowTechniqueName } from "./render/light.js";
export { createEnvironmentLoader } from "./render/loaders/environment-loader.js";
export { createFontLoader } from "./render/loaders/font-loader.js";
export { createMaterialLoader } from "./render/loaders/material-loader.js";
export { createModelLoader } from "./render/loaders/model-loader.js";
export { createTextureLoader } from "./render/loaders/texture-loader.js";
export {
  createMaterialAsset,
  MATERIAL_ASSET_TYPE,
  MATERIAL_FILE_EXTENSION,
  MATERIAL_FILE_FORMAT,
  MATERIAL_FORMAT_VERSION,
  MATERIAL_KINDS,
  MaterialAsset,
  PBR_TEXTURE_SLOTS,
  pbrMaterialDefinition,
  STANDARD_TEXTURE_SLOTS,
  standardMaterialDefinition,
  type MaterialAssetLiteHandles,
  type MaterialDefinition,
  type MaterialKind,
  type PbrMaterialDefinition,
  type StandardMaterialDefinition,
} from "./render/material-asset.js";
export {
  MESH_ASSET_TYPE,
  MeshAsset,
  type BoxMeshOptions,
  type CapsuleMeshOptions,
  type CylinderMeshOptions,
  type GroundMeshOptions,
  type MeshAssetLiteHandles,
  type MeshGeometryData,
  type PlaneMeshOptions,
  type SphereMeshOptions,
  type TorusMeshOptions,
} from "./render/mesh-asset.js";
export { MeshRenderer } from "./render/mesh-renderer.js";
export {
  MODEL_ASSET_TYPE,
  MODEL_FILE_EXTENSIONS,
  ModelAsset,
  type ModelAssetLiteHandles,
  type ModelInstantiation,
} from "./render/model-asset.js";
export { Model } from "./render/model.js";
export {
  PostProcessStack,
  type BloomEffectSettings,
  type ImageProcessingEffectSettings,
  type SmaaEffectSettings,
} from "./render/post-process-stack.js";
export {
  forceRendererDeviceLossForTesting,
  RENDER_DIAGNOSTICS_COUNTERS,
  RENDER_DIAGNOSTICS_GROUP,
  type RenderCapture,
  type Renderer,
  type RenderingFeature,
  type RenderPick,
  type RenderPickOptions,
  type RenderTaskTiming,
  type RenderTaskTimings,
} from "./render/renderer.js";
export {
  CANVAS_ALPHA_MODES,
  DEFAULT_BRDF_LUT_ADDRESS,
  defaultRenderingSettings,
  RENDERING_SETTINGS_SECTION,
  type CanvasAlphaMode,
  type RenderingFeatureSettings,
  type RenderingSettings,
} from "./render/rendering-settings.js";
export { describeEnvironmentFileFormat, describeMaterialFileFormat, describeSchemas } from "./render/schemas.js";
export {
  TEXTURE_ASSET_TYPE,
  TextureAsset,
  type TextureAssetLiteHandles,
  type TextureImportOptions,
} from "./render/texture-asset.js";

// scene — scene instances (`world.scenes`).
export { SceneInstance } from "./scene/scene-instance.js";

// serialization — the scene/prefab file format, its loader, and the round trip through it.
export {
  assertSceneDependenciesLoaded,
  instantiateScene,
  type InstantiateSceneOptions,
  type SceneBuildResult,
  type SceneLoadIssue,
} from "./serialization/load.js";
export { parseOverridePath, type EntityOverrideField, type OverridePath } from "./serialization/overrides.js";
export { computeSceneHash, createSceneAsset, type SceneAsset, SceneAssetToken } from "./serialization/scene-asset.js";
export {
  describeSceneFileFormat,
  isSceneFileHeader,
  SCENE_ASSET_TYPE,
  SCENE_FILE_EXTENSIONS,
  SCENE_FILE_FORMAT,
  SCENE_FORMAT_VERSION,
  sceneFileJsonSchema,
  stringifySceneFile,
  type SceneFile,
  type SceneFileAssetRef,
  type SceneFileComponent,
  type SceneFileEntity,
  type SceneFileInstance,
  type SceneFileOverride,
  type SceneFileTransform,
} from "./serialization/scene-file.js";
export { createSceneLoader, type SceneLoaderOptions } from "./serialization/scene-loader.js";
export {
  serializeComponent,
  serializeEntity,
  serializeScene,
  type SerializeIssue,
  type SerializeSceneOptions,
} from "./serialization/serialize.js";
export { UidRemap } from "./serialization/uid-remap.js";
export { validateSceneFile, type SceneFileIssue } from "./serialization/validate.js";

// schema — the declarative field system that replaces decorators (ADR-0004).
export {
  describeSchema,
  toJsonSchema,
  type JsonSchemaObject,
  type SchemaDescription,
  type SchemaDescriptionMeta,
  type SchemaFieldDescription,
} from "./schema/describe.js";
export {
  canonicalizeNumber,
  decodeProps,
  decodeValue,
  encodeProps,
  encodeValue,
  type DecodeResult,
  type ReferenceDecoder,
  type ReferenceEncoder,
} from "./schema/encode.js";
export {
  array,
  asset,
  bool,
  color,
  componentRef,
  curve,
  custom,
  entityRef,
  enumOf,
  f32,
  f64,
  i32,
  layerMask,
  map,
  optional,
  quat,
  record,
  str,
  u32,
  vec2,
  vec3,
  vec4,
} from "./schema/field-kinds.js";
export { SchemaIssueCode, type SchemaIssue } from "./schema/issues.js";
export type { JsonArray, JsonObject, JsonValue } from "./schema/json.js";
export { applyInit, createDefaults, defineSchema } from "./schema/schema.js";
export {
  FieldKind,
  type ArrayFieldSpec,
  type AssetFieldSpec,
  type AssetRefValue,
  type AssetTypeToken,
  type BoolFieldSpec,
  type ColorFieldSpec,
  type ComponentRefFieldSpec,
  type ComponentTypeToken,
  type CurveFieldSpec,
  type CurveKey,
  type CurveValue,
  type CustomFieldCodec,
  type CustomFieldSpec,
  type EntityRefFieldSpec,
  type EnumFieldSpec,
  type FieldDefinition,
  type FieldOptions,
  type FieldSpec,
  type FieldsOf,
  type LayerMaskFieldSpec,
  type MapFieldSpec,
  type NumberFieldSpec,
  type OptionalFieldSpec,
  type PartialFieldsOf,
  type RecordFieldSpec,
  type Schema,
  type StringFieldSpec,
  type VectorFieldSpec,
} from "./schema/types.js";
export { validateProps, validateValue } from "./schema/validate.js";

// script — the lifecycle-receiving component and the coroutine wait instructions.
export { Script, type ScriptCallbacks, type ScriptDefinition } from "./script/script.js";
export { waitFixedUpdate, waitSeconds, waitSecondsRealtime, waitUntil, waitWhile } from "./script/wait.js";

// settings — what a project hands `createApp`.
export type { SettingsInput } from "./settings/settings-input.js";

// signal — the observer primitive the whole engine communicates through.
export {
  Signal,
  type ConnectOptions,
  type DeferredQueue,
  type Disconnect,
  type SignalHandler,
  type SignalLike,
  type SignalOptions,
  type SignalOwner,
} from "./signal/signal.js";

// storage — `app.storage`, its backends, and the contract `@ignifx/electron` implements.
export type { StorageBackend, StoredValue, StoredValueKind } from "./storage/backend.js";
export { MemoryStorageBackend } from "./storage/memory-backend.js";
export { DEFAULT_STORAGE_NAMESPACE, NAMESPACE_SEGMENT_MAX_LENGTH, STORAGE_KEY_MAX_LENGTH } from "./storage/names.js";
export { createFileStorageBackend, type FileStorageOptions } from "./storage/node/file-backend.js";
export { storageInternals, type Storage } from "./storage/storage.js";
export { IndexedDbStorageBackend } from "./storage/web/indexeddb-backend.js";

// tags — the per-entity tag set behind `world.findByTag`.
export { TagSet } from "./tags/tag-set.js";

// time — the injectable clock behind `app.time.realtimeSinceStartup`.
export { createManualClock, createPerformanceClock, type Clock, type ManualClock } from "./time/clock.js";

// transform — the component every entity carries.
export { Transform } from "./transform/transform.js";

// tween — `app.tweens`, the property animator both toolkits use.
export { EASING_NAMES, EASINGS, resolveEase, type EasingFunction, type EasingName } from "./tween/easing.js";
export { Tween, TWEEN_LOOP_FOREVER, type TweenOptions } from "./tween/tween.js";
export { TWEEN_SYSTEM_ORDER } from "./tween/tween-system.js";
export { type TweenProps, type Tweens, type TweenTargetValue } from "./tween/tweens.js";
export { TWEEN_VALUE_KINDS, type TweenableValue, type TweenValueKind } from "./tween/channel.js";

// world — the running simulation.
export {
  World,
  type CreateEntityOptions,
  type InstantiateOptions,
  type LoadSceneOptions,
  type WorldLiteHandles,
} from "./world/world.js";

// Types and name tables referenced by public signatures (API Extractor ae-forgotten-export).
// The `Lite*` aliases are the unstable escape-hatch types (CONSTITUTION.md §3.4).
export type { LiteFont } from "./lite/font.js";
export type { LiteEnvironmentTextures } from "./lite/gpu/environment.js";
export type { LiteAnimationGroup, LiteAssetContainer, LiteSkeleton } from "./lite/gpu/gltf.js";
export type { LiteMesh } from "./lite/gpu/mesh.js";
export type { LiteTexture2D } from "./lite/gpu/texture.js";
export type { LiteMaterial, LitePbrMaterial, LiteStandardMaterial } from "./lite/material.js";
export type { LiteSceneNode } from "./lite/node.js";
export type { LoadProgress } from "./world/world.js";
export { TONE_MAPPING_NAMES } from "./lite/gpu/environment.js";
export { SHADOW_TECHNIQUES } from "./lite/shadow.js";
export { PROJECTIONS } from "./render/camera.js";
export { FOG_MODE_NAMES } from "./render/environment.js";
export { LIGHT_TYPES } from "./render/light.js";
export { MATERIAL_ALPHA_MODES, type MaterialAlphaMode } from "./lite/material.js";
