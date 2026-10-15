/**
 * The editor protocol, version 0.1: JSON-RPC 2.0 envelopes, the `hello`/`ready` handshake and
 * `ping`/`"pong"`, exactly as `@ignifx/editor-protocol` 0.1 defines them.
 *
 * These declarations are a copy. `@ignifx/editor-protocol` is published from the editor repository
 * (`astrum-forge/ignifx-editor`), and once it is on npm this package depends on it and this file
 * goes away (ADR-E008 in that repository). Until then, keep every shape here identical to the
 * editor's `packages/editor-protocol/src/{rpc,handshake,version}.ts`, and change it only when those
 * change. Messages the host speaks that 0.1 does not define yet live in `messages.ts`.
 */

// From `rpc.ts`.

/**
 * The value of every envelope's `jsonrpc` field.
 *
 * @public
 */
export const JSON_RPC_VERSION = "2.0";

/**
 * A request id, chosen by the sender and echoed in the response.
 *
 * @public
 */
export type RpcId = string | number;

/**
 * The error codes a peer may send. The first five are JSON-RPC's own; the rest use the range
 * JSON-RPC reserves for implementations (-32000 to -32099).
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * @public
 */
export const RpcErrorCode = {
  /** The message was not valid JSON. */
  parseError: -32_700,
  /** The message was JSON but not a valid request. */
  invalidRequest: -32_600,
  /** No handler exists for the method. */
  methodNotFound: -32_601,
  /** The method exists but its `params` are wrong. */
  invalidParams: -32_602,
  /** The handler failed. */
  internalError: -32_603,
  /** The peers' protocol majors differ (see `protocolVersionIsCompatible`). */
  incompatibleProtocol: -32_000,
  /** The peer has not finished its handshake and cannot answer this method yet. */
  notReady: -32_001,
} as const;

/**
 * The union of the codes in `RpcErrorCode`.
 *
 * @public
 */
export type RpcErrorCode = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

/**
 * The `error` member of a failed response.
 *
 * @public
 */
export interface RpcError {
  /** What kind of failure it was. */
  readonly code: RpcErrorCode;
  /** A short, human-readable description. */
  readonly message: string;
  /** Extra detail for debugging; its shape depends on the method. */
  readonly data?: unknown;
}

/**
 * A call that expects a response with the same `id`.
 *
 * @typeParam M - The method name.
 * @typeParam P - The parameters; omitted when the method takes none.
 *
 * @public
 */
export interface RpcRequest<M extends string = string, P = unknown> {
  /** Always `"2.0"`. */
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  /** Matches the response to this request. */
  readonly id: RpcId;
  /** The method to call. */
  readonly method: M;
  /** The method's arguments, an object or an array in JSON. */
  readonly params?: P;
}

/**
 * A one-way message: like a request, but with no `id` and no response.
 *
 * @typeParam M - The method name.
 * @typeParam P - The parameters; omitted when the method takes none.
 *
 * @public
 */
export interface RpcNotification<M extends string = string, P = unknown> {
  /** Always `"2.0"`. */
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  /** The event or method being signalled. */
  readonly method: M;
  /** The message's arguments, an object or an array in JSON. */
  readonly params?: P;
}

/**
 * The answer to a request that succeeded.
 *
 * @typeParam R - The result.
 *
 * @public
 */
export interface RpcSuccessResponse<R = unknown> {
  /** Always `"2.0"`. */
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  /** The `id` of the request being answered. */
  readonly id: RpcId;
  /** What the method returned. */
  readonly result: R;
}

/**
 * The answer to a request that failed.
 *
 * @public
 */
export interface RpcErrorResponse {
  /** Always `"2.0"`. */
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  /** The `id` of the request being answered, or `null` when it could not be read. */
  readonly id: RpcId | null;
  /** Why the request failed. */
  readonly error: RpcError;
}

/**
 * The answer to a request: a result or an error, never both.
 *
 * @typeParam R - The result on success.
 *
 * @public
 */
export type RpcResponse<R = unknown> = RpcSuccessResponse<R> | RpcErrorResponse;

/**
 * Any message that can travel on an editor channel.
 *
 * @public
 */
export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

/**
 * Narrows to a plain object without an `as` assertion.
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a JSON value is a valid request or notification id.
 *
 * @param value - The value to test.
 * @returns True for a string or a finite number.
 */
function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Tells whether a JSON value is a valid `error` member with a known code.
 *
 * @param value - The value to test.
 * @returns True when its `code` is one of `RpcErrorCode` and its `message` is a string.
 */
function isRpcError(value: unknown): value is RpcError {
  return (
    isRecord(value) &&
    Object.values(RpcErrorCode).some((code) => code === value["code"]) &&
    typeof value["message"] === "string"
  );
}

/**
 * Checks the envelope of a received message: a request, a notification, or a response. It does not
 * check a method's `params` or `result`; that is the handler's job.
 *
 * @param value - A value parsed from JSON or received through `postMessage`.
 * @returns True when `value` is a well-formed JSON-RPC 2.0 message with a known error code, if any.
 *
 * @public
 */
export function isRpcMessage(value: unknown): value is RpcMessage {
  if (!isRecord(value) || value["jsonrpc"] !== JSON_RPC_VERSION) {
    return false;
  }
  if ("method" in value) {
    // JSON-RPC allows `params` to be absent, an object or an array, but never `null` or a scalar.
    const params = value["params"];
    const hasValidParams = !("params" in value) || (typeof params === "object" && params !== null);
    const hasValidId = !("id" in value) || isRpcId(value["id"]);
    return typeof value["method"] === "string" && hasValidParams && hasValidId;
  }
  const hasResult = "result" in value;
  const hasError = "error" in value;
  if (hasResult === hasError) {
    return false;
  }
  if (hasResult) {
    return isRpcId(value["id"]);
  }
  return (value["id"] === null || isRpcId(value["id"])) && isRpcError(value["error"]);
}

// From `handshake.ts`.

/**
 * The method names of the handshake.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * @public
 */
export const HandshakeMethod = {
  /** Editor → host: the first message on a new channel. */
  hello: "hello",
  /** Either direction: a liveness check, answered with `"pong"`. */
  ping: "ping",
} as const;

/**
 * The union of the names in `HandshakeMethod`.
 *
 * @public
 */
export type HandshakeMethod = (typeof HandshakeMethod)[keyof typeof HandshakeMethod];

/**
 * Which kind of view a host runs.
 *
 * @public
 */
export const HostKind = {
  /** The scene view: an edit-mode app that applies document ops and draws gizmos. */
  scene: "scene",
  /** The play view: the project's own page, running the game. */
  play: "play",
} as const;

/**
 * The union of the kinds in `HostKind`.
 *
 * @public
 */
export type HostKind = (typeof HostKind)[keyof typeof HostKind];

/**
 * What the editor says about itself in `hello`.
 *
 * @public
 */
export interface HelloParams {
  /** The editor's own version, for example `"0.1.0"`. */
  readonly editorVersion: string;
  /** The protocol version the editor speaks. */
  readonly protocol: ProtocolVersion;
}

/**
 * Editor → host: the first request on a new channel.
 *
 * @public
 */
export interface HelloRequest extends RpcRequest<typeof HandshakeMethod.hello, HelloParams> {
  /** What the editor says about itself. */
  readonly params: HelloParams;
}

/**
 * What a host says about itself in answer to `hello`.
 *
 * @public
 */
export interface ReadyResult {
  /** The version of `@ignifx/core` the project runs, for example `"0.9.0"`. */
  readonly engineVersion: string;
  /** The protocol version the host speaks. */
  readonly protocol: ProtocolVersion;
  /** Optional features the host supports. Names are added as the protocol grows; unknown names are ignored. */
  readonly capabilities: readonly string[];
  /** Which view the host runs. */
  readonly hostKind: HostKind;
}

/**
 * Host → editor: the successful answer to {@link HelloRequest}.
 *
 * @public
 */
export type ReadyResponse = RpcSuccessResponse<ReadyResult>;

/**
 * Either direction: a liveness check. It takes no parameters.
 *
 * @public
 */
export type PingRequest = RpcRequest<typeof HandshakeMethod.ping, never>;

/**
 * The answer to {@link PingRequest}.
 *
 * @public
 */
export type PongResponse = RpcSuccessResponse<"pong">;

// From `version.ts`.

/**
 * A protocol version. `major` changes when a message changes incompatibly; `minor` when messages
 * or fields are added in a way an older peer can ignore.
 *
 * @public
 */
export interface ProtocolVersion {
  /** Incremented for incompatible changes. Peers must agree on it. */
  readonly major: number;
  /** Incremented for compatible additions. Peers may differ. */
  readonly minor: number;
}

/**
 * The protocol version this package describes. Both sides send it in the handshake.
 *
 * @public
 */
export const PROTOCOL_VERSION: ProtocolVersion = { major: 0, minor: 1 };

/**
 * Tells whether two peers can talk: they can when their major versions are equal.
 *
 * @param a - One peer's protocol version.
 * @param b - The other peer's protocol version.
 * @returns `true` when the majors match; the minors are free to differ.
 *
 * @public
 */
export function protocolVersionIsCompatible(a: ProtocolVersion, b: ProtocolVersion): boolean {
  return a.major === b.major;
}
