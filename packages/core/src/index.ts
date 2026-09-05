/**
 * `@ignifx/core` public barrel. Explicit named re-exports only — no `export *`
 * (coding standards §4). Everything the adapter owns (`src/lite/**`) stays internal apart from the
 * two type aliases the `app.lite` escape hatch needs, and so does every `@internal` symbol the
 * kernel uses to talk to itself.
 *
 * @packageDocumentation
 */

// app — the root object, the frame phases, and the contracts extensions implement.
export { createApp, type CreateAppOptions } from "./app/app.js";
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
} from "./app/types.js";
export { VERSION } from "./app/version.js";

// component — the base class, the registry, and the class metadata the engine derives once.
export { ComponentRegistry, type ComponentClassInfo, type ScriptClassInfo } from "./component/component-registry.js";
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
export { Entity, type SetParentOptions } from "./entity/entity.js";

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

// ids — random sources and ULIDs.
export { createCryptoRandom, createSeededRandom, type RandomSource } from "./ids/random-source.js";
export { createUlidFactory, generateUlid, isUlid, MAX_ULID_TIME_MS, type UlidFactoryOptions } from "./ids/ulid.js";

// layers — the 32 layer slots and the masks built from them.
export { LayerMask } from "./layers/layer-mask.js";
export {
  createLayerTable,
  DEFAULT_LAYER,
  isValidLayer,
  LayerTable,
  MAX_LAYERS,
  RESERVED_LAYER_NAMES,
} from "./layers/layer-table.js";

// lite — the two type aliases the `app.lite` escape hatch needs. Nothing else crosses the boundary.
export type { LiteEngine, LiteScene } from "./lite/scene.js";

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

// platform — the WebGPU probe and the minimal host description.
export type { PlatformInfo, PlatformKind } from "./platform/platform.js";
export { isWebGpuAvailable, type RenderSurface } from "./platform/webgpu.js";

// scene — scene instances (`world.scenes`).
export { SceneInstance } from "./scene/scene-instance.js";

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

// tags — the per-entity tag set behind `world.findByTag`.
export { TagSet } from "./tags/tag-set.js";

// time — the injectable clock behind `app.time.realtimeSinceStartup`.
export { createManualClock, createPerformanceClock, type Clock, type ManualClock } from "./time/clock.js";

// transform — the component every entity carries.
export { Transform } from "./transform/transform.js";

// world — the running simulation.
export { World, type CreateEntityOptions } from "./world/world.js";
