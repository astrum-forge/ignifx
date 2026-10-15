// A copy of `packages/editor-protocol/src/rpc.ts` from `astrum-forge/ignifx-editor` (protocol 0.2).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * JSON-RPC 2.0 envelopes (https://www.jsonrpc.org/specification) shared by every editor channel:
 * editor↔host and editor↔play over a `MessagePort`.
 */

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
  /** The peers' protocol versions are incompatible (see `protocolVersionIsCompatible`). */
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
 * Narrows to a plain object without an `as` assertion. Shared by this package's guards; not
 * re-exported from the barrel.
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 *
 * @internal
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
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
