// A copy of `packages/editor-protocol/src/play.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The play view's controls: the methods the editor calls on the project's own game page after the
 * handshake, through `attachEditorPlayControls(app)` from `virtual:ignifx/editor`. Plan §3.6.
 */
import { isRecord } from "./rpc.js";
import { isSceneFileEntity, isUidString } from "./scene-file.js";
import type { RpcNotification, RpcRequest, RpcSuccessResponse } from "./rpc.js";
import type { SceneFileEntity } from "./scene-file.js";
import type { RpcRequestWithParams, ScreenshotParams } from "./scene.js";

/**
 * The methods the play view answers after `ready`. `play`, `pause`, `step` and `stop` answer with a
 * {@link PlayState}; `playState` answers with a {@link PlayStateReport}; `playStats` answers with
 * {@link PlayStats}; `screenshot` answers with a `ScreenshotResult`; `queryRuntime` answers with a
 * {@link QueryRuntimeResult}; `sendInput` answers with a {@link SendInputResult}.
 *
 * @remarks
 * A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
 * fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.
 * `playState`, `playStats`, `screenshot`, `queryRuntime` and `sendInput` are additive 0.3 methods:
 * a host from before one answers it with `RpcErrorCode.methodNotFound`. `screenshot`, `queryRuntime`
 * and `sendInput` also need the `HostCapability` of the same name in the play view's `ready`.
 *
 * @public
 */
export const PlayMethod = {
  /** Clears `app.time.paused` and starts the frame loop if it is stopped. */
  play: "play",
  /** Sets `app.time.paused`; scripts marked `updateWhenPaused` keep running. */
  pause: "pause",
  /** Stops the frame loop, then advances exactly one frame with `app.step()` and leaves the game paused. */
  step: "step",
  /** Stops the frame loop with `app.stop()`. The editor reloads the view to reset the game. */
  stop: "stop",
  /** Reads the game's state without changing it. Takes no parameters. */
  playState: "playState",
  /**
   * Reads the game's frame rate, frame time, entity count and frame count without changing
   * anything. Takes no parameters. The editor polls it; no notification carries it.
   */
  playStats: "playStats",
  /**
   * Captures the game's canvas as an image, with the scene view's `screenshot` parameters, caps and
   * answer (`ScreenshotParams`, `ScreenshotResult`). Changes nothing: a paused game is captured
   * paused. Needs `HostCapability.screenshot`. Fails with `RpcErrorCode.notPlaying` while the frame
   * loop does not run (before the game starts it, after `stop` or `step`), and with
   * `RpcErrorCode.notReady` before the game's first frame.
   */
  screenshot: "screenshot",
  /**
   * Reads one entity of the running game as the scene format writes it ({@link QueryRuntimeParams},
   * {@link QueryRuntimeResult}): its live transform, flags and component props, never anything a
   * component does not serialize, and no expressions. Each value is capped and the whole answer kept
   * within {@link QUERY_RUNTIME_MAX_JSON_LENGTH}. Changes nothing. Needs
   * `HostCapability.queryRuntime`. Fails with `RpcErrorCode.notPlaying` while the game is stopped
   * (before it starts, after `stop`; a stepped game is paused and answers), and with
   * `RpcErrorCode.unknownEntity` when no entity of the game has the uid.
   */
  queryRuntime: "queryRuntime",
  /**
   * Queues synthetic key and pointer events into the game's own input system, as if the game's page
   * had received them ({@link SendInputParams}, {@link SendInputResult}). Nothing reaches the
   * editor's window or the operating system. Needs `HostCapability.sendInput`, which a game lists
   * only when it has `app.input` (`@ignifx/input`). Fails with `RpcErrorCode.notPlaying` while the
   * game is stopped; a paused or stepped game takes the events and resolves them on its next frame,
   * which for a stepped game is the next `step`.
   */
  sendInput: "sendInput",
} as const;

/**
 * The union of the names in `PlayMethod`.
 *
 * @public
 */
export type PlayMethod = (typeof PlayMethod)[keyof typeof PlayMethod];

/**
 * The parameters of the `step` method.
 *
 * @public
 */
export interface StepParams {
  /**
   * The frame delta in seconds, a positive finite number. Defaults to `app.time.fixedDeltaTime`;
   * any other value fails with `RpcErrorCode.invalidParams`.
   */
  readonly deltaSeconds?: number;
}

/**
 * The most components a `queryRuntime` answer holds, and the most type ids its `components` filter
 * may name. Components past it are counted in {@link QueryRuntimeResult.omittedComponents}.
 *
 * @public
 */
export const QUERY_RUNTIME_MAX_COMPONENTS = 64;

/**
 * The longest a `queryRuntime` answer may be: its `result` as JSON text, in UTF-16 code units
 * (`JSON.stringify(result).length`), 256 Ki. Components that would pass it are left out, in order,
 * and counted in {@link QueryRuntimeResult.omittedComponents}.
 *
 * @public
 */
export const QUERY_RUNTIME_MAX_JSON_LENGTH = 262_144;

/**
 * In a `queryRuntime` answer, the most keys one object keeps and the longest a key may be; also the
 * longest the entity's `name`, `layer`, each tag and each component `type` may be, and the most
 * tags kept. An object cut short gets the key `"$omitted"` with how many keys it lost.
 *
 * @public
 */
export const QUERY_RUNTIME_MAX_KEYS = 256;

/**
 * The parameters of the `queryRuntime` method.
 *
 * @public
 */
export interface QueryRuntimeParams {
  /** The entity's uid. A scene's own entities keep their file uids at run time. */
  readonly entity: string;
  /**
   * Only the components of these type ids, at most {@link QUERY_RUNTIME_MAX_COMPONENTS}; absent for
   * all of them. A type id the entity does not carry matches nothing.
   */
  readonly components?: readonly string[];
}

/**
 * Play view → editor: the answer to `queryRuntime`.
 *
 * @public
 */
export interface QueryRuntimeResult {
  /**
   * The entity as `serializeEntity` writes it from the live world, with at most
   * {@link QUERY_RUNTIME_MAX_COMPONENTS} components (only the filtered ones when `components` was
   * given), in the entity's order, as many as fit in {@link QUERY_RUNTIME_MAX_JSON_LENGTH}.
   *
   * @remarks
   * Each value is capped too: a prop string is clipped to `HOST_TEXT_MAX_LENGTH`, a list cut to
   * `HOST_LIST_MAX_LENGTH` items, an object to {@link QUERY_RUNTIME_MAX_KEYS} keys (the rest
   * counted in its `"$omitted"` key), and each key, the `name`, the `layer`, each component `type`
   * and each of at most {@link QUERY_RUNTIME_MAX_KEYS} tags clipped to {@link QUERY_RUNTIME_MAX_KEYS}
   * characters. A value that is not JSON (a non-finite number, a function a custom codec returned)
   * becomes `null`, and so does anything nested deeper than 256 levels.
   */
  readonly entity: SceneFileEntity;
  /**
   * How many matching components were left out: past {@link QUERY_RUNTIME_MAX_COMPONENTS}, or past
   * the first that did not fit in {@link QUERY_RUNTIME_MAX_JSON_LENGTH}.
   */
  readonly omittedComponents: number;
  /** How many frames had started when it was read (`app.time.frameCount`). */
  readonly frameCount: number;
  /** Scaled seconds of game time when it was read (`app.time.time`). */
  readonly time: number;
}

/**
 * Play view → editor: the answer to `queryRuntime`.
 *
 * @public
 */
export type QueryRuntimeResponse = RpcSuccessResponse<QueryRuntimeResult>;

/**
 * The most events one `sendInput` request may carry.
 *
 * @public
 */
export const SEND_INPUT_MAX_EVENTS = 64;

/**
 * A key press or release in a `sendInput` request.
 *
 * @public
 */
export interface SendInputKeyEvent {
  /** `"keydown"` presses the key and holds it until a `"keyup"`; `"keyup"` releases it. */
  readonly type: "keydown" | "keyup";
  /**
   * The `<Keyboard>` control name: the physical key's `KeyboardEvent.code` in camelCase without its
   * `Key` or `Digit` prefix, such as `w`, `1`, `space`, `arrowUp` or `shiftLeft`. Letters and digits
   * only, at most 64 of them; a name the game's keyboard does not have fails with
   * `RpcErrorCode.invalidParams`.
   */
  readonly control: string;
}

/**
 * A pointer move, press or release in a `sendInput` request.
 *
 * @public
 */
export interface SendInputPointerEvent {
  /** Which pointer event it is. */
  readonly type: "pointermove" | "pointerdown" | "pointerup";
  /** The pointer's x as a fraction of the game's canvas width, from `0` (left) to `1` (right). */
  readonly x: number;
  /** The pointer's y as a fraction of the game's canvas height, from `0` (top) to `1` (bottom). */
  readonly y: number;
  /** The `PointerEvent.button`, an integer from `0` (main) to `4`. Defaults to `0`. */
  readonly button?: number;
}

/**
 * One event of a `sendInput` request.
 *
 * @public
 */
export type SendInputEvent = SendInputKeyEvent | SendInputPointerEvent;

/**
 * The parameters of the `sendInput` method.
 *
 * @public
 */
export interface SendInputParams {
  /** The events, in order: from 1 to {@link SEND_INPUT_MAX_EVENTS} of them. */
  readonly events: readonly SendInputEvent[];
}

/**
 * Play view → editor: what `sendInput` queued.
 *
 * @public
 */
export interface SendInputResult {
  /** How many events were queued: all of the request's. */
  readonly queued: number;
}

/**
 * Play view → editor: the answer to `sendInput`.
 *
 * @public
 */
export type SendInputResponse = RpcSuccessResponse<SendInputResult>;

/**
 * Editor → play view: one of the `PlayMethod`s. Only `step`, `screenshot`, `queryRuntime` and
 * `sendInput` take parameters.
 *
 * @public
 */
export type PlayRequest =
  | RpcRequest<typeof PlayMethod.play, never>
  | RpcRequest<typeof PlayMethod.pause, never>
  | RpcRequest<typeof PlayMethod.step, StepParams>
  | RpcRequest<typeof PlayMethod.stop, never>
  | RpcRequest<typeof PlayMethod.playState, never>
  | RpcRequest<typeof PlayMethod.playStats, never>
  | RpcRequestWithParams<typeof PlayMethod.screenshot, ScreenshotParams>
  | RpcRequestWithParams<typeof PlayMethod.queryRuntime, QueryRuntimeParams>
  | RpcRequestWithParams<typeof PlayMethod.sendInput, SendInputParams>;

/**
 * What the play view reports after every `PlayMethod`.
 *
 * @public
 */
export interface PlayState {
  /** Whether the frame loop runs (`app.isRunning`). */
  readonly isRunning: boolean;
  /** Whether game time is paused (`app.time.paused`). */
  readonly isPaused: boolean;
  /** How many frames have started (`app.time.frameCount`). */
  readonly frameCount: number;
}

/**
 * Play view → editor: the answer to `play`, `pause`, `step` or `stop`.
 *
 * @public
 */
export type PlayResponse = RpcSuccessResponse<PlayState>;

/**
 * The notifications the play view sends after `ready`.
 *
 * @remarks
 * Additive in 0.3: a host from before them sends none, and answers `playState` with
 * `RpcErrorCode.methodNotFound`. `log`, `hostError` and `hotReloaded` came later still: only a host
 * that lists `HostCapability.logRelay` in `ready` sends them.
 *
 * @public
 */
export const PlayNotification = {
  /**
   * After the game's {@link PlayStateReport.state} changed. A change a `PlayMethod` makes is sent
   * right after that method's answer; one the game makes itself, such as setting
   * `app.time.paused`, within one heartbeat interval.
   */
  playStateChanged: "playStateChanged",
  /**
   * One line from the game's logger, with the same `LogParams` as the scene view's `log`. Sent by a
   * host that lists `HostCapability.logRelay`; lines logged before the handshake are kept (the
   * newest few hundred) and sent right after `ready`.
   */
  log: "log",
  /**
   * An error the game's app reported through `app.onError`: the same `HostErrorParams` as the scene
   * view's `hostError`, with `AppErrorData` as its `data`. Sent by a host that lists
   * `HostCapability.logRelay`, kept before the handshake as `log` is.
   */
  hostError: "hostError",
  /**
   * After every `app.hotReload` operation in the game: the same `HotReloadedParams` as the scene
   * view's `hotReloaded`. Sent by a host that lists `HostCapability.logRelay`.
   */
  hotReloaded: "hotReloaded",
} as const;

/**
 * The union of the names in `PlayNotification`.
 *
 * @public
 */
export type PlayNotification = (typeof PlayNotification)[keyof typeof PlayNotification];

/**
 * Whether the game plays, is paused, or is stopped, as {@link PlayStateReport.state} reports it.
 *
 * @public
 */
export const PlayPhase = {
  /** The frame loop runs (`app.isRunning`) and game time is not paused. */
  playing: "playing",
  /**
   * Game time is paused (`app.time.paused`): after `pause`, or after `step`, which leaves the frame
   * loop stopped on the stepped frame.
   */
  paused: "paused",
  /** The frame loop does not run: before the game starts it, or after `stop`. */
  stopped: "stopped",
} as const;

/**
 * The union of the names in `PlayPhase`.
 *
 * @public
 */
export type PlayPhase = (typeof PlayPhase)[keyof typeof PlayPhase];

/**
 * The game's state as `playState` answers it and `playStateChanged` reports it.
 *
 * @public
 */
export interface PlayStateReport {
  /** Whether the game plays, is paused, or is stopped. */
  readonly state: PlayPhase;
  /** How many frames have started (`app.time.frameCount`). */
  readonly frameCount: number;
  /** Scaled seconds of game time since the app started running frames (`app.time.time`). */
  readonly time: number;
}

/**
 * Play view → editor: the answer to `playState`.
 *
 * @public
 */
export type PlayStateResponse = RpcSuccessResponse<PlayStateReport>;

/**
 * The game's performance as `playStats` answers it.
 *
 * @public
 */
export interface PlayStats {
  /**
   * Frames per second: `1000 / frameTimeMs`, or `0` when `frameTimeMs` is `0`. Rendered frames
   * count whether or not game time is paused.
   */
  readonly fps: number;
  /**
   * The mean wall-clock time between the frames of the last second, in milliseconds, from the
   * frame history in `app.diagnostics` (each frame's `rawDeltaMs`); `0` while the frame loop does
   * not run (stopped, or stepped and paused on a frame) or before its first frame.
   */
  readonly frameTimeMs: number;
  /** How many entities the game's world holds, in every scene instance, persistent ones included. */
  readonly entityCount: number;
  /** How many frames have started (`app.time.frameCount`). */
  readonly frameCount: number;
}

/**
 * Play view → editor: the answer to `playStats`.
 *
 * @public
 */
export type PlayStatsResponse = RpcSuccessResponse<PlayStats>;

/**
 * Play view → editor: the game's state changed.
 *
 * @public
 */
export interface PlayStateChangedNotification extends RpcNotification<
  typeof PlayNotification.playStateChanged,
  PlayStateReport
> {
  /** The game's state after the change. */
  readonly params: PlayStateReport;
}

/**
 * Checks the `result` of a play method's response.
 *
 * @param value - The received `result`.
 * @returns True when `value` has boolean `isRunning` and `isPaused` and a non-negative integer
 * `frameCount`.
 *
 * @public
 */
export function isPlayState(value: unknown): value is PlayState {
  if (!isRecord(value)) {
    return false;
  }
  const frameCount = value["frameCount"];
  return (
    typeof value["isRunning"] === "boolean" &&
    typeof value["isPaused"] === "boolean" &&
    typeof frameCount === "number" &&
    Number.isSafeInteger(frameCount) &&
    frameCount >= 0
  );
}

/**
 * Checks the `result` of `playState` and the `params` of `playStateChanged`.
 *
 * @param value - The received value.
 * @returns True when `value` has a `state` that is a `PlayPhase`, a non-negative integer
 * `frameCount`, and a non-negative finite `time`.
 *
 * @public
 */
export function isPlayStateReport(value: unknown): value is PlayStateReport {
  if (!isRecord(value)) {
    return false;
  }
  const state = value["state"];
  const frameCount = value["frameCount"];
  const time = value["time"];
  return (
    typeof state === "string" &&
    Object.values<string>(PlayPhase).includes(state) &&
    typeof frameCount === "number" &&
    Number.isSafeInteger(frameCount) &&
    frameCount >= 0 &&
    typeof time === "number" &&
    Number.isFinite(time) &&
    time >= 0
  );
}

/**
 * Checks the `result` of `playStats`.
 *
 * @param value - The received `result`.
 * @returns True when `value` has non-negative finite `fps` and `frameTimeMs` and non-negative
 * integer `entityCount` and `frameCount`.
 *
 * @public
 */
export function isPlayStats(value: unknown): value is PlayStats {
  if (!isRecord(value)) {
    return false;
  }
  const fps = value["fps"];
  const frameTimeMs = value["frameTimeMs"];
  const entityCount = value["entityCount"];
  const frameCount = value["frameCount"];
  return (
    typeof fps === "number" &&
    Number.isFinite(fps) &&
    fps >= 0 &&
    typeof frameTimeMs === "number" &&
    Number.isFinite(frameTimeMs) &&
    frameTimeMs >= 0 &&
    typeof entityCount === "number" &&
    Number.isSafeInteger(entityCount) &&
    entityCount >= 0 &&
    typeof frameCount === "number" &&
    Number.isSafeInteger(frameCount) &&
    frameCount >= 0
  );
}

/**
 * Checks the `params` of `queryRuntime`.
 *
 * @param value - The received `params`.
 * @returns True for a non-empty `entity` uid and, when present, a `components` list of at most
 * {@link QUERY_RUNTIME_MAX_COMPONENTS} non-empty strings.
 *
 * @public
 */
export function isQueryRuntimeParams(value: unknown): value is QueryRuntimeParams {
  if (!isRecord(value) || !isUidString(value["entity"])) {
    return false;
  }
  const components = value["components"];
  return (
    components === undefined ||
    (Array.isArray(components) &&
      components.length <= QUERY_RUNTIME_MAX_COMPONENTS &&
      components.every((typeId: unknown) => typeof typeId === "string" && typeId.length > 0))
  );
}

/**
 * Checks the `result` of `queryRuntime`.
 *
 * @param value - The received `result`.
 * @returns True for an entity record with at most {@link QUERY_RUNTIME_MAX_COMPONENTS} components,
 * a non-negative integer `omittedComponents` and `frameCount`, and a non-negative finite `time`,
 * no longer than {@link QUERY_RUNTIME_MAX_JSON_LENGTH} as JSON.
 *
 * @public
 */
export function isQueryRuntimeResult(value: unknown): value is QueryRuntimeResult {
  if (!isRecord(value)) {
    return false;
  }
  const entity = value["entity"];
  const omitted = value["omittedComponents"];
  const frameCount = value["frameCount"];
  const time = value["time"];
  return (
    isSceneFileEntity(entity) &&
    (entity.components ?? []).length <= QUERY_RUNTIME_MAX_COMPONENTS &&
    typeof omitted === "number" &&
    Number.isSafeInteger(omitted) &&
    omitted >= 0 &&
    typeof frameCount === "number" &&
    Number.isSafeInteger(frameCount) &&
    frameCount >= 0 &&
    typeof time === "number" &&
    Number.isFinite(time) &&
    time >= 0 &&
    JSON.stringify(value).length <= QUERY_RUNTIME_MAX_JSON_LENGTH
  );
}

/** A `<Keyboard>` control name as `sendInput` accepts it. */
const KEY_CONTROL_PATTERN = /^[A-Za-z0-9]{1,64}$/u;

/**
 * Tells whether a value is a fraction from 0 to 1.
 *
 * @param value - The value to test.
 * @returns True for a finite number from 0 to 1.
 */
function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Checks one event of a `sendInput` request.
 *
 * @param value - The value to test.
 * @returns True for a key event with a well-formed `control`, or a pointer event with `x` and `y`
 * from 0 to 1 and, when present, an integer `button` from 0 to 4.
 *
 * @public
 */
export function isSendInputEvent(value: unknown): value is SendInputEvent {
  if (!isRecord(value)) {
    return false;
  }
  const type = value["type"];
  if (type === "keydown" || type === "keyup") {
    const control = value["control"];
    return typeof control === "string" && KEY_CONTROL_PATTERN.test(control);
  }
  if (type !== "pointermove" && type !== "pointerdown" && type !== "pointerup") {
    return false;
  }
  const button = value["button"];
  return (
    isFraction(value["x"]) &&
    isFraction(value["y"]) &&
    (button === undefined || (typeof button === "number" && Number.isInteger(button) && button >= 0 && button <= 4))
  );
}

/**
 * Checks the `params` of `sendInput`.
 *
 * @param value - The received `params`.
 * @returns True for an `events` list of 1 to {@link SEND_INPUT_MAX_EVENTS} well-formed events.
 *
 * @public
 */
export function isSendInputParams(value: unknown): value is SendInputParams {
  if (!isRecord(value)) {
    return false;
  }
  const events = value["events"];
  return (
    Array.isArray(events) &&
    events.length > 0 &&
    events.length <= SEND_INPUT_MAX_EVENTS &&
    events.every((event: unknown) => isSendInputEvent(event))
  );
}

/**
 * Checks the `result` of `sendInput`.
 *
 * @param value - The received `result`.
 * @returns True for an integer `queued` from 0 to {@link SEND_INPUT_MAX_EVENTS}.
 *
 * @public
 */
export function isSendInputResult(value: unknown): value is SendInputResult {
  if (!isRecord(value)) {
    return false;
  }
  const queued = value["queued"];
  return typeof queued === "number" && Number.isSafeInteger(queued) && queued >= 0 && queued <= SEND_INPUT_MAX_EVENTS;
}
