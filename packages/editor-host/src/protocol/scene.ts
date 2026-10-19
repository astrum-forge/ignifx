// A copy of `packages/editor-protocol/src/scene.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * Protocol 0.3: the scene document transport between the editor and the scene view
 * (`@ignifx/editor-host`). Plan §3.4, §3.5, §3.7.
 *
 * The editor holds the scene document (`@ignifx/editor-core`) and the host mirrors it into a live
 * world: the editor opens the scene with the whole file, then sends every command's ops as it
 * applies them. The host reports what the user does in the view (a pick click, a gizmo drag) as
 * notifications, which the editor turns into commands of its own; the host never edits the document.
 * `docs/protocol.md`, "0.3: scene documents", gives the sequences and what the host must do per
 * method.
 */
import { isRecord } from "./rpc.js";
import {
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isJsonObject,
  isJsonValue,
  isNumberTuple,
  isSceneFile,
  isSceneFileEntity,
  isSceneFileTransform,
  isString,
  isUidString,
  optionalField,
} from "./scene-file.js";
import { isSceneOp } from "./scene-ops.js";
import type { RpcNotification, RpcRequest, RpcSuccessResponse } from "./rpc.js";
import type { JsonObject, JsonValue, SceneFile, SceneFileEntity, SceneFileTransform } from "./scene-file.js";
import type { SceneOp } from "./scene-ops.js";

/**
 * Editor → scene host: the methods of protocol 0.3, answered after `ready`.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * The host handles these requests one at a time, in the order they arrive: a request starts only
 * after the previous one has been answered, so `applyOps` sent right after `openScene` sees the new
 * scene. Until the host's app has started, every one of them fails with `RpcErrorCode.notReady`;
 * the host's first `schemasChanged` is the editor's cue that they are accepted. A method that needs
 * an open scene fails with `RpcErrorCode.noScene` while none is open. A method whose capability the
 * host does not list in `ready` fails with `RpcErrorCode.methodNotFound`.
 *
 * @public
 */
export const SceneMethod = {
  /** Opens a scene from the editor's document, replacing any open scene. Answers {@link OpenSceneResult}. */
  openScene: "openScene",
  /** Unloads the open scene, if any. Answers `null`. */
  closeScene: "closeScene",
  /** Applies one command's ops to the open scene, in order. Answers {@link ApplyOpsResult}. */
  applyOps: "applyOps",
  /** Serializes entities of the open scene as the live world has them. Answers {@link ReadBackResult}. */
  readBack: "readBack",
  /** Sets the selection the view outlines and attaches the gizmo to. Answers {@link EntitySelection}. */
  select: "select",
  /** Sets the gizmo's mode, space and snapping. Needs `HostCapability.gizmos`. Answers `null`. */
  setGizmo: "setGizmo",
  /** Moves the editor camera to frame entities. Answers `null`. */
  frame: "frame",
  /** Asks which entity is under a point of the view, without selecting it. Answers {@link PickResult}. */
  pick: "pick",
  /** Captures the view as an image. Needs `HostCapability.screenshot`. Answers {@link ScreenshotResult}. */
  screenshot: "screenshot",
  /** Describes every registered component's schema. Answers {@link SchemaSet}. */
  getSchemas: "getSchemas",
  /**
   * Describes the project's settings sections and the values the app resolved for them. Answers
   * {@link SettingsSet}. A host from before it answers `RpcErrorCode.methodNotFound`.
   */
  describeSettings: "describeSettings",
  /** Switches the view between the 3D and the 2D editor camera. Answers `null`. */
  setViewMode: "setViewMode",
} as const;

/**
 * The union of the names in `SceneMethod`.
 *
 * @public
 */
export type SceneMethod = (typeof SceneMethod)[keyof typeof SceneMethod];

/**
 * Scene host → editor: the notifications of protocol 0.3. None has an answer.
 *
 * @remarks
 * There is no `reloadScripts` method: script hot reload is Vite's. When a script changes, Vite
 * replaces the module in the host page, `acceptHotReload(app)` hands the new classes to
 * `app.hotReload.apply`, and the host reports the outcome with `hotReloaded` and `schemasChanged`.
 * A change that Vite cannot hot-replace reloads the host page, which the editor sees as a new load:
 * a new port, a new handshake, and `openScene` again.
 *
 * @public
 */
export const SceneNotification = {
  /** After the answer to every successful `openScene`: what was opened. */
  sceneOpened: "sceneOpened",
  /** Once the app has started (after `ready`), and after every hot reload: the component schemas. */
  schemasChanged: "schemasChanged",
  /** After every `app.hotReload` operation: its report. */
  hotReloaded: "hotReloaded",
  /** After a click in the view changed the selection: the new selection. */
  selectionChanged: "selectionChanged",
  /** During a gizmo drag, at most every {@link TRANSFORM_DRAGGING_INTERVAL_MS}: for display only. */
  transformDragging: "transformDragging",
  /** Once per gizmo gesture, at pointer-up: the editor turns it into a `setTransform` command. */
  transformDragged: "transformDragged",
  /** A failure that answers no request: an error the app reported, a failed hot reload. */
  hostError: "hostError",
  /** One line from the app's logger, for the editor's Console. */
  log: "log",
} as const;

/**
 * The union of the names in `SceneNotification`.
 *
 * @public
 */
export type SceneNotification = (typeof SceneNotification)[keyof typeof SceneNotification];

/**
 * The fewest milliseconds between two `transformDragging` notifications for the same gesture: at
 * most 20 a second, which S0.2 measured as smooth enough for an inspector to follow a drag.
 *
 * @public
 */
export const TRANSFORM_DRAGGING_INTERVAL_MS = 50;

/**
 * The largest width and height, in pixels, of a `screenshot`. A request for more fails with
 * `invalidParams`; a request without a size gets the view's own size scaled down to fit. It keeps
 * an image well under what an MCP client accepts inline (plan §3.11).
 *
 * @public
 */
export const SCREENSHOT_MAX_SIZE = 2048;

/**
 * A world-space point, `[x, y, z]`, in metres.
 *
 * @public
 */
export type Vec3 = readonly [number, number, number];

/**
 * One recoverable problem the engine reported while building or serializing a scene: the engine's
 * `SceneLoadIssue` and `SerializeIssue`.
 *
 * @public
 */
export interface SceneIssue {
  /** The engine's diagnostic code, for example `"IGX-0602"`. */
  readonly code: string;
  /** The engine's actionable sentence. */
  readonly message: string;
}

/**
 * One structural problem in a scene file: the engine's `SceneFileIssue`, from `validateSceneFile`.
 *
 * @public
 */
export interface SceneFileIssue {
  /** Where the problem is, for example `"entities/3/transform"`. */
  readonly path: string;
  /** An actionable description. */
  readonly message: string;
}

/**
 * The parameters of `openScene`.
 *
 * @public
 */
export interface OpenSceneParams {
  /**
   * The whole scene file, as the editor's document holds it: the engine's `SceneFile` object, not
   * its text. It may differ from the file on disk (unsaved edits), so it is the only source the
   * host builds from.
   */
  readonly file: SceneFile;
  /**
   * The asset address the document is saved at, for example `"scenes/level01.scene.json"`, or
   * `null` for a document that has never been saved. The host names the scene's asset with it and
   * never loads the file from it.
   */
  readonly address: string | null;
}

/**
 * The answer to `openScene`, once every entity is built.
 *
 * @public
 */
export interface OpenSceneResult {
  /** How many entities the host built, including those expanded from instanced scenes. */
  readonly entityCount: number;
  /** Every recoverable problem the build reported, in order (`SceneBuildResult.issues`). */
  readonly warnings: readonly SceneIssue[];
}

/**
 * The `data` of the `invalidParams` error `openScene` answers when `validateSceneFile` refuses the
 * file.
 *
 * @public
 */
export interface InvalidSceneFileData {
  /** What `validateSceneFile` reported. */
  readonly issues: readonly SceneFileIssue[];
}

/**
 * The parameters of `applyOps`: one command, as the editor applied it to its document.
 *
 * @public
 */
export interface ApplyOpsParams {
  /** The ops, in the order they apply. Undo sends the inverse ops; redo sends the ops again. */
  readonly ops: readonly SceneOp[];
  /** The command's label, for example `"Move Player"`, for the host's log. */
  readonly commandName: string;
  /** The editor's id for this command, unique on the channel, for correlating logs and failures. */
  readonly commandId: string;
}

/**
 * Why the host could not apply one op.
 *
 * @remarks
 * The first ten are `@ignifx/editor-core`'s `OpErrorCode`s, with its meanings, for a world that
 * disagrees with the document the op was checked against. The last two are the host's own.
 *
 * @public
 */
export const ApplyOpFailureCode = {
  /** Not an op of the vocabulary. */
  invalidOp: "invalidOp",
  /** The target entity uid is not in the open scene. */
  unknownEntity: "unknownEntity",
  /** The target component uid is not in the open scene. */
  unknownComponent: "unknownComponent",
  /** A new entity or component reuses a uid. */
  duplicateUid: "duplicateUid",
  /** A parent outside the scene, or a move under its own subtree. */
  invalidParent: "invalidParent",
  /** An index outside the list it positions in. */
  invalidIndex: "invalidIndex",
  /** A value of the wrong shape for its field. */
  invalidValue: "invalidValue",
  /** A JSON path or override path that does not resolve. */
  invalidPath: "invalidPath",
  /** An override op on an entity without an `instance` entry. */
  notAnInstance: "notAnInstance",
  /** No override with that identity. */
  unknownOverride: "unknownOverride",
  /** The host cannot apply this op to a live world yet; the editor reopens the scene instead. */
  unsupportedOp: "unsupportedOp",
  /** The engine threw while applying the op; `diagnostic` carries its `IGX-` code when it had one. */
  engineError: "engineError",
} as const;

/**
 * The union of the codes in `ApplyOpFailureCode`.
 *
 * @public
 */
export type ApplyOpFailureCode = (typeof ApplyOpFailureCode)[keyof typeof ApplyOpFailureCode];

/**
 * One op the host could not apply.
 *
 * @public
 */
export interface ApplyOpFailure {
  /** The op's index in `ApplyOpsParams.ops`. */
  readonly index: number;
  /** Why it failed. */
  readonly code: ApplyOpFailureCode;
  /** An actionable sentence. */
  readonly message: string;
  /** The engine's diagnostic code, for example `"IGX-0307"`, when the engine reported one. */
  readonly diagnostic?: string;
}

/**
 * The answer to `applyOps`.
 *
 * @remarks
 * The host applies the ops in order and does not stop at a failure, so `applied + failures.length`
 * is the number of ops sent. Any failure means the live world no longer mirrors the document; the
 * editor then sends `openScene` with the whole document again.
 *
 * @public
 */
export interface ApplyOpsResult {
  /** How many ops were applied. */
  readonly applied: number;
  /** The ops that were not, in order. */
  readonly failures: readonly ApplyOpFailure[];
}

/**
 * The parameters of `readBack`.
 *
 * @public
 */
export interface ReadBackParams {
  /** The entities to serialize; absent for every entity of the open scene. */
  readonly entities?: readonly string[];
}

/**
 * The answer to `readBack`: the open scene's entities as `serializeScene` writes them from the live
 * world, which is what the document should hold when the mirror is exact.
 *
 * @public
 */
export interface ReadBackResult {
  /** The entity records, in tree order, as `serializeScene` writes them. */
  readonly entities: readonly SceneFileEntity[];
  /** The requested uids that name no entity of the open scene, in request order. */
  readonly missing: readonly string[];
  /** The scene's `settings`, or `null` when it has none. */
  readonly settings: JsonObject | null;
  /** What the serializer reported (`SerializeIssue`), in order. */
  readonly issues: readonly SceneIssue[];
}

/**
 * A selection: the parameters and the answer of `select`, and the parameters of `selectionChanged`.
 *
 * @public
 */
export interface EntitySelection {
  /** The selected entities' uids. The last one is the primary selection, which the gizmo follows. */
  readonly entities: readonly string[];
}

/**
 * What the gizmo does.
 *
 * @public
 */
export const GizmoMode = {
  /** Move along axes and planes. */
  translate: "translate",
  /** Rotate around axes. */
  rotate: "rotate",
  /** Scale along axes and uniformly. */
  scale: "scale",
  /** No gizmo; the selection is only outlined. */
  none: "none",
} as const;

/**
 * The union of the modes in `GizmoMode`.
 *
 * @public
 */
export type GizmoMode = (typeof GizmoMode)[keyof typeof GizmoMode];

/**
 * The gizmo modes a drag can happen in: every `GizmoMode` but `none`.
 *
 * @public
 */
export type GizmoDragMode = Exclude<GizmoMode, typeof GizmoMode.none>;

/**
 * Which axes the gizmo follows.
 *
 * @public
 */
export const GizmoSpace = {
  /** The entity's own axes. */
  local: "local",
  /** The world's axes. */
  world: "world",
} as const;

/**
 * The union of the spaces in `GizmoSpace`.
 *
 * @public
 */
export type GizmoSpace = (typeof GizmoSpace)[keyof typeof GizmoSpace];

/**
 * The gizmo's snapping increments. `0` turns snapping off for that mode.
 *
 * @public
 */
export interface GizmoSnap {
  /** The translation step, in metres. */
  readonly translate: number;
  /** The rotation step, in degrees. */
  readonly rotate: number;
  /** The scale step, as a factor added per step (`0.1` snaps scale to tenths). */
  readonly scale: number;
}

/**
 * The parameters of `setGizmo`.
 *
 * @public
 */
export interface SetGizmoParams {
  /** What the gizmo does. */
  readonly mode: GizmoMode;
  /** Which axes it follows. */
  readonly space: GizmoSpace;
  /** The snapping increments, or `null` for no snapping. */
  readonly snap: GizmoSnap | null;
}

/**
 * The parameters of `frame`.
 *
 * @public
 */
export interface FrameParams {
  /** The entities to fit in the view, or `"all"` for the whole open scene. */
  readonly entities: readonly string[] | "all";
}

/**
 * The unit of a `pick` point (S0.2 §6.1).
 *
 * @public
 */
export const PickUnit = {
  /** CSS pixels from the view's top-left corner: a DOM event's `offsetX` and `offsetY`. */
  css: "css",
  /** The canvas's backing-store pixels: CSS pixels times `canvas.width / canvas.clientWidth`. */
  backing: "backing",
} as const;

/**
 * The union of the units in `PickUnit`.
 *
 * @public
 */
export type PickUnit = (typeof PickUnit)[keyof typeof PickUnit];

/**
 * The parameters of `pick`.
 *
 * @public
 */
export interface PickParams {
  /** The point's x, from the view's left edge, in `unit`. */
  readonly x: number;
  /** The point's y, from the view's top edge, in `unit`. */
  readonly y: number;
  /** The unit of `x` and `y`; the host converts it to whatever its engine's picker takes. */
  readonly unit: PickUnit;
}

/**
 * A world-space ray from the view's camera through a point of the view.
 *
 * @public
 */
export interface PickRay {
  /** Where the ray starts, in metres: the point under the cursor on the camera's near plane. */
  readonly origin: Vec3;
  /** Which way it points: a unit vector. */
  readonly direction: Vec3;
}

/**
 * The answer to `pick`.
 *
 * @public
 */
export interface PickResult {
  /** The scene entity hit, or `null` for a miss. A hit inside an instanced scene names its instance root. */
  readonly entity: string | null;
  /** The world-space hit point, or `null` for a miss or when the picker does not report one. */
  readonly point: Vec3 | null;
  /** How far along the camera ray the hit is, in metres, or `null` for a miss or a 2D pick. */
  readonly distance: number | null;
  /**
   * The ray the view's camera casts through the point, hit or miss, so that an editor can place
   * something where nothing was hit (a 3D editor intersects it with its ground plane, `y = 0`).
   * Absent when the host builds no ray (a headless view, a point outside the canvas) and from a host
   * from before it.
   */
  readonly ray?: PickRay;
  /**
   * Where `ray` meets the 2D world plane `z = 0`, as `[x, y, 0]`: in a 2D scene, the world point
   * under the cursor. Absent when `ray` is, and when the ray runs parallel to the plane or meets it
   * behind its origin.
   */
  readonly plane?: Vec3;
}

/**
 * The image formats of a `screenshot`.
 *
 * @public
 */
export const ScreenshotFormat = {
  /** Lossless, `image/png`. */
  png: "png",
  /** Lossy, `image/jpeg`. */
  jpeg: "jpeg",
} as const;

/**
 * The union of the formats in `ScreenshotFormat`.
 *
 * @public
 */
export type ScreenshotFormat = (typeof ScreenshotFormat)[keyof typeof ScreenshotFormat];

/**
 * The parameters of `screenshot`.
 *
 * @public
 */
export interface ScreenshotParams {
  /** The image width in pixels, 1 to {@link SCREENSHOT_MAX_SIZE}; absent to follow the view. */
  readonly width?: number;
  /** The image height in pixels, 1 to {@link SCREENSHOT_MAX_SIZE}; absent to follow the view. */
  readonly height?: number;
  /** The image format. */
  readonly format: ScreenshotFormat;
  /** The JPEG quality, from 0 to 1; the host's default (0.9) when absent. Ignored for PNG. */
  readonly quality?: number;
}

/**
 * The answer to `screenshot`.
 *
 * @public
 */
export interface ScreenshotResult {
  /** The image as a `data:image/png;base64,…` or `data:image/jpeg;base64,…` URL. */
  readonly dataUrl: string;
  /** The image width in pixels. */
  readonly width: number;
  /** The image height in pixels. */
  readonly height: number;
}

/**
 * One field of a component schema: the engine's `SchemaFieldDescription`.
 *
 * @public
 */
export interface SchemaFieldDescription {
  /** The field kind, for example `"f32"` or `"asset"`; an editor shows a kind it does not know as JSON. */
  readonly kind: string;
  /** The field's default value, encoded as JSON. */
  readonly default?: JsonValue;
  /** The field's tooltip. */
  readonly description?: string;
  /**
   * The increment of the inspector's drag and spinner controls (`FieldOptions.step`), present only
   * when the field declares one; in degrees for a `quat` field, which an inspector edits as Euler
   * angles.
   */
  readonly step?: number;
  /** `FieldOptions.hidden`: the inspector leaves the field out; it is still saved. */
  readonly hidden?: boolean;
  /** `FieldOptions.readonly`: the inspector shows the field but does not let it be edited. */
  readonly readonly?: boolean;
  /** `FieldOptions.group`: the inspector group the field folds into. */
  readonly group?: string;
  /**
   * An `asset` field's asset type name (`asset(TextureAsset)` → `"texture"`), the `type` an asset
   * reference to it carries; absent when the asset token names no type.
   */
  readonly assetType?: string;
  /**
   * A `componentRef` field's accepted component, as its `typeId`, or `null` when the class it was
   * declared with carries no `typeId`; present on every `componentRef` field a 0.3 host describes
   * with core's `describeRegisteredSchemas`.
   */
  readonly componentType?: string | null;
}

/**
 * One component schema: the engine's `SchemaDescription`, plus the JSON Schema of its `props`.
 *
 * @public
 */
export interface SchemaDescription {
  /** The human-readable name. */
  readonly title: string;
  /** `"components"` for a component; a file format's name for the engine's file-format entries. */
  readonly format: string;
  /** A one-line summary. */
  readonly description?: string;
  /** Every declared field, in declaration order. */
  readonly fields: Readonly<Record<string, SchemaFieldDescription>>;
  /**
   * Whether an entity may hold more than one of the component (the class's `static allowMultiple`,
   * `true` when it declares nothing); absent on file-format entries and from a host from before
   * core's `describeRegisteredSchemas`, where an editor assumes `true`.
   */
  readonly allowMultiple?: boolean;
  /**
   * Who registered the component: the extension's `name` (the npm package name, for example
   * `@ignifx/3d`), or, for a class the game registered itself, its type id's namespace (`game` for
   * `game/Health`); absent on file-format entries and from a host from before
   * `describeRegisteredSchemas`.
   */
  readonly package?: string;
  /**
   * `true` for the one component every entity carries itself, `ignifx/Transform`: it is never in a
   * scene file's `components` list, an editor neither adds nor removes it, and its fields are the
   * entity record's `transform` block, edited whole with the `setTransform` op rather than prop by
   * prop. Absent on every other entry. A host from before the engine described the transform (engine
   * ask E4) sends no such member.
   */
  readonly builtIn?: boolean;
  /**
   * The JSON Schema of the component's `props` (the engine's `toJsonSchema(schema)`), which adds
   * each field's `minimum`, `maximum`, `enum` and nested shapes; absent for file-format entries.
   */
  readonly propsSchema?: JsonObject;
}

/**
 * Every schema the host's app knows: the answer to `getSchemas` and the parameters of
 * `schemasChanged`.
 *
 * @public
 */
export interface SchemaSet {
  /** The descriptions, keyed by component `typeId` (file formats by `ignifx/<format>-file`). */
  readonly schemas: Readonly<Record<string, SchemaDescription>>;
}

/**
 * The project's settings as the host's app has them: the answer to `describeSettings`.
 *
 * @public
 */
export interface SettingsSet {
  /**
   * Every settings section the app registered (core's and each extension's), keyed by section name,
   * in registration order: the engine's `describeSettings(app)`. Each has `format: "settings"`, the
   * registering extension as `package`, field defaults in the settings form (a vector is
   * `{ x, y, z }` and a colour `{ r, g, b, a }`, not the scene file's arrays), and as `propsSchema`
   * the JSON Schema of the section as `ignifx.settings.json` may write it (its entry in the engine's
   * `settingsJsonSchema(app)`).
   */
  readonly sections: Readonly<Record<string, SchemaDescription>>;
  /**
   * The values the app resolved for each section, keyed by section name, in the same settings form:
   * the project's settings over the section's defaults. A value JSON cannot carry (a function, a
   * non-finite number) is left out.
   */
  readonly values: Readonly<Record<string, JsonObject>>;
}

/**
 * The editor cameras the view can use.
 *
 * @public
 */
export const ViewMode = {
  /** The 3D editor camera, gizmos and grid. */
  threeD: "3d",
  /** The 2D editor camera, planar gizmos and pixel grid. Needs `HostCapability.viewMode2d`. */
  twoD: "2d",
} as const;

/**
 * The union of the modes in `ViewMode`.
 *
 * @public
 */
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

/**
 * The parameters of `setViewMode`.
 *
 * @public
 */
export interface SetViewModeParams {
  /** The editor camera to use. */
  readonly mode: ViewMode;
}

/**
 * The parameters of `sceneOpened`.
 *
 * @public
 */
export interface SceneOpenedParams {
  /** The address `openScene` was given. */
  readonly address: string | null;
  /** The file's `name`. */
  readonly name: string;
  /** As in {@link OpenSceneResult}. */
  readonly entityCount: number;
  /** As in {@link OpenSceneResult}. */
  readonly warnings: readonly SceneIssue[];
}

/**
 * One error a hot reload ran into.
 *
 * @public
 */
export interface HotReloadError {
  /** The error's message (`String(error)` when it is not an `Error`). */
  readonly message: string;
  /** Its `IGX-` code when it is an `IgnifxError`, else `null`. */
  readonly code: string | null;
}

/**
 * What one hot reload did: the engine's `HotReloadReport`, with its errors made JSON.
 *
 * @public
 */
export interface HotReloadReport {
  /** Which operation: a prototype swap, a recreate of instances, or a scene rebuild. */
  readonly kind: "patch" | "recreate" | "scene";
  /** The `typeId`s reloaded, in the order applied. */
  readonly typeIds: readonly string[];
  /** How many live component instances were swapped or re-created, or entities rebuilt. */
  readonly instances: number;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Everything that threw on the way. */
  readonly errors: readonly HotReloadError[];
}

/**
 * The parameters of `hotReloaded`.
 *
 * @public
 */
export interface HotReloadedParams {
  /** The report `app.hotReload.onApplied` emitted. */
  readonly report: HotReloadReport;
}

/**
 * The parameters of `transformDragging`.
 *
 * @public
 */
export interface TransformDraggingParams {
  /** The dragged entity's uid. */
  readonly entity: string;
  /** The gizmo mode of the drag. */
  readonly mode: GizmoDragMode;
  /** Its local transform now, rounded as the engine writes numbers. */
  readonly after: SceneFileTransform;
}

/**
 * The parameters of `transformDragged`: the shape of a `setTransform` op plus the drag's mode.
 *
 * @public
 */
export interface TransformDraggedParams {
  /** The dragged entity's uid. */
  readonly entity: string;
  /** The gizmo mode of the drag, for the command's name. */
  readonly mode: GizmoDragMode;
  /** Its local transform when the drag started. */
  readonly before: SceneFileTransform;
  /** Its local transform at pointer-up. */
  readonly after: SceneFileTransform;
}

/**
 * The parameters of `hostError`.
 *
 * @public
 */
export interface HostErrorParams {
  /** The engine's `IGX-` code, or `null` when the error had none. */
  readonly code: string | null;
  /** An actionable sentence. */
  readonly message: string;
  /** Extra detail as JSON, when there is any. */
  readonly data?: JsonValue;
}

/**
 * A log line's severity: the engine's `LogLevel`.
 *
 * @public
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * The parameters of `log`: the engine's `LogRecord` without its `data`, which is not JSON.
 *
 * @public
 */
export interface LogParams {
  /** The severity. */
  readonly level: LogLevel;
  /** The logger's dotted scope, or `null` for the root logger. */
  readonly scope: string | null;
  /** The message. */
  readonly message: string;
  /** The logger clock's reading, in milliseconds. */
  readonly timeMs: number;
}

/**
 * A request whose `params` are required.
 *
 * @typeParam M - The method name.
 * @typeParam P - The parameters.
 *
 * @public
 */
export interface RpcRequestWithParams<M extends string, P> extends RpcRequest<M, P> {
  /** The method's parameters. */
  readonly params: P;
}

/**
 * A notification whose `params` are required.
 *
 * @typeParam M - The method name.
 * @typeParam P - The parameters.
 *
 * @public
 */
export interface RpcNotificationWithParams<M extends string, P> extends RpcNotification<M, P> {
  /** The notification's parameters. */
  readonly params: P;
}

/**
 * Editor → scene host: one of the `SceneMethod`s. `closeScene`, `getSchemas` and `describeSettings`
 * take no parameters.
 *
 * @public
 */
export type SceneRequest =
  | RpcRequestWithParams<typeof SceneMethod.openScene, OpenSceneParams>
  | RpcRequest<typeof SceneMethod.closeScene, never>
  | RpcRequestWithParams<typeof SceneMethod.applyOps, ApplyOpsParams>
  | RpcRequestWithParams<typeof SceneMethod.readBack, ReadBackParams>
  | RpcRequestWithParams<typeof SceneMethod.select, EntitySelection>
  | RpcRequestWithParams<typeof SceneMethod.setGizmo, SetGizmoParams>
  | RpcRequestWithParams<typeof SceneMethod.frame, FrameParams>
  | RpcRequestWithParams<typeof SceneMethod.pick, PickParams>
  | RpcRequestWithParams<typeof SceneMethod.screenshot, ScreenshotParams>
  | RpcRequest<typeof SceneMethod.getSchemas, never>
  | RpcRequest<typeof SceneMethod.describeSettings, never>
  | RpcRequestWithParams<typeof SceneMethod.setViewMode, SetViewModeParams>;

/**
 * The success answer of the `SceneMethod`s that return nothing: `closeScene`, `setGizmo`, `frame`
 * and `setViewMode`.
 *
 * @public
 */
export type NullResponse = RpcSuccessResponse<null>;

/**
 * The success answer to `openScene`.
 *
 * @public
 */
export type OpenSceneResponse = RpcSuccessResponse<OpenSceneResult>;

/**
 * The success answer to `applyOps`.
 *
 * @public
 */
export type ApplyOpsResponse = RpcSuccessResponse<ApplyOpsResult>;

/**
 * The success answer to `readBack`.
 *
 * @public
 */
export type ReadBackResponse = RpcSuccessResponse<ReadBackResult>;

/**
 * The success answer to `select`.
 *
 * @public
 */
export type SelectResponse = RpcSuccessResponse<EntitySelection>;

/**
 * The success answer to `pick`.
 *
 * @public
 */
export type PickResponse = RpcSuccessResponse<PickResult>;

/**
 * The success answer to `screenshot`.
 *
 * @public
 */
export type ScreenshotResponse = RpcSuccessResponse<ScreenshotResult>;

/**
 * The success answer to `getSchemas`.
 *
 * @public
 */
export type GetSchemasResponse = RpcSuccessResponse<SchemaSet>;

/**
 * The success answer to `describeSettings`.
 *
 * @public
 */
export type DescribeSettingsResponse = RpcSuccessResponse<SettingsSet>;

/**
 * Scene host → editor: one of the `SceneNotification`s.
 *
 * @public
 */
export type SceneHostNotification =
  | RpcNotificationWithParams<typeof SceneNotification.sceneOpened, SceneOpenedParams>
  | RpcNotificationWithParams<typeof SceneNotification.schemasChanged, SchemaSet>
  | RpcNotificationWithParams<typeof SceneNotification.hotReloaded, HotReloadedParams>
  | RpcNotificationWithParams<typeof SceneNotification.selectionChanged, EntitySelection>
  | RpcNotificationWithParams<typeof SceneNotification.transformDragging, TransformDraggingParams>
  | RpcNotificationWithParams<typeof SceneNotification.transformDragged, TransformDraggedParams>
  | RpcNotificationWithParams<typeof SceneNotification.hostError, HostErrorParams>
  | RpcNotificationWithParams<typeof SceneNotification.log, LogParams>;

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * Tells whether a value is one of an `as const` object's values.
 *
 * @param names - The object.
 * @param value - The value to test.
 * @returns True when `value` is one of the object's values.
 */
function isOneOf(names: Readonly<Record<string, string>>, value: unknown): boolean {
  return typeof value === "string" && Object.values(names).includes(value);
}

/**
 * Tells whether a value is a count: a non-negative safe integer.
 *
 * @param value - The value to test.
 * @returns True for a non-negative safe integer.
 */
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * Tells whether a value is a non-negative finite number.
 *
 * @param value - The value to test.
 * @returns True for a finite number at least 0.
 */
function isNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/**
 * Tells whether a value is a list of uids.
 *
 * @param value - The value to test.
 * @returns True for an array of non-empty strings.
 */
function isUidList(value: unknown): value is readonly string[] {
  return isArrayOf(value, isUidString);
}

/**
 * Tells whether a value is a string or `null`.
 *
 * @param value - The value to test.
 * @returns True for a string or `null`.
 */
function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value);
}

/**
 * Checks one engine issue.
 *
 * @param value - The value to test.
 * @returns True for `{ code: string, message: string }`.
 *
 * @public
 */
export function isSceneIssue(value: unknown): value is SceneIssue {
  return isRecord(value) && isString(value["code"]) && isString(value["message"]);
}

/**
 * Checks the parameters of `openScene`.
 *
 * @param value - The received `params`.
 * @returns True for a structurally valid scene file and a string or `null` address.
 *
 * @public
 */
export function isOpenSceneParams(value: unknown): value is OpenSceneParams {
  return isRecord(value) && isSceneFile(value["file"]) && isStringOrNull(value["address"]);
}

/**
 * Checks the result of `openScene`.
 *
 * @param value - The received `result`.
 * @returns True for a count and a list of issues.
 *
 * @public
 */
export function isOpenSceneResult(value: unknown): value is OpenSceneResult {
  return isRecord(value) && isCount(value["entityCount"]) && isArrayOf(value["warnings"], isSceneIssue);
}

/**
 * Checks the `data` of the `invalidParams` error `openScene` answers for a file
 * `validateSceneFile` refuses.
 *
 * @param value - The received `error.data`.
 * @returns True for `{ issues: [{ path, message }] }`.
 *
 * @public
 */
export function isInvalidSceneFileData(value: unknown): value is InvalidSceneFileData {
  return (
    isRecord(value) &&
    isArrayOf(
      value["issues"],
      (issue): issue is SceneFileIssue => isRecord(issue) && isString(issue["path"]) && isString(issue["message"]),
    )
  );
}

/**
 * Checks the parameters of `applyOps`.
 *
 * @param value - The received `params`.
 * @returns True when every op passes {@link isSceneOp} and the command has a name and an id.
 *
 * @public
 */
export function isApplyOpsParams(value: unknown): value is ApplyOpsParams {
  return (
    isRecord(value) &&
    isArrayOf(value["ops"], isSceneOp) &&
    isString(value["commandName"]) &&
    isUidString(value["commandId"])
  );
}

/**
 * Checks one failure in the result of `applyOps`.
 *
 * @param value - The value to test.
 * @returns True for `{ index, code, message, diagnostic? }` with a known code.
 */
function isApplyOpFailure(value: unknown): value is ApplyOpFailure {
  return (
    isRecord(value) &&
    isCount(value["index"]) &&
    isOneOf(ApplyOpFailureCode, value["code"]) &&
    isString(value["message"]) &&
    optionalField(value, "diagnostic", isString)
  );
}

/**
 * Checks the result of `applyOps`.
 *
 * @param value - The received `result`.
 * @returns True for a count of applied ops and a list of failures with known codes.
 *
 * @public
 */
export function isApplyOpsResult(value: unknown): value is ApplyOpsResult {
  return isRecord(value) && isCount(value["applied"]) && isArrayOf(value["failures"], isApplyOpFailure);
}

/**
 * Checks the parameters of `readBack`.
 *
 * @param value - The received `params`.
 * @returns True for an object with an optional list of uids.
 *
 * @public
 */
export function isReadBackParams(value: unknown): value is ReadBackParams {
  return isRecord(value) && optionalField(value, "entities", isUidList);
}

/**
 * Checks the result of `readBack`.
 *
 * @param value - The received `result`.
 * @returns True for entity records, missing uids, settings or `null`, and issues.
 *
 * @public
 */
export function isReadBackResult(value: unknown): value is ReadBackResult {
  const settings = isRecord(value) ? value["settings"] : undefined;
  return (
    isRecord(value) &&
    isArrayOf(value["entities"], isSceneFileEntity) &&
    isUidList(value["missing"]) &&
    (settings === null || isJsonObject(settings)) &&
    isArrayOf(value["issues"], isSceneIssue)
  );
}

/**
 * Checks a selection: the parameters and result of `select` and the parameters of
 * `selectionChanged`.
 *
 * @param value - The received `params` or `result`.
 * @returns True for `{ entities: uid[] }`.
 *
 * @public
 */
export function isEntitySelection(value: unknown): value is EntitySelection {
  return isRecord(value) && isUidList(value["entities"]);
}

/**
 * Checks the parameters of `setGizmo`.
 *
 * @param value - The received `params`.
 * @returns True for a known mode and space and a snap of three non-negative numbers, or `null`.
 *
 * @public
 */
export function isSetGizmoParams(value: unknown): value is SetGizmoParams {
  if (!isRecord(value)) {
    return false;
  }
  const snap = value["snap"];
  return (
    isOneOf(GizmoMode, value["mode"]) &&
    isOneOf(GizmoSpace, value["space"]) &&
    (snap === null ||
      (isRecord(snap) &&
        isNonNegative(snap["translate"]) &&
        isNonNegative(snap["rotate"]) &&
        isNonNegative(snap["scale"])))
  );
}

/**
 * Checks the parameters of `frame`.
 *
 * @param value - The received `params`.
 * @returns True for a list of uids or `"all"`.
 *
 * @public
 */
export function isFrameParams(value: unknown): value is FrameParams {
  return isRecord(value) && (value["entities"] === "all" || isUidList(value["entities"]));
}

/**
 * Checks the parameters of `pick`.
 *
 * @param value - The received `params`.
 * @returns True for finite `x` and `y` and a known unit.
 *
 * @public
 */
export function isPickParams(value: unknown): value is PickParams {
  return (
    isRecord(value) && isFiniteNumber(value["x"]) && isFiniteNumber(value["y"]) && isOneOf(PickUnit, value["unit"])
  );
}

/**
 * Checks a pick ray.
 *
 * @param value - The value to test.
 * @returns True for `{ origin, direction }`, each three finite numbers.
 */
function isPickRay(value: unknown): value is PickRay {
  return isRecord(value) && isNumberTuple(value["origin"], 3) && isNumberTuple(value["direction"], 3);
}

/**
 * Checks the result of `pick`.
 *
 * @param value - The received `result`.
 * @returns True for a uid or `null`, a point or `null`, a non-negative distance or `null`, an
 * optional ray and an optional plane point.
 *
 * @public
 */
export function isPickResult(value: unknown): value is PickResult {
  if (!isRecord(value)) {
    return false;
  }
  const { entity, point, distance } = value;
  return (
    (entity === null || isUidString(entity)) &&
    (point === null || isNumberTuple(point, 3)) &&
    (distance === null || isNonNegative(distance)) &&
    optionalField(value, "ray", isPickRay) &&
    optionalField(value, "plane", (plane) => isNumberTuple(plane, 3))
  );
}

/**
 * Tells whether a value is a screenshot side: a whole number from 1 to {@link SCREENSHOT_MAX_SIZE}.
 *
 * @param value - The value to test.
 * @returns True for an integer in range.
 */
function isScreenshotSide(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= SCREENSHOT_MAX_SIZE;
}

/**
 * Checks the parameters of `screenshot`.
 *
 * @param value - The received `params`.
 * @returns True for a known format, sizes in range when given, and a quality from 0 to 1 when given.
 *
 * @public
 */
export function isScreenshotParams(value: unknown): value is ScreenshotParams {
  return (
    isRecord(value) &&
    isOneOf(ScreenshotFormat, value["format"]) &&
    optionalField(value, "width", isScreenshotSide) &&
    optionalField(value, "height", isScreenshotSide) &&
    optionalField(value, "quality", (quality) => isNonNegative(quality) && quality <= 1)
  );
}

/**
 * Checks the result of `screenshot`.
 *
 * @param value - The received `result`.
 * @returns True for a PNG or JPEG data URL and sizes in range.
 *
 * @public
 */
export function isScreenshotResult(value: unknown): value is ScreenshotResult {
  return (
    isRecord(value) &&
    isString(value["dataUrl"]) &&
    /^data:image\/(?:png|jpeg);base64,/u.test(value["dataUrl"]) &&
    isScreenshotSide(value["width"]) &&
    isScreenshotSide(value["height"])
  );
}

/**
 * Checks one field description.
 *
 * @param value - The value to test.
 * @returns True for `{ kind, default?, description?, step?, hidden?, readonly?, group?, assetType?,
 * componentType? }`, ignoring members it does not declare.
 */
function isSchemaFieldDescription(value: unknown): value is SchemaFieldDescription {
  return (
    isRecord(value) &&
    isString(value["kind"]) &&
    optionalField(value, "default", (fallback) => isJsonValue(fallback)) &&
    optionalField(value, "description", isString) &&
    optionalField(value, "step", (step) => isFiniteNumber(step) && step > 0) &&
    optionalField(value, "hidden", isBoolean) &&
    optionalField(value, "readonly", isBoolean) &&
    optionalField(value, "group", isString) &&
    optionalField(value, "assetType", isString) &&
    optionalField(value, "componentType", (type) => type === null || isString(type))
  );
}

/**
 * Checks one schema description.
 *
 * @param value - The value to test.
 * @returns True for `{ title, format, description?, fields, allowMultiple?, package?, builtIn?,
 * propsSchema? }`, ignoring members it does not declare.
 */
function isSchemaDescription(value: unknown): value is SchemaDescription {
  return (
    isRecord(value) &&
    isString(value["title"]) &&
    isString(value["format"]) &&
    optionalField(value, "description", isString) &&
    isRecord(value["fields"]) &&
    Object.values(value["fields"]).every((field) => isSchemaFieldDescription(field)) &&
    optionalField(value, "allowMultiple", isBoolean) &&
    optionalField(value, "package", isString) &&
    optionalField(value, "builtIn", isBoolean) &&
    optionalField(value, "propsSchema", isJsonObject)
  );
}

/**
 * Checks the result of `getSchemas` and the parameters of `schemasChanged`.
 *
 * @param value - The received `result` or `params`.
 * @returns True for `{ schemas }` whose every entry is a schema description.
 *
 * @public
 */
export function isSchemaSet(value: unknown): value is SchemaSet {
  const schemas = isRecord(value) ? value["schemas"] : undefined;
  return isRecord(schemas) && Object.values(schemas).every((schema) => isSchemaDescription(schema));
}

/**
 * Checks the result of `describeSettings`.
 *
 * @param value - The received `result`.
 * @returns True for `{ sections, values }`: every section a schema description, every value an
 * object.
 *
 * @public
 */
export function isSettingsSet(value: unknown): value is SettingsSet {
  if (!isRecord(value)) {
    return false;
  }
  const { sections, values } = value;
  return (
    isRecord(sections) &&
    Object.values(sections).every((section) => isSchemaDescription(section)) &&
    isRecord(values) &&
    Object.values(values).every((section) => isJsonObject(section))
  );
}

/**
 * Checks the parameters of `setViewMode`.
 *
 * @param value - The received `params`.
 * @returns True for `{ mode: "3d" | "2d" }`.
 *
 * @public
 */
export function isSetViewModeParams(value: unknown): value is SetViewModeParams {
  return isRecord(value) && isOneOf(ViewMode, value["mode"]);
}

/**
 * Checks the parameters of `sceneOpened`.
 *
 * @param value - The received `params`.
 * @returns True for an address or `null`, a name, a count and issues.
 *
 * @public
 */
export function isSceneOpenedParams(value: unknown): value is SceneOpenedParams {
  return (
    isRecord(value) &&
    isStringOrNull(value["address"]) &&
    isString(value["name"]) &&
    isOpenSceneResult({ entityCount: value["entityCount"], warnings: value["warnings"] })
  );
}

/** The `kind`s of a hot-reload report. */
const HOT_RELOAD_KINDS: Readonly<Record<string, string>> = { patch: "patch", recreate: "recreate", scene: "scene" };

/**
 * Checks the parameters of `hotReloaded`.
 *
 * @param value - The received `params`.
 * @returns True for `{ report }` with a known kind, type ids, counts and JSON errors.
 *
 * @public
 */
export function isHotReloadedParams(value: unknown): value is HotReloadedParams {
  const report = isRecord(value) ? value["report"] : undefined;
  return (
    isRecord(report) &&
    isOneOf(HOT_RELOAD_KINDS, report["kind"]) &&
    isArrayOf(report["typeIds"], isString) &&
    isCount(report["instances"]) &&
    isNonNegative(report["durationMs"]) &&
    isArrayOf(
      report["errors"],
      (error): error is HotReloadError =>
        isRecord(error) && isString(error["message"]) && isStringOrNull(error["code"]),
    )
  );
}

/** The modes a drag can happen in. */
const DRAG_MODES: Readonly<Record<string, string>> = {
  translate: GizmoMode.translate,
  rotate: GizmoMode.rotate,
  scale: GizmoMode.scale,
};

/**
 * Checks the parameters of `transformDragging`.
 *
 * @param value - The received `params`.
 * @returns True for an entity, a drag mode and a transform.
 *
 * @public
 */
export function isTransformDraggingParams(value: unknown): value is TransformDraggingParams {
  return (
    isRecord(value) &&
    isUidString(value["entity"]) &&
    isOneOf(DRAG_MODES, value["mode"]) &&
    isSceneFileTransform(value["after"])
  );
}

/**
 * Checks the parameters of `transformDragged`.
 *
 * @param value - The received `params`.
 * @returns True for an entity, a drag mode and two transforms.
 *
 * @public
 */
export function isTransformDraggedParams(value: unknown): value is TransformDraggedParams {
  return isTransformDraggingParams(value) && "before" in value && isSceneFileTransform(value.before);
}

/**
 * Checks the parameters of `hostError`.
 *
 * @param value - The received `params`.
 * @returns True for a code or `null`, a message and optional JSON data.
 *
 * @public
 */
export function isHostErrorParams(value: unknown): value is HostErrorParams {
  return (
    isRecord(value) &&
    isStringOrNull(value["code"]) &&
    isString(value["message"]) &&
    optionalField(value, "data", (data) => isJsonValue(data))
  );
}

/** The severities of a log line. */
const LOG_LEVELS: Readonly<Record<string, string>> = { debug: "debug", info: "info", warn: "warn", error: "error" };

/**
 * Checks the parameters of `log`.
 *
 * @param value - The received `params`.
 * @returns True for a known level, a scope or `null`, a message and a finite time.
 *
 * @public
 */
export function isLogParams(value: unknown): value is LogParams {
  return (
    isRecord(value) &&
    isOneOf(LOG_LEVELS, value["level"]) &&
    isStringOrNull(value["scope"]) &&
    isString(value["message"]) &&
    isFiniteNumber(value["timeMs"])
  );
}
