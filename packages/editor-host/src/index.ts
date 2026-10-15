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
export {
  EDITOR_CONNECT_MESSAGE_TYPE,
  HostCapability,
  HostNotification,
  PlayMethod,
  type EditorConnectMessage,
  type HeartbeatNotification,
  type PlayRequest,
  type PlayResponse,
  type PlayState,
  type StepParams,
} from "./messages.js";
export { startEditorPlayControls, type EditorPlayControls, type EditorPlayControlsOptions } from "./play-controls.js";
export {
  HandshakeMethod,
  HostKind,
  isRpcMessage,
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
  protocolVersionIsCompatible,
  RpcErrorCode,
  type HelloParams,
  type HelloRequest,
  type PingRequest,
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
} from "./protocol.js";
