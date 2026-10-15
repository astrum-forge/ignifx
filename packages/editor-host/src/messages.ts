/**
 * Messages the host speaks that `@ignifx/editor-protocol` 0.1 does not define yet: the connect
 * message that delivers the port, the heartbeat, and the play-view controls. They are proposed for
 * the next protocol minor; until it is published they are declared here, on top of the 0.1 shapes
 * in `protocol.ts`.
 */

import type { RpcNotification, RpcRequest, RpcSuccessResponse } from "./protocol.js";

/**
 * The `type` of the window message that hands a host its `MessagePort`.
 *
 * @remarks
 * The editor posts `{ type: EDITOR_CONNECT_MESSAGE_TYPE }` to the view's window with the port as
 * the one transferred object, and posts a fresh one after every reload of the view: a port that has
 * been transferred once cannot be sent again.
 *
 * @example
 * ```ts
 * const channel = new MessageChannel();
 * frame.contentWindow?.postMessage({ type: EDITOR_CONNECT_MESSAGE_TYPE }, "http://127.0.0.1:5173", [channel.port2]);
 * ```
 *
 * @beta
 */
export const EDITOR_CONNECT_MESSAGE_TYPE = "ignifx-editor/connect";

/**
 * The window message that hands a host its `MessagePort`; the port travels as its one transferred
 * object.
 *
 * @beta
 */
export interface EditorConnectMessage {
  /** Always {@link EDITOR_CONNECT_MESSAGE_TYPE}. */
  readonly type: typeof EDITOR_CONNECT_MESSAGE_TYPE;
}

/**
 * The notifications a host sends on its own.
 *
 * @beta
 */
export const HostNotification = {
  /** Host → editor, about once a second after `ready`: the view is alive. */
  heartbeat: "heartbeat",
} as const;

/**
 * The union of the names in `HostNotification`.
 *
 * @beta
 */
export type HostNotification = (typeof HostNotification)[keyof typeof HostNotification];

/**
 * Host → editor: the view is alive. It carries no parameters. A view whose heartbeats stop has
 * crashed or hung; Chromium reports nothing else for a dead sub-frame.
 *
 * @beta
 */
export type HeartbeatNotification = RpcNotification<typeof HostNotification.heartbeat, never>;

/**
 * The optional features a host lists in its `ready` result.
 *
 * @beta
 */
export const HostCapability = {
  /** The host sends {@link HeartbeatNotification}s after `ready`. */
  heartbeat: "heartbeat",
  /** The host answers the methods in `PlayMethod`. */
  playControls: "playControls",
} as const;

/**
 * The union of the names in `HostCapability`.
 *
 * @beta
 */
export type HostCapability = (typeof HostCapability)[keyof typeof HostCapability];

/**
 * The methods the play view answers after `ready`. Each one answers with a {@link PlayState}.
 *
 * @beta
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
 * @beta
 */
export type PlayMethod = (typeof PlayMethod)[keyof typeof PlayMethod];

/**
 * The parameters of the `step` method.
 *
 * @beta
 */
export interface StepParams {
  /** The frame delta in seconds. Defaults to `app.time.fixedDeltaTime`. */
  readonly deltaSeconds?: number;
}

/**
 * Editor → play view: one of the `PlayMethod`s.
 *
 * @beta
 */
export type PlayRequest =
  | RpcRequest<typeof PlayMethod.play, never>
  | RpcRequest<typeof PlayMethod.pause, never>
  | RpcRequest<typeof PlayMethod.step, StepParams>
  | RpcRequest<typeof PlayMethod.stop, never>;

/**
 * What the play view reports after every `PlayMethod`.
 *
 * @beta
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
 * @beta
 */
export type PlayResponse = RpcSuccessResponse<PlayState>;
