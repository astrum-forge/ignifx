// A copy of `packages/editor-protocol/src/heartbeat.ts` from `astrum-forge/ignifx-editor` (protocol 0.2).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The heartbeat: how the editor tells a live view from a crashed or hung one. Chromium reports
 * nothing for a dead sub-frame, so silence is the only signal.
 */
import type { RpcNotification } from "./rpc.js";

/**
 * The notifications a host sends on its own.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * @public
 */
export const HostNotification = {
  /** Host → editor, every {@link DEFAULT_HEARTBEAT_INTERVAL_MS} by default after `ready`: the view is alive. */
  heartbeat: "heartbeat",
} as const;

/**
 * The union of the names in `HostNotification`.
 *
 * @public
 */
export type HostNotification = (typeof HostNotification)[keyof typeof HostNotification];

/**
 * The milliseconds between heartbeats when the host is not configured otherwise: one second, so a
 * dead view is noticed within a few.
 *
 * @remarks
 * A host starts its heartbeat after it has answered a compatible `hello` with `ready`, sends it on
 * the current port only, and stops it when that port is replaced or closed. A host that lists
 * `HostCapability.heartbeat` in `ready` sends it, and the editor treats a missing heartbeat as a
 * dead view.
 *
 * @public
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Host → editor: the view is alive. It carries no parameters, so `params` is absent on the wire:
 * `{"jsonrpc":"2.0","method":"heartbeat"}`.
 *
 * @public
 */
export type HeartbeatNotification = RpcNotification<typeof HostNotification.heartbeat, never>;
