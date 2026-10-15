import { EDITOR_CONNECT_MESSAGE_TYPE, JSON_RPC_VERSION, PROTOCOL_VERSION } from "../../src/protocol/index.js";
import type { ProtocolVersion } from "../../src/protocol/index.js";

/** The origin the tests' editor is served from. */
export const EDITOR_ORIGIN = "ignifx://app";

/** A received message, as a loose record the tests read fields from. */
export type Received = Readonly<Record<string, unknown>>;

/**
 * The editor's end of one channel: posts requests on its port and hands back what the host sends.
 */
export class EditorPeer {
  /** The editor's port. */
  readonly port: MessagePort;
  /** Messages received and not yet taken. */
  readonly #inbox: Received[] = [];
  /** Readers waiting for a message. */
  readonly #waiting: ((message: Received) => void)[] = [];
  /** The next request id. */
  #nextId = 1;
  /** Whether the host closed the other end. */
  #isClosed = false;

  /**
   * Starts listening on the editor's port.
   *
   * @param port - The editor's port.
   */
  constructor(port: MessagePort) {
    this.port = port;
    port.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as Received;
      const reader = this.#waiting.shift();
      if (reader === undefined) {
        this.#inbox.push(message);
      } else {
        reader(message);
      }
    });
    // Node's MessagePort reports a closed peer; a browser's does not.
    port.addEventListener("close", () => {
      this.#isClosed = true;
    });
    port.start();
  }

  /** Whether the host has closed its end. */
  get isClosed(): boolean {
    return this.#isClosed;
  }

  /**
   * Takes the next message the host sent.
   *
   * @returns The message.
   */
  async next(): Promise<Received> {
    const queued = this.#inbox.shift();
    if (queued !== undefined) {
      return queued;
    }
    return new Promise<Received>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  /**
   * Posts a raw value on the port.
   *
   * @param value - What to post.
   */
  post(value: unknown): void {
    // A `MessagePort` has one peer and takes no target origin; the rule is for windows.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- see above.
    this.port.postMessage(value);
  }

  /**
   * Sends a request and waits for its response, skipping notifications.
   *
   * @param method - The method.
   * @param params - Its parameters, if any.
   * @returns The response.
   */
  async request(method: string, params?: unknown): Promise<Received> {
    const id = this.#nextId;
    this.#nextId += 1;
    this.post({ jsonrpc: JSON_RPC_VERSION, id, method, ...(params === undefined ? {} : { params }) });
    for (;;) {
      // Messages arrive in order; awaiting them one at a time is the point.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      const message = await this.next();
      if (message["id"] === id) {
        return message;
      }
    }
  }

  /**
   * Runs the handshake.
   *
   * @param protocol - The protocol version the editor claims.
   * @returns The response to `hello`.
   */
  async hello(protocol: ProtocolVersion = PROTOCOL_VERSION): Promise<Received> {
    return this.request("hello", { editorVersion: "0.1.0", protocol });
  }

  /** Closes the editor's port. */
  close(): void {
    this.port.close();
  }
}

/**
 * Hands the host a fresh port the way the editor does on a view's `load` event.
 *
 * @param target - The host's message target.
 * @param origin - The origin the message claims to come from.
 * @returns The editor's end of the new channel.
 */
export function connect(target: EventTarget, origin: string = EDITOR_ORIGIN): EditorPeer {
  const channel = new MessageChannel();
  target.dispatchEvent(
    new MessageEvent("message", { data: { type: EDITOR_CONNECT_MESSAGE_TYPE }, origin, ports: [channel.port2] }),
  );
  return new EditorPeer(channel.port1);
}

/**
 * Waits until every queued message and microtask has been handled.
 *
 * @returns A promise that settles on the next turn of the event loop.
 */
export async function flushMessages(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** An `EventTarget` that counts its `message` listeners, to prove a host removed its own. */
export class CountingTarget extends EventTarget {
  /** How many `message` listeners are attached. */
  listeners = 0;

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === "message") {
      this.listeners += 1;
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === "message") {
      this.listeners -= 1;
    }
    super.removeEventListener(type, listener, options);
  }
}
