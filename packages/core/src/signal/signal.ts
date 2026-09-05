import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * A listener attached to a {@link Signal}.
 *
 * @public
 */
export type SignalHandler<T> = (value: T) => void;

/**
 * Detaches a handler from a {@link Signal}. Calling it more than once is a no-op.
 *
 * @public
 */
export type Disconnect = () => void;

/**
 * Anything whose destruction should take its signal connections with it: an `Entity`, a
 * `Component`, a `SceneInstance`. Connecting with an `owner` is how scripts avoid leaking handlers,
 * and the `ignifx/signal-connect-owner` lint rule requires it inside a `Script`
 * (`docs/architecture/02-scene-graph.md` §8).
 *
 * @public
 */
export interface SignalOwner {
  /** Whether the owner has already been destroyed. */
  readonly isDestroyed: boolean;
  /**
   * Emitted once when the owner is destroyed; the signal uses it to detach the handler.
   *
   * @remarks
   * Typed as {@link SignalLike} rather than {@link Signal} so that an owner may expose a precisely
   * typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
   * `docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
   * invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.
   */
  readonly onDestroyed: SignalLike<unknown>;
}

/**
 * The scheduler that runs deferred deliveries. The core frame loop implements it on the
 * `EndOfFrame` phase; tests can pass a queue that runs callbacks on demand.
 *
 * @public
 */
export interface DeferredQueue {
  /**
   * Schedules a callback to run at the next flush point.
   *
   * @param callback - The delivery to run.
   */
  enqueue(callback: () => void): void;
}

/**
 * Options for {@link Signal.connect}.
 *
 * @public
 */
export interface ConnectOptions {
  /** Disconnect the handler after its first delivery. */
  readonly once?: boolean;
  /**
   * Queue the delivery on the signal's {@link DeferredQueue} instead of calling the handler inside
   * `emit` (Godot's `CONNECT_DEFERRED`).
   */
  readonly deferred?: boolean;
  /** Disconnect the handler automatically when this object is destroyed. */
  readonly owner?: SignalOwner;
}

/**
 * Options for the {@link Signal} constructor, where `T` is the payload the signal emits.
 *
 * @public
 */
export interface SignalOptions<T> {
  /** The scheduler used by `deferred` connections. Without it, `deferred: true` throws. */
  readonly deferredQueue?: DeferredQueue;
  /**
   * Where handler exceptions go. When set, every exception is reported here and delivery continues;
   * when absent, the first exception is rethrown as `IGX-0104` once every handler has run. The app
   * passes a reporter that routes to `app.onError`. It must not throw.
   */
  readonly onHandlerError?: (error: unknown, signal: Signal<T>) => void;
}

/**
 * The read-only half of a {@link Signal}: what a public API exposes when callers may subscribe but
 * must not emit, where `T` is the payload the signal emits.
 *
 * @example
 * ```ts
 * interface Assets {
 *   readonly onLoaded: SignalLike<AssetHandle>;
 * }
 * ```
 *
 * @public
 */
export interface SignalLike<T = void> {
  /** How many handlers are currently attached. */
  readonly connectionCount: number;

  /**
   * Attaches a handler.
   *
   * @param handler - The listener.
   * @param options - `once`, `deferred`, and `owner`.
   * @returns A function that detaches the handler.
   */
  connect(handler: SignalHandler<T>, options?: ConnectOptions): Disconnect;
}

/** One attached handler. `handler === null` marks the entry dead and awaiting compaction. */
class Connection<T> {
  handler: SignalHandler<T> | null;
  readonly once: boolean;
  readonly deferred: boolean;
  /** Index into the owning signal's connection list; kept current by swap-remove. */
  index: number;
  /** Detaches the auto-disconnect handler from `owner.onDestroyed`. */
  ownerDisconnect: Disconnect | null = null;

  constructor(handler: SignalHandler<T>, once: boolean, deferred: boolean, index: number) {
    this.handler = handler;
    this.once = once;
    this.deferred = deferred;
    this.index = index;
  }
}

/** Returned when connecting to a signal on behalf of an already-destroyed owner. */
function noopDisconnect(): void {
  // Nothing was connected, so nothing has to be detached.
}

/**
 * A typed, synchronous, many-listener event (`docs/architecture/02-scene-graph.md` §8). Signals are
 * the "signal up" half of the engine's *call down, signal up* convention: a parent calls methods on
 * the children it owns, a child announces what happened and lets interested parties subscribe.
 *
 * @remarks
 * Delivery guarantees:
 *
 * - Handlers run in connection order, synchronously, inside {@link Signal.emit}.
 * - A handler connected *during* an emit runs on the next emit, never the one in flight.
 * - A handler disconnected during an emit never runs again, including in the emit in flight.
 * - One handler throwing does not stop delivery to the others.
 * - Nothing is allocated per emit on the non-deferred path (coding standards §7).
 *
 * The payload type `T` defaults to `void`, so `signal.emit()` takes no argument.
 *
 * @example
 * ```ts
 * class Health extends Script {
 *   readonly onDied = new Signal<Entity>();
 *   damage(amount: number): void {
 *     this.hp -= amount;
 *     if (this.hp <= 0) {
 *       this.onDied.emit(this.entity);
 *     }
 *   }
 * }
 *
 * health.onDied.connect((entity) => this.spawnLoot(entity), { owner: this, once: true });
 * ```
 *
 * @public
 */
export class Signal<T = void> implements SignalLike<T> {
  readonly #connections: Connection<T>[] = [];
  readonly #deferredQueue: DeferredQueue | null;
  readonly #onHandlerError: ((error: unknown, signal: Signal<T>) => void) | null;
  #liveCount = 0;
  #deadCount = 0;
  #emitDepth = 0;

  /**
   * Creates a signal.
   *
   * @param options - The deferred-delivery scheduler and the handler-error reporter. Both are
   * supplied by the app for engine signals; a signal a script owns usually needs neither.
   */
  constructor(options?: SignalOptions<T>) {
    this.#deferredQueue = options?.deferredQueue ?? null;
    this.#onHandlerError = options?.onHandlerError ?? null;
  }

  /**
   * How many handlers are currently attached.
   *
   * @returns The live connection count.
   */
  get connectionCount(): number {
    return this.#liveCount;
  }

  /**
   * Attaches a handler.
   *
   * @param handler - The listener.
   * @param options - `once` to detach after the first delivery, `deferred` to queue delivery on the
   * signal's {@link DeferredQueue}, and `owner` to detach when the owner is destroyed.
   * @returns A function that detaches the handler; calling it twice is a no-op.
   * @throws IgnifxError with code `IGX-0103` when `deferred` is requested and the signal was
   * constructed without a {@link DeferredQueue}.
   *
   * @example
   * ```ts
   * const stop = app.events.onSceneLoaded.connect((scene) => this.spawn(scene), { owner: this });
   * stop();
   * ```
   */
  connect(handler: SignalHandler<T>, options?: ConnectOptions): Disconnect {
    const deferred = options?.deferred ?? false;
    if (deferred && this.#deferredQueue === null) {
      throw new IgnifxError(
        CoreErrorCode.deferredSignalWithoutScheduler,
        "Deferred signal delivery needs a scheduler; construct the signal with a deferred queue.",
        { hint: "Engine signals reached through the app already have one; a signal you own does not." },
      );
    }
    const owner = options?.owner;
    if (owner !== undefined && owner.isDestroyed) {
      // Connecting on behalf of a destroyed owner is a no-op rather than an error: teardown order
      // between two destroyed objects is not something game code should have to reason about.
      return noopDisconnect;
    }
    const connection = new Connection<T>(handler, options?.once ?? false, deferred, this.#connections.length);
    this.#connections.push(connection);
    this.#liveCount += 1;
    if (owner !== undefined) {
      connection.ownerDisconnect = owner.onDestroyed.connect(() => {
        this.#remove(connection);
      });
    }
    return () => {
      this.#remove(connection);
    };
  }

  /**
   * Delivers a value to every attached handler, in connection order.
   *
   * @param value - The payload. Omitted for `Signal<void>`.
   * @throws IgnifxError with code `IGX-0104` wrapping the first handler exception, when the signal
   * was constructed without an `onHandlerError` reporter.
   */
  emit(value: T): void {
    const connections = this.#connections;
    // Snapshotting the length — not the array — is what makes a handler connected during this emit
    // run on the *next* emit, with no per-emit allocation.
    const count = connections.length;
    if (count === 0) {
      return;
    }
    this.#emitDepth += 1;
    let firstError: unknown = null;
    let errorCount = 0;
    for (let index = 0; index < count; index += 1) {
      const connection = connections[index];
      if (connection === undefined) {
        continue;
      }
      const handler = connection.handler;
      if (handler === null) {
        continue;
      }
      const isOnce = connection.once;
      if (isOnce) {
        this.#remove(connection);
      }
      try {
        if (connection.deferred && this.#deferredQueue !== null) {
          this.#deferredQueue.enqueue(() => {
            // A `once` connection is already detached; any other must still be attached at flush
            // time, so disconnecting before the queue drains cancels the delivery.
            if (isOnce || connection.handler !== null) {
              handler(value);
            }
          });
        } else {
          handler(value);
        }
      } catch (error) {
        errorCount += 1;
        if (this.#onHandlerError === null) {
          if (errorCount === 1) {
            firstError = error;
          }
        } else {
          this.#onHandlerError(error, this);
        }
      }
    }
    this.#emitDepth -= 1;
    if (this.#emitDepth === 0 && this.#deadCount > 0) {
      this.#compact();
    }
    if (errorCount > 0 && this.#onHandlerError === null) {
      throw new IgnifxError(CoreErrorCode.signalHandlerThrew, "A signal handler threw.", {
        cause: firstError,
        context: { errorCount, handlerCount: count },
        hint: "Handle the failure in the handler, or give the signal an onHandlerError reporter.",
      });
    }
  }

  /**
   * Detaches the first connection made with this handler. Detaching a handler that is not connected
   * is a no-op.
   *
   * @param handler - The listener to detach.
   */
  disconnect(handler: SignalHandler<T>): void {
    for (const connection of this.#connections) {
      if (connection.handler === handler) {
        this.#remove(connection);
        return;
      }
    }
  }

  /** Detaches every handler, including the auto-disconnect hooks held on owners. */
  clear(): void {
    // Iterating a copy keeps `#remove`'s swap-remove from shifting entries out from under the loop.
    // `clear` is a teardown operation, never a per-frame one, so the copy costs nothing that matters.
    for (const connection of this.#connections.slice()) {
      this.#remove(connection);
    }
  }

  /**
   * Marks a connection dead and, when no emit is in flight, removes it by swapping the last entry
   * into its slot. During an emit the entry is left as a tombstone so indices stay stable, and the
   * outermost emit compacts.
   *
   * @param connection - The connection to detach.
   */
  #remove(connection: Connection<T>): void {
    if (connection.handler === null) {
      return;
    }
    connection.handler = null;
    this.#liveCount -= 1;
    const ownerDisconnect = connection.ownerDisconnect;
    if (ownerDisconnect !== null) {
      connection.ownerDisconnect = null;
      ownerDisconnect();
    }
    if (this.#emitDepth > 0) {
      this.#deadCount += 1;
      return;
    }
    this.#swapRemove(connection.index);
  }

  /** Removes every tombstone left behind by an emit. */
  #compact(): void {
    const connections = this.#connections;
    for (let index = connections.length - 1; index >= 0; index -= 1) {
      const connection = connections[index];
      if (connection !== undefined && connection.handler === null) {
        this.#swapRemove(index);
      }
    }
    this.#deadCount = 0;
  }

  /**
   * Removes the entry at an index by moving the last entry into its place.
   *
   * @param index - The slot to vacate.
   */
  #swapRemove(index: number): void {
    const connections = this.#connections;
    const last = connections.length - 1;
    if (index !== last) {
      const moved = connections[last];
      if (moved !== undefined) {
        connections[index] = moved;
        moved.index = index;
      }
    }
    connections.pop();
  }
}
