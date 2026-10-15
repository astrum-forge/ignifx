// A copy of `packages/editor-protocol/src/connect.ts` from `astrum-forge/ignifx-editor` (protocol 0.2).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The window message that hands a view its `MessagePort`. It is the only message that travels
 * outside the port: everything after it is JSON-RPC on the port (`rpc.ts`, `handshake.ts`).
 */
import { isRecord } from "./rpc.js";

/**
 * The `type` of the window message that hands a host its `MessagePort`.
 *
 * @remarks
 * The editor posts `{ type: EDITOR_CONNECT_MESSAGE_TYPE }` to the view's window, targeted at the
 * view's origin, with the port as the one transferred object. It posts a fresh one after every load
 * of the view: a port that has been transferred once cannot be sent again, and the newest port
 * replaces the previous one. The host ignores the message unless `event.origin` is the editor's
 * origin, the data is this shape, and exactly one port is attached.
 *
 * @example
 * ```ts
 * const channel = new MessageChannel();
 * frame.contentWindow?.postMessage({ type: EDITOR_CONNECT_MESSAGE_TYPE }, "http://127.0.0.1:5173", [channel.port2]);
 * ```
 *
 * @public
 */
export const EDITOR_CONNECT_MESSAGE_TYPE = "ignifx-editor/connect";

/**
 * The window message that hands a host its `MessagePort`; the port travels as its one transferred
 * object, not inside the data.
 *
 * @public
 */
export interface EditorConnectMessage {
  /** Always {@link EDITOR_CONNECT_MESSAGE_TYPE}. */
  readonly type: typeof EDITOR_CONNECT_MESSAGE_TYPE;
}

/**
 * Tells whether a window message's data is the connect message. It checks the data only; the
 * caller still checks `event.origin` and that `event.ports` holds exactly one port.
 *
 * @param value - The `data` of a received `MessageEvent`.
 * @returns True when `value` is an object whose `type` is {@link EDITOR_CONNECT_MESSAGE_TYPE}.
 *
 * @public
 */
export function isEditorConnectMessage(value: unknown): value is EditorConnectMessage {
  return isRecord(value) && value["type"] === EDITOR_CONNECT_MESSAGE_TYPE;
}
