// A copy of `packages/editor-protocol/src/play.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The play view's controls: the methods the editor calls on the project's own game page after the
 * handshake, through `attachEditorPlayControls(app)` from `virtual:ignifx/editor`. Plan §3.6.
 */
import { isRecord } from "./rpc.js";
import type { RpcNotification, RpcRequest, RpcSuccessResponse } from "./rpc.js";

/**
 * The methods the play view answers after `ready`. `play`, `pause`, `step` and `stop` answer with a
 * {@link PlayState}; `playState` answers with a {@link PlayStateReport}.
 *
 * @remarks
 * A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
 * fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.
 * `playState` is an additive 0.3 method: a host from before it answers it with
 * `RpcErrorCode.methodNotFound`.
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
 * Editor → play view: one of the `PlayMethod`s. Only `step` takes parameters.
 *
 * @public
 */
export type PlayRequest =
  | RpcRequest<typeof PlayMethod.play, never>
  | RpcRequest<typeof PlayMethod.pause, never>
  | RpcRequest<typeof PlayMethod.step, StepParams>
  | RpcRequest<typeof PlayMethod.stop, never>
  | RpcRequest<typeof PlayMethod.playState, never>;

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
 * `RpcErrorCode.methodNotFound`.
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
