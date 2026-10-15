// A copy of `packages/editor-protocol/src/play.ts` from `astrum-forge/ignifx-editor` (protocol 0.2).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The play view's controls: the methods the editor calls on the project's own game page after the
 * handshake, through `attachEditorPlayControls(app)` from `virtual:ignifx/editor`. Plan §3.6.
 */
import { isRecord } from "./rpc.js";
import type { RpcRequest, RpcSuccessResponse } from "./rpc.js";

/**
 * The methods the play view answers after `ready`. Each one answers with a {@link PlayState}.
 *
 * @remarks
 * A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
 * fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.
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
  | RpcRequest<typeof PlayMethod.stop, never>;

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
 * Play view → editor: the answer to a {@link PlayRequest}.
 *
 * @public
 */
export type PlayResponse = RpcSuccessResponse<PlayState>;

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
