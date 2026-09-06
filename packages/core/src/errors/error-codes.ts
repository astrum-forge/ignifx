/**
 * The error code registry data: the subsystem ranges from
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, the codes `@ignifx/core` itself owns, and
 * the format rule every code must satisfy.
 *
 * This module is pure data plus one predicate; it imports nothing, which is what lets
 * {@link IgnifxError} depend on it without a cycle (coding standards §4).
 */

/**
 * The two-digit prefix each subsystem owns inside the `IGX-####` space
 * (`docs/architecture/15-devtools-and-diagnostics.md` §1). A code is the prefix followed by a
 * two-digit ordinal, so `rendering` owns `IGX-0700` through `IGX-0799`.
 *
 * @example
 * ```ts
 * const code = `IGX-${ErrorRange.rendering}01` satisfies ErrorCode; // "IGX-0701"
 * ```
 *
 * @public
 */
export const ErrorRange = {
  /** App lifecycle, phases, time, coroutines, destruction. */
  lifecycle: "01",
  /** Components, scripts, and their registration. */
  components: "02",
  /** Scenes, scene instances, layers. */
  scenes: "03",
  /** The extension host and its contract. */
  extensions: "04",
  /** Asset handles, loaders, and caching. */
  assets: "05",
  /** Schemas, scene/prefab JSON, references. */
  serialization: "06",
  /** The renderer and the Babylon Lite adapter. */
  rendering: "07",
  /** Input devices, actions, and bindings. */
  input: "08",
  /** 3D physics. */
  physics: "09",
  /** Audio buses, sources, and clips. */
  audio: "10",
  /** The 2D toolkit. */
  twoD: "11",
  /** The 3D toolkit. */
  threeD: "12",
  /** The UI overlay. */
  ui: "13",
  /** Platform integration (browser, Electron). */
  platform: "14",
  /** Devtools, logging, and diagnostics. */
  devtools: "15",
} as const;

/**
 * The union of the two-digit subsystem prefixes declared by `ErrorRange`.
 *
 * @public
 */
export type ErrorRange = (typeof ErrorRange)[keyof typeof ErrorRange];

/**
 * The first digit of the range reserved for extensions published outside the `@ignifx` scope
 * (`IGX-9000` through `IGX-9999`). First-party subsystems never allocate here.
 *
 * @public
 */
export const THIRD_PARTY_ERROR_PREFIX = "9";

/**
 * The shape of every ignifx diagnostic code: the literal `IGX-` followed by four digits.
 *
 * @remarks
 * The template literal is the widest useful type; it accepts strings such as `"IGX-1"` that are not
 * real codes. {@link isValidErrorCode} is the runtime check, `CoreErrorCode` is the narrowed
 * string-literal union for the codes this package owns, and extensions narrow their own the same
 * way.
 *
 * @public
 */
export type ErrorCode = `IGX-${number}`;

/**
 * Every diagnostic code `@ignifx/core` can throw, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2 — `as const` objects in
 * place of enums).
 *
 * @example
 * ```ts
 * throw new IgnifxError(CoreErrorCode.mutationAfterDestroy, "The entity has been destroyed.", {
 *   context: { entity: entity.uid },
 * });
 * ```
 *
 * @remarks
 * Code blocks reserved for other first-party packages, which cannot import this table
 * (`docs/architecture/00-overview.md` §2): `@ignifx/cli` owns `IGX-1401`–`IGX-1419`; `@ignifx/electron`
 * owns `IGX-1460`–`IGX-1499` (core's own platform codes therefore stop at `IGX-1459`);
 * `@ignifx/vite-plugin` owns `IGX-0550`–`IGX-0599` and `IGX-0650`–`IGX-0699`. Core allocates its
 * own codes from the bottom of each range and, in the platform range, from `IGX-1420` upward —
 * which is where `app.platform` and `app.storage` live, because storage is a *platform* service:
 * the same three calls resolve to IndexedDB, a directory, or the Electron bridge depending only on
 * the host, so a failure is a platform failure and not a serialization or asset one.
 *
 * @public
 */
export const CoreErrorCode = {
  /** An entity, component, or app was used after it had been destroyed or disposed. */
  mutationAfterDestroy: "IGX-0101",
  /** `destroyImmediate()` was called from inside a lifecycle callback. */
  destroyImmediateInCallback: "IGX-0102",
  /** A signal handler asked for deferred delivery on a signal that has no scheduler. */
  deferredSignalWithoutScheduler: "IGX-0103",
  /** A signal handler threw and no handler-error reporter was installed. */
  signalHandlerThrew: "IGX-0104",
  /** `app.step()` was called while Babylon Lite's render loop was driving the frames. */
  stepOutsideHeadless: "IGX-0105",
  /** An app was used after `app.dispose()` had run. */
  appDisposed: "IGX-0106",
  /** A part of the app was reached before `createApp()` had finished building it. */
  appNotReady: "IGX-0107",
  /** A `Time` property was set to a value outside its documented domain. */
  invalidTimeValue: "IGX-0108",
  /** A `app.tweens.to(...)` option was outside its documented domain. */
  invalidTweenOptions: "IGX-0109",
  /** A tweened field is not a number, `Vec2`, `Vec3`, or `Quat`, or is not writable. */
  tweenFieldNotTweenable: "IGX-0110",
  /** A component declared through `requires` is missing from the entity. */
  requiredComponentMissing: "IGX-0201",
  /** A second instance of a component type that does not allow multiples was added. */
  multipleComponentsNotAllowed: "IGX-0202",
  /** Two component types were registered under the same `typeId`. */
  duplicateComponentTypeId: "IGX-0203",
  /** A component without a `typeId` was serialized. */
  componentTypeIdMissing: "IGX-0204",
  /** `Transform` was removed or disabled; every entity must keep exactly one enabled transform. */
  transformIsNotRemovable: "IGX-0205",
  /** A component's engine-assigned state was read before the engine attached it to an entity. */
  componentNotAttached: "IGX-0206",
  /** A scene was instantiated before it had finished loading. */
  sceneNotLoaded: "IGX-0301",
  /** Instantiating a scene would place an instance inside itself. */
  sceneInstanceCycle: "IGX-0302",
  /** A layer name that the project settings do not declare was used. */
  unknownLayer: "IGX-0303",
  /** Two layer slots were given the same name. */
  duplicateLayerName: "IGX-0304",
  /** The project settings declare more layer names than the 32 available slots. */
  tooManyLayers: "IGX-0305",
  /** Reparenting an entity under its own descendant would make the scene tree cyclic. */
  parentingCycle: "IGX-0306",
  /** A scene file names a component `typeId` that no extension has registered. */
  unknownComponentTypeId: "IGX-0307",
  /** A file handed to the scene loader does not carry the `ignifx.scene` format header. */
  notASceneFile: "IGX-0308",
  /** An operation that only accepts a scene root was given an entity that has a parent. */
  entityIsNotSceneRoot: "IGX-0309",
  /** Two extensions defined the same app property. */
  appPropertyAlreadyDefined: "IGX-0401",
  /** The `requires` graph of the registered extensions contains a cycle. */
  extensionRequiresCycle: "IGX-0402",
  /** An extension declares a `requires` entry that was never registered. */
  extensionMissing: "IGX-0403",
  /** An extension's `engine` range does not match the running core version. */
  extensionEngineMismatch: "IGX-0404",
  /** `ctx.require()` asked for a service that no earlier extension registered. */
  serviceNotRegistered: "IGX-0405",
  /** Two extensions were registered under the same name. */
  duplicateExtensionName: "IGX-0406",
  /** `ctx.settings()` asked for a settings section that was never registered. */
  unknownSettingsSection: "IGX-0407",
  /** A project settings section did not validate against the schema its extension registered. */
  invalidSettings: "IGX-0408",
  /** An extension dispatched a physics callback from outside the fixed loop. */
  physicsCallbackOutsideFixedStep: "IGX-0409",
  /** A second, different simulation scene was handed to a world that already has one. */
  simulationSceneAlreadySet: "IGX-0410",
  /** An asset's value was read before the asset finished loading. */
  assetNotLoaded: "IGX-0501",
  /** An asset load was aborted through its `AbortSignal`. */
  assetLoadAborted: "IGX-0502",
  /** An asset promise outlived the app that owned it. */
  assetAppDisposed: "IGX-0503",
  /** No registered loader claims the address's type or extension. */
  assetNoLoader: "IGX-0504",
  /** An asset load failed after its last retry. */
  assetLoadFailed: "IGX-0505",
  /** Two loaders were registered for the same asset type. */
  duplicateAssetLoader: "IGX-0506",
  /** A serialized number was `NaN` or infinite. */
  nonFiniteNumber: "IGX-0601",
  /** A serialized `$entity`/`$component` reference could not be resolved. */
  unresolvedReference: "IGX-0602",
  /** A scene, prefab, or manifest declares a format version this build cannot read. */
  unsupportedFormatVersion: "IGX-0603",
  /** A scene instance's override hash does not match the scene file it was recorded against. */
  instanceHashMismatch: "IGX-0604",
  /** A value had the wrong JavaScript or JSON type for its schema field kind. */
  schemaTypeMismatch: "IGX-0605",
  /** A value had the right type but fell outside its schema field's declared value domain. */
  schemaOutOfRange: "IGX-0606",
  /** A schema declaration or a property bag named a field the schema does not declare. */
  schemaUnknownField: "IGX-0607",
  /** A scene file failed structural validation against the generated scene-file JSON Schema. */
  sceneFileInvalid: "IGX-0608",
  /** An instance override declares a `path` the override grammar does not accept. */
  invalidOverridePath: "IGX-0609",
  /** WebGPU is not available in the current environment. */
  webGpuUnavailable: "IGX-0701",
  /** A runtime handle was used after disposal, or was not created by ignifx. */
  invalidRuntime: "IGX-0702",
  /** Shadows were requested from a light kind Babylon Lite cannot shadow. */
  shadowsUnsupportedForLight: "IGX-0703",
  /** A rendering feature opt-in was requested after the render scene had been registered. */
  renderingFeatureTooLate: "IGX-0704",
  /** A second `Environment` was enabled in one world; the most recent one wins. */
  multipleEnvironments: "IGX-0705",
  /** A world rendered with no enabled camera, so nothing was drawn. */
  noEnabledCamera: "IGX-0706",
  /** A screenshot was requested with no render loop running, so no frame will ever be presented. */
  screenshotNeedsRenderLoop: "IGX-0707",
  /** A material file declares a family this build cannot construct. */
  unsupportedMaterialKind: "IGX-0708",
  /** An asset file does not carry the format header its loader requires. */
  invalidAssetFile: "IGX-0709",
  /** A `PostProcessStack` was attached without the `postProcessing` rendering feature. */
  postProcessingFeatureOff: "IGX-0710",
  /** The host exposes no Web Crypto implementation. */
  cryptoUnavailable: "IGX-1420",
  /** A storage namespace name is not a legal namespace segment. */
  storageInvalidNamespace: "IGX-1421",
  /** A storage key is empty, too long, or contains a control character. */
  storageInvalidKey: "IGX-1422",
  /** A value handed to `app.storage.set` has no JSON form. */
  storageValueNotSerializable: "IGX-1423",
  /** The storage backend refused a write because the host is out of quota or disk space. */
  storageQuotaExceeded: "IGX-1424",
  /** The storage backend failed for a reason the engine cannot classify. */
  storageBackendFailed: "IGX-1425",
  /** A stored value could not be read back; the store was damaged or written by something else. */
  storageValueCorrupt: "IGX-1426",
  /** An error code was registered twice. */
  duplicateErrorCode: "IGX-1501",
  /** An error code does not match `IGX-####` in a known range. */
  malformedErrorCode: "IGX-1502",
  /** A diagnostics counter group was registered twice. */
  duplicateDiagnosticsGroup: "IGX-1503",
  /** A diagnostics counter name was not declared when its group was registered. */
  unknownDiagnosticsCounter: "IGX-1504",
  /** A `switch` over a union reached a case the type system said was impossible. */
  unreachableCase: "IGX-1505",
} as const;

/**
 * The union of the codes `@ignifx/core` owns. Use it to narrow `catch` blocks to core failures.
 *
 * @public
 */
export type CoreErrorCode = (typeof CoreErrorCode)[keyof typeof CoreErrorCode];

/**
 * The one-line message template for every `CoreErrorCode`. Templates name context keys in
 * braces (`{entity}`); the throwing call site substitutes the values it has and puts the same
 * identifiers in {@link IgnifxError.context} so production builds stay useful without the prose.
 *
 * @public
 */
export const CORE_ERROR_MESSAGES: Readonly<Record<CoreErrorCode, string>> = {
  "IGX-0101": "{target} has been destroyed and can no longer be used.",
  "IGX-0102": "destroyImmediate() cannot run inside the {phase} callback; use destroy() instead.",
  "IGX-0103": "Deferred signal delivery needs a scheduler; construct the signal with a deferred queue.",
  "IGX-0104": "A signal handler threw.",
  "IGX-0105": "step() is only available in headless mode or while the render loop is stopped.",
  "IGX-0106": "The app has been disposed; {member} is no longer available.",
  "IGX-0107": "{member} is not available until createApp() resolves.",
  "IGX-0108": "{property} must be {domain}; got {value}.",
  "IGX-0109": "The tween option {option} must be {domain}; got {value}.",
  "IGX-0110": "{field} is not a number, Vec2, Vec3, or Quat on the tween target.",
  "IGX-0201": "{component} requires {required} on the same entity.",
  "IGX-0202": "{component} does not allow multiple instances on one entity.",
  "IGX-0203": "The component type id {typeId} is already registered by {owner}.",
  "IGX-0204": "{component} cannot be serialized because it has no typeId.",
  "IGX-0205": "Transform cannot be removed or disabled.",
  "IGX-0206": "{component} is not attached to an entity yet.",
  "IGX-0301": "The scene {scene} is not loaded yet.",
  "IGX-0302": "Instantiating {scene} under {entity} would nest the scene inside itself.",
  "IGX-0303": "{layer} is not a layer declared in the project settings.",
  "IGX-0304": "The layer name {layer} is declared twice.",
  "IGX-0305": "The project settings declare {count} layers; at most {limit} fit in the 32 slots.",
  "IGX-0306": "{entity} cannot be parented to {parent}, which is inside its own subtree.",
  "IGX-0307": "{typeId} is not a registered component type.",
  "IGX-0308": "{file} is not an ignifx scene file.",
  "IGX-0309": "{entity} is not a scene root; only roots can move between scene instances.",
  "IGX-0401": "The app property {property} is already defined by {owner}.",
  "IGX-0402": "The extension requires graph contains a cycle: {cycle}.",
  "IGX-0403": "{extension} requires {required}, which is not registered.",
  "IGX-0404": "{extension} supports engine {range} but the running core is {version}.",
  "IGX-0405": "The service {service} required by {extension} is not registered.",
  "IGX-0406": "The extension name {extension} is registered twice.",
  "IGX-0407": "{section} is not a registered settings section.",
  "IGX-0408": "The {section} settings section is invalid: {issues}.",
  "IGX-0409": "Physics callbacks are dispatched inside the fixed loop only; {callback} was not.",
  "IGX-0410": "A world has one simulation scene, and this world already has a different one.",
  "IGX-0501": "The asset {asset} has no value yet because it is still loading.",
  "IGX-0502": "Loading {asset} was aborted.",
  "IGX-0503": "The app that owned the asset {asset} was disposed before loading finished.",
  "IGX-0504": "No loader is registered for {asset}.",
  "IGX-0505": "Loading {asset} from {url} failed after {attempts} attempts.",
  "IGX-0506": "A loader for the asset type {type} is already registered.",
  "IGX-0601": "{field} must be a finite number.",
  "IGX-0602": "The reference {reference} in {scene} could not be resolved.",
  "IGX-0603": "{file} declares format version {version}, which this build cannot read.",
  "IGX-0604": "The overrides recorded for {scene} do not match the scene file.",
  "IGX-0605": "{field} has the wrong type for a {kind} field.",
  "IGX-0606": "{field} is outside the declared value domain.",
  "IGX-0607": "{field} is not a field this schema declares.",
  "IGX-0608": "{file} does not match the scene file schema.",
  "IGX-0609": "{path} is not a valid instance override path.",
  "IGX-0701": "WebGPU is not available in this environment.",
  "IGX-0702": "This handle was already disposed, or was not created by ignifx.",
  "IGX-0703": "Babylon Lite has no shadow generator for a {lightType} light.",
  "IGX-0704": "The rendering feature {feature} must be enabled before the scene is registered.",
  "IGX-0705": "{entity} enabled a second Environment in this world; the most recent one wins.",
  "IGX-0706": "This world has no enabled camera, so nothing is drawn.",
  "IGX-0707": "captureScreenshot() needs a running render loop; a headless app never presents a frame.",
  "IGX-0708": "{asset} declares the material kind {kind}, which this build cannot construct.",
  "IGX-0709": "{file} is not an {format} file.",
  "IGX-0710": "{entity} attached a PostProcessStack, but rendering.features.postProcessing is off.",
  "IGX-1420": "This host does not expose Web Crypto.",
  "IGX-1421": "{namespace} is not a valid storage namespace.",
  "IGX-1422": "That storage key is empty, too long, or contains a control character.",
  "IGX-1423": "The value stored at {key} has no JSON form.",
  "IGX-1424": "The {backend} storage backend has no quota left for {operation}.",
  "IGX-1425": "The {backend} storage backend could not {operation}.",
  "IGX-1426": "The value stored at {key} could not be read back.",
  "IGX-1501": "The error code {code} is already registered by {owner}.",
  "IGX-1502": "{code} is not a valid IGX-#### code in a known range.",
  "IGX-1503": "The diagnostics group {group} is already registered.",
  "IGX-1504": "{counter} is not a counter of the diagnostics group {group}.",
  "IGX-1505": "Unreachable case reached for {what}.",
};

/** The fixed length of an `IGX-####` code. */
const ERROR_CODE_LENGTH = 8;

/** Where the four digits start inside an `IGX-####` code. */
const ERROR_CODE_DIGITS_OFFSET = 4;

/** The characters allowed in the numeric part of a code. */
const DIGITS = "0123456789";

/**
 * Reports whether a string is a well-formed ignifx error code.
 *
 * @remarks
 * The rule has exactly two parts and the `ignifx/error-code-format` lint rule mirrors it:
 *
 * 1. the string is `IGX-` followed by four ASCII digits, and
 * 2. the first two digits are one of the fifteen `ErrorRange` prefixes, or the first digit is
 *    {@link THIRD_PARTY_ERROR_PREFIX} (the third-party block `IGX-9000`–`IGX-9999`).
 *
 * @param code - The candidate code.
 * @returns `true` when the code is well formed and inside an allocated range. The signature is a
 * type predicate, so a validated string narrows to {@link ErrorCode} without a type assertion.
 *
 * @example
 * ```ts
 * isValidErrorCode("IGX-0701"); // true  — rendering
 * isValidErrorCode("IGX-9042"); // true  — third party
 * isValidErrorCode("IGX-1601"); // false — no subsystem owns 16
 * ```
 *
 * @public
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  // The literal below is the prefix the `ignifx/error-code-format` rule looks for. This function is
  // the validator that rule mirrors, not a throw site, so the rule is switched off for one line.
  // eslint-disable-next-line ignifx/error-code-format -- see the comment above
  if (code.length !== ERROR_CODE_LENGTH || !code.startsWith("IGX-")) {
    return false;
  }
  const digits = code.slice(ERROR_CODE_DIGITS_OFFSET);
  for (const digit of digits) {
    if (!DIGITS.includes(digit)) {
      return false;
    }
  }
  const prefix = digits.slice(0, 2);
  if (prefix.startsWith(THIRD_PARTY_ERROR_PREFIX)) {
    return true;
  }
  for (const range of Object.values(ErrorRange)) {
    if (range === prefix) {
      return true;
    }
  }
  return false;
}
