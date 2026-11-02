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
 * {@link QueryRuntimeResult}.
 *
 * @remarks
 * A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
 * fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.
 * `playState`, `playStats`, `screenshot` and `queryRuntime` are additive 0.3 methods: a host from
 * before one answers it with `RpcErrorCode.methodNotFound`. `screenshot` also needs
 * `HostCapability.screenshot` in the play view's `ready`, and `queryRuntime`
 * `HostCapability.queryRuntime`.
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
   * component does not serialize, and no expressions. Changes nothing. Needs
   * `HostCapability.queryRuntime`. Fails with `RpcErrorCode.notPlaying` while the game is stopped
   * (before it starts, after `stop`; a stepped game is paused and answers), and with
   * `RpcErrorCode.unknownEntity` when no entity of the game has the uid.
   */
  queryRuntime: "queryRuntime",
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
   * given). Each string is clipped to `HOST_TEXT_MAX_LENGTH` and each list cut to
   * `HOST_LIST_MAX_LENGTH`.
   */
  readonly entity: SceneFileEntity;
  /** How many matching components did not fit under {@link QUERY_RUNTIME_MAX_COMPONENTS}. */
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
 * Editor → play view: one of the `PlayMethod`s. Only `step`, `screenshot` and `queryRuntime` take
 * parameters.
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
  | RpcRequestWithParams<typeof PlayMethod.queryRuntime, QueryRuntimeParams>;

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
 * a non-negative integer `omittedComponents` and `frameCount`, and a non-negative finite `time`.
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
    time >= 0
  );
}
