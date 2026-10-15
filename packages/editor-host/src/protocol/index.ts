/**
 * The editor protocol, version 0.2, exactly as `@ignifx/editor-protocol` 0.2 defines it.
 *
 * These modules are a copy. `@ignifx/editor-protocol` is published from the editor repository
 * (`astrum-forge/ignifx-editor`), and once it is on npm this package depends on it and this
 * directory goes away (ADR-E008 in that repository). Until then each file here mirrors the editor's
 * `packages/editor-protocol/src/` module of the same name below its two-line header, and changes
 * only when that module changes. The code is byte-identical. The comments are too, except that a
 * `{@link X}` naming one of the six `as const` objects that share their name with a type
 * (`HandshakeMethod`, `HostKind`, `HostCapability`, `HostNotification`, `PlayMethod`,
 * `RpcErrorCode`) is written `` `X` ``: API Extractor cannot tell which of the two declarations
 * such a link means, and this package's API report fails on the warning. The editor's `ipc.ts`
 * names Electron IPC channels, which a host never opens, so it is not copied; otherwise this
 * barrel re-exports what the editor's `index.ts` does, in the same order.
 */

export { EDITOR_CONNECT_MESSAGE_TYPE, isEditorConnectMessage, type EditorConnectMessage } from "./connect.js";
export {
  HandshakeMethod,
  HostCapability,
  HostKind,
  type HelloParams,
  type HelloRequest,
  type PingRequest,
  type PongResponse,
  type ReadyResponse,
  type ReadyResult,
} from "./handshake.js";
export { DEFAULT_HEARTBEAT_INTERVAL_MS, HostNotification, type HeartbeatNotification } from "./heartbeat.js";
export {
  isPlayState,
  PlayMethod,
  type PlayRequest,
  type PlayResponse,
  type PlayState,
  type StepParams,
} from "./play.js";
export {
  isRpcMessage,
  JSON_RPC_VERSION,
  RpcErrorCode,
  type RpcError,
  type RpcErrorResponse,
  type RpcId,
  type RpcMessage,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccessResponse,
} from "./rpc.js";
export { PROTOCOL_VERSION, protocolVersionIsCompatible, type ProtocolVersion } from "./version.js";
