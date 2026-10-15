/**
 * `@ignifx/editor-host` public barrel: the page half of the ignifx editor's host. It runs inside a
 * project's own dev server, from the project's own `@ignifx/core`, in the editor's scene view and
 * play view, and speaks the editor protocol over a `MessagePort`
 * (`docs/architecture/17-editor-host.md`). The Vite plugin is the `@ignifx/editor-host/vite` entry.
 *
 * Explicit named re-exports only, no `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

export type { EditorMessageTarget } from "./channel.js";
export { EditorHostErrorCode, isEditorOrigin } from "./error-codes.js";
export { startEditorHost, type EditorHost, type EditorHostOptions } from "./host.js";
export { startEditorPlayControls, type EditorPlayControls, type EditorPlayControlsOptions } from "./play-controls.js";
export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  EDITOR_CONNECT_MESSAGE_TYPE,
  HandshakeMethod,
  HostCapability,
  HostKind,
  HostNotification,
  isEditorConnectMessage,
  isPlayState,
  isRpcMessage,
  JSON_RPC_VERSION,
  PlayMethod,
  PROTOCOL_VERSION,
  protocolVersionIsCompatible,
  RpcErrorCode,
  type EditorConnectMessage,
  type HeartbeatNotification,
  type HelloParams,
  type HelloRequest,
  type PingRequest,
  type PlayRequest,
  type PlayResponse,
  type PlayState,
  type PongResponse,
  type ProtocolVersion,
  type ReadyResponse,
  type ReadyResult,
  type RpcError,
  type RpcErrorResponse,
  type RpcId,
  type RpcMessage,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccessResponse,
  type StepParams,
} from "./protocol/index.js";
