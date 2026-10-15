/**
 * The host half of an editor channel: accepts the `MessagePort` the editor posts to the view's
 * window, runs the `hello`/`ready` handshake, answers requests, and sends heartbeats. The scene
 * host and the play controls each open one.
 */

import { IgnifxError } from "@ignifx/core";
import { EditorHostErrorCode, isEditorOrigin } from "./error-codes.js";
import { EDITOR_CONNECT_MESSAGE_TYPE, HostNotification } from "./messages.js";
import {
  HandshakeMethod,
  isRpcMessage,
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
  protocolVersionIsCompatible,
  RpcErrorCode,
} from "./protocol.js";
import type { HelloParams, ReadyResult, RpcErrorResponse, RpcId, RpcSuccessResponse } from "./protocol.js";

/**
 * Where a host listens for the editor's connect message: the view's `window` in a browser, or any
 * `EventTarget` that dispatches `MessageEvent`s, which is how a headless test stands in for one.
 * Events that are not `MessageEvent`s are ignored.
 *
 * @beta
 */
export interface EditorMessageTarget {
  /**
   * Subscribes to window messages.
   *
   * @param type - Always `"message"`.
   * @param listener - Receives each message.
   */
  addEventListener(type: "message", listener: (event: Event) => void): void;
  /**
   * Unsubscribes a listener added with `addEventListener`.
   *
   * @param type - Always `"message"`.
   * @param listener - The listener to remove.
   */
  removeEventListener(type: "message", listener: (event: Event) => void): void;
}

/** A request handler. It may be asynchronous; whatever it throws becomes an `internalError` reply. */
export type RequestHandler = (params: unknown) => unknown;

/** A handler's way of refusing its parameters with `invalidParams` rather than `internalError`. */
export class InvalidParamsError extends Error {
  /**
   * Creates the refusal.
   *
   * @param message - What is wrong with the parameters.
   */
  constructor(message: string) {
    super(message);
    this.name = "InvalidParamsError";
  }
}

/** What {@link openChannel} needs. */
export interface ChannelOptions {
  /** Where the connect message arrives. */
  readonly target: EditorMessageTarget;
  /** The only origin a port is accepted from. */
  readonly editorOrigin: string;
  /** The `ready` result, sent in answer to a compatible `hello`. */
  readonly ready: ReadyResult;
  /** Methods answered after the handshake, by name. */
  readonly methods: ReadonlyMap<string, RequestHandler>;
  /** Milliseconds between heartbeats. */
  readonly heartbeatIntervalMs: number;
}

/** An open channel. */
export interface Channel {
  /** Whether a port has been accepted and not replaced or closed. */
  readonly isConnected: boolean;
  /** Removes the window listener, stops the heartbeat, and closes the port. Idempotent. */
  dispose(): void;
}

/** The heartbeat's default period: one second, so a dead view is noticed within a few. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Narrows to a plain object.
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the parameters of `hello`.
 *
 * @param value - The received `params`.
 * @returns True when they carry an editor version and an integer protocol version.
 */
function isHelloParams(value: unknown): value is HelloParams {
  if (!isRecord(value) || typeof value["editorVersion"] !== "string") {
    return false;
  }
  const protocol = value["protocol"];
  return isRecord(protocol) && Number.isInteger(protocol["major"]) && Number.isInteger(protocol["minor"]);
}

/**
 * Builds a success response.
 *
 * @param id - The request id.
 * @param result - The result.
 * @returns The envelope.
 */
function success(id: RpcId, result: unknown): RpcSuccessResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

/**
 * Builds an error response.
 *
 * @param id - The request id, or `null` when it could not be read.
 * @param code - The error code.
 * @param message - A short description.
 * @param data - Extra detail, if any.
 * @returns The envelope.
 */
function failure(id: RpcId | null, code: RpcErrorCode, message: string, data?: unknown): RpcErrorResponse {
  const error = data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: JSON_RPC_VERSION, id, error };
}

/**
 * Posts one message on a port.
 *
 * @param port - The port the editor handed over.
 * @param message - The envelope to send.
 */
function send(port: MessagePort, message: unknown): void {
  // A `MessagePort` has exactly one peer, so it takes no target origin; the rule is for windows.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- see above.
  port.postMessage(message);
}

/**
 * Checks the options every host shares and throws the documented error for a bad one.
 *
 * @param editorOrigin - The origin the editor is served from.
 * @param heartbeatIntervalMs - The heartbeat period, if given.
 * @returns The heartbeat period with its default applied.
 * @throws IgnifxError `IGX-1801` for an origin that is not `scheme://host[:port]`, `IGX-1803` for a
 * period that is not a positive finite number.
 */
export function checkChannelOptions(editorOrigin: string, heartbeatIntervalMs: number | undefined): number {
  if (!isEditorOrigin(editorOrigin)) {
    throw new IgnifxError(
      EditorHostErrorCode.invalidEditorOrigin,
      `"${editorOrigin}" is not an origin the editor can be served from.`,
      { hint: 'Pass the editor\'s origin exactly as the browser reports it, for example "ignifx://app".' },
    );
  }
  const interval = heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new IgnifxError(
      EditorHostErrorCode.invalidOption,
      `heartbeatIntervalMs must be a positive number of milliseconds; got ${String(interval)}.`,
      { context: { option: "heartbeatIntervalMs" } },
    );
  }
  return interval;
}

/**
 * Picks the window a host listens on.
 *
 * @param target - The target the caller passed, if any.
 * @returns That target, or the page's `window`.
 * @throws IgnifxError `IGX-1802` when there is neither, as in Node.
 */
export function resolveMessageTarget(target: EditorMessageTarget | undefined): EditorMessageTarget {
  if (target !== undefined) {
    return target;
  }
  if (typeof window === "undefined") {
    throw new IgnifxError(
      EditorHostErrorCode.noMessageTarget,
      "The editor host needs a window to receive the editor's port, and this environment has none.",
      { hint: "Pass messageTarget, for example an EventTarget a test dispatches MessageEvents on." },
    );
  }
  return window;
}

/**
 * Opens a channel: listens for the editor's connect message and serves whichever port arrived last.
 *
 * @remarks
 * Call it before the host's first `await`. The editor posts the port on the view's `load` event,
 * which can fire while `createApp` is still running, and a message nobody listens for is lost.
 *
 * @param options - The target, origin, handshake answer, methods, and heartbeat period.
 * @returns The channel; dispose it with the host.
 */
export function openChannel(options: ChannelOptions): Channel {
  const { target, editorOrigin, ready, methods, heartbeatIntervalMs } = options;
  let port: MessagePort | null = null;
  let portListener: ((event: MessageEvent) => void) | null = null;
  let isReady = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let isDisposed = false;

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const closePort = (): void => {
    stopHeartbeat();
    isReady = false;
    if (port !== null && portListener !== null) {
      port.removeEventListener("message", portListener);
      port.close();
    }
    port = null;
    portListener = null;
  };

  const handshake = (id: RpcId, params: unknown): RpcSuccessResponse | RpcErrorResponse => {
    if (!isHelloParams(params)) {
      return failure(id, RpcErrorCode.invalidParams, "hello needs { editorVersion, protocol: { major, minor } }.");
    }
    if (!protocolVersionIsCompatible(params.protocol, PROTOCOL_VERSION)) {
      return failure(
        id,
        RpcErrorCode.incompatibleProtocol,
        `The editor speaks protocol ${String(params.protocol.major)}.${String(params.protocol.minor)} and this ` +
          `host speaks ${String(PROTOCOL_VERSION.major)}.${String(PROTOCOL_VERSION.minor)}. Update the editor, ` +
          "or the project's @ignifx packages, so the protocol majors match.",
        { host: PROTOCOL_VERSION, engineVersion: ready.engineVersion },
      );
    }
    isReady = true;
    return success(id, ready);
  };

  const answer = async (id: RpcId, method: string, params: unknown): Promise<RpcSuccessResponse | RpcErrorResponse> => {
    if (method === HandshakeMethod.hello) {
      return handshake(id, params);
    }
    if (method === HandshakeMethod.ping) {
      return success(id, "pong");
    }
    const handler = methods.get(method);
    if (handler === undefined) {
      return failure(id, RpcErrorCode.methodNotFound, `This host has no method "${method}".`);
    }
    if (!isReady) {
      return failure(id, RpcErrorCode.notReady, `Send hello before "${method}".`);
    }
    try {
      return success(id, await handler(params));
    } catch (error) {
      if (error instanceof InvalidParamsError) {
        return failure(id, RpcErrorCode.invalidParams, error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof IgnifxError ? error.code : null;
      return failure(id, RpcErrorCode.internalError, message, { code });
    }
  };

  const startHeartbeat = (current: MessagePort): void => {
    if (heartbeat !== null) {
      return;
    }
    const notification = { jsonrpc: JSON_RPC_VERSION, method: HostNotification.heartbeat };
    heartbeat = setInterval(() => {
      send(current, notification);
    }, heartbeatIntervalMs);
  };

  const onPortMessage = async (current: MessagePort, data: unknown): Promise<void> => {
    if (!isRpcMessage(data)) {
      send(current, failure(null, RpcErrorCode.invalidRequest, "Not a JSON-RPC 2.0 message."));
      return;
    }
    // Responses and notifications from the editor need no answer, and none is defined yet.
    if (!("method" in data) || !("id" in data)) {
      return;
    }
    const response = await answer(data.id, data.method, data.params);
    // A reload or a reconnect may have replaced the port while an asynchronous method ran.
    if (current !== port) {
      return;
    }
    send(current, response);
    if (isReady) {
      startHeartbeat(current);
    }
  };

  const accept = (next: MessagePort): void => {
    closePort();
    const listener = (event: MessageEvent): void => {
      // Detached on purpose: replies go out on the port, and `answer` turns every failure into one.
      void onPortMessage(next, event.data);
    };
    port = next;
    portListener = listener;
    next.addEventListener("message", listener);
    next.start();
  };

  const onWindowMessage = (event: Event): void => {
    // Anyone can post to a window; only the editor's own origin may hand the host a port.
    if (!(event instanceof MessageEvent) || event.origin !== editorOrigin) {
      return;
    }
    const data: unknown = event.data;
    const next = event.ports[0];
    if (
      !isRecord(data) ||
      data["type"] !== EDITOR_CONNECT_MESSAGE_TYPE ||
      event.ports.length !== 1 ||
      next === undefined
    ) {
      return;
    }
    accept(next);
  };

  target.addEventListener("message", onWindowMessage);

  return {
    get isConnected(): boolean {
      return port !== null;
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      target.removeEventListener("message", onWindowMessage);
      closePort();
    },
  };
}
