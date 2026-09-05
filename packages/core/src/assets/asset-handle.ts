import { CoreErrorCode } from "../errors/error-codes.js";
import { clamp01 } from "../math/math-utils.js";
import { Signal } from "../signal/signal.js";
import { AssetLoadError } from "./types.js";
import type { AssetHandle, AssetLoader, AssetState } from "./types.js";

/**
 * The reference-counted handle and the load bookkeeping that hangs off it
 * (`docs/architecture/05-assets-and-loading.md` §3).
 *
 * The class is deliberately **not** generic. `T` on the public `AssetHandle<T>` is the caller's
 * declaration of what a loader produces — the loader itself returns `unknown` — and `Signal<T>`
 * carries private state, which makes it invariant in `T`. Keeping the implementation on `unknown`
 * puts the single unavoidable assertion at the service's public boundary instead of scattering
 * variance workarounds through the cache.
 *
 * Everything a load needs while it is in flight lives here too: the abort controller, the retry
 * countdown, the collector countdown, the byte counters, and the dependency list. One object per
 * address means the cache is a plain `Map` and no per-frame lookup allocates (coding standards §7).
 */

/**
 * What a handle needs from the service that owns it.
 *
 * @internal
 */
export interface AssetHandleHost {
  /**
   * Reports that a handle lost its last holder and may be collected.
   *
   * @param handle - The handle now at zero references.
   */
  onZeroReferences(handle: AssetHandleImpl): void;
  /**
   * Reports that a handle gained a holder, so a pending collection is called off.
   *
   * @param handle - The handle that was retained.
   */
  onRetained(handle: AssetHandleImpl): void;
}

/**
 * The countdown value meaning "no timer is running".
 *
 * @internal
 */
export const NO_TIMER = -1;

/**
 * One cached asset: its public handle surface and its private load state.
 *
 * @internal
 */
export class AssetHandleImpl implements AssetHandle {
  /** The address as it was requested, fragment included. */
  readonly address: string;

  /** The fragment-free part of the address. */
  readonly path: string;

  /** The text after `#`, or `null`. */
  readonly fragment: string | null;

  /** The asset type the loader is registered under. */
  readonly type: string;

  /** The cache key, `address` and `type` joined. */
  readonly key: string;

  /** The URL {@link AssetHandleImpl.path} resolved to. */
  readonly url: string;

  /** The loader that produces and releases the value. */
  readonly loader: AssetLoader;

  /** Emitted at delivery when hot reload replaced the value. */
  readonly onReplaced: Signal<unknown>;

  /** Resolves with the value at delivery, or rejects with an {@link AssetLoadError}. */
  readonly promise: Promise<unknown>;

  /** Aborts the fetches of the load in flight, or `null` when nothing is running. */
  controller: AbortController | null = null;

  /** How many attempts have already failed; the exponent of the retry backoff. */
  attempt = 0;

  /** Seconds of unscaled time until the next retry, or {@link NO_TIMER}. */
  retryRemaining: number = NO_TIMER;

  /** Seconds of engine time until the asset is unloaded, or {@link NO_TIMER}. */
  gcRemaining: number = NO_TIMER;

  /** How many requests still want this load; the last one to abort cancels the fetch. */
  interested = 0;

  /** `true` while the loader is running. */
  isRunning = false;

  /** Bytes received so far. */
  bytesLoaded = 0;

  /** Bytes expected, from the manifest entry or the response's `Content-Length`; `0` when unknown. */
  bytesTotal = 0;

  /** What the loader last reported, used when the byte total is unknown. */
  reportedFraction = 0;

  /** Dependencies this asset retains; released when it is unloaded. */
  readonly dependencies: AssetHandleImpl[] = [];

  /** The highest priority any request for this address asked for; the fetches inherit it. */
  priority = 0;

  /** `true` while the handle sits in the service's progress watch list. */
  isWatched = false;

  /** `true` while the handle counts towards the aggregate progress of the current run. */
  isInSession = false;

  /** Per-request progress callbacks, invoked at delivery when the value changed. */
  readonly progressListeners: ((fraction: number) => void)[] = [];

  /** Abort-listener detach functions, one per request that supplied a signal. */
  readonly tickets: (() => void)[] = [];

  /** The progress last handed to {@link AssetHandleImpl.progressListeners}. */
  lastDeliveredProgress = -1;

  readonly #host: AssetHandleHost;

  readonly #resolve: (value: unknown) => void;

  readonly #reject: (reason: unknown) => void;

  #state: AssetState = "loading";

  #value: unknown = null;

  #error: AssetLoadError | null = null;

  #refCount = 0;

  /**
   * Creates a handle for one cached address.
   *
   * @param init - The address, its resolved URL, the loader, and the owning service.
   */
  constructor(init: AssetHandleInit) {
    this.address = init.address;
    this.path = init.path;
    this.fragment = init.fragment;
    this.type = init.type;
    this.key = init.key;
    this.url = init.url;
    this.loader = init.loader;
    this.#host = init.host;
    this.onReplaced = new Signal<unknown>();
    // The executor runs synchronously, so both functions are captured before the constructor ends.
    let resolveFn: (value: unknown) => void = passThrough;
    let rejectFn: (reason: unknown) => void = passThrough;
    this.promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    this.#resolve = resolveFn;
    this.#reject = rejectFn;
    // A handle reports failure through `state` and `error` as well, so a caller that never touched
    // `promise` must not turn a handled failure into an unhandled rejection (coding standards §8).
    void this.promise.catch(passThrough);
  }

  /**
   * Where the handle is in its life.
   *
   * @returns The current state.
   */
  get state(): AssetState {
    return this.#state;
  }

  /**
   * The loaded value.
   *
   * @returns The value the loader produced.
   * @throws IgnifxError with code `IGX-0501` unless the state is `"loaded"`.
   */
  get value(): unknown {
    if (this.#state !== "loaded") {
      throw new AssetLoadError(
        CoreErrorCode.assetNotLoaded,
        `The asset ${this.address} has no value yet because it is ${this.#state}.`,
        {
          address: this.address,
          url: this.url,
          context: { asset: this.address, state: this.#state },
          hint: "Await handle.promise, or check handle.state before reading handle.value.",
        },
      );
    }
    return this.#value;
  }

  /**
   * Why the load failed.
   *
   * @returns The failure, or `null` when there was none.
   */
  get error(): AssetLoadError | null {
    return this.#error;
  }

  /**
   * How many holders the handle has.
   *
   * @returns The reference count.
   */
  get refCount(): number {
    return this.#refCount;
  }

  /**
   * How far along the load is, counting dependencies as equal shares of the whole.
   *
   * @returns A fraction in `[0, 1]`.
   */
  get progress(): number {
    if (this.#state === "loaded") {
      return 1;
    }
    const own = this.bytesTotal > 0 ? clamp01(this.bytesLoaded / this.bytesTotal) : clamp01(this.reportedFraction);
    const dependencies = this.dependencies;
    if (dependencies.length === 0) {
      return own;
    }
    let sum = own;
    for (let index = 0; index < dependencies.length; index += 1) {
      sum += dependencies[index]?.progress ?? 0;
    }
    return clamp01(sum / (dependencies.length + 1));
  }

  /**
   * Adds a holder.
   *
   * @returns This handle.
   */
  retain(): this {
    this.#refCount += 1;
    this.#host.onRetained(this);
    return this;
  }

  /**
   * Removes a holder. Releasing a handle that has none is a no-op: teardown order between two
   * objects that both held the asset is not something game code should have to reason about.
   */
  release(): void {
    if (this.#refCount === 0) {
      return;
    }
    this.#refCount -= 1;
    if (this.#refCount === 0) {
      this.#host.onZeroReferences(this);
    }
  }

  /**
   * Releases one holder at the end of a `using` block. Identical to
   * {@link AssetHandleImpl.release}, including the "releasing a handle with no holders is a no-op"
   * rule, so a handle that was released by hand inside the block does not go negative.
   */
  [Symbol.dispose](): void {
    this.release();
  }

  /**
   * Delivers a successful load: the state flips and the promise resolves, at the one point in the
   * frame §4 allows.
   *
   * @param value - What the loader produced.
   */
  settleLoaded(value: unknown): void {
    this.#state = "loaded";
    this.#value = value;
    this.#error = null;
    this.reportedFraction = 1;
    if (this.bytesTotal > 0) {
      this.bytesLoaded = this.bytesTotal;
    }
    this.interested = 0;
    this.retryRemaining = NO_TIMER;
    this.#resolve(value);
  }

  /**
   * Delivers a failed load.
   *
   * @param error - Why it failed.
   */
  settleFailed(error: AssetLoadError): void {
    this.#state = "failed";
    this.#error = error;
    this.interested = 0;
    this.retryRemaining = NO_TIMER;
    this.#reject(error);
  }

  /**
   * Delivers a hot-reload swap: the value is replaced in place and {@link AssetHandle.onReplaced}
   * fires. The promise keeps whatever it already settled with — it settles once, by contract.
   *
   * @param value - The new value.
   */
  settleReplaced(value: unknown): void {
    this.#state = "loaded";
    this.#value = value;
    this.#error = null;
    this.reportedFraction = 1;
    this.onReplaced.emit(value);
  }

  /** Marks the handle collected. Reading `value` afterwards throws `IGX-0501`. */
  markReleased(): void {
    this.#state = "released";
    this.#value = null;
    this.gcRemaining = NO_TIMER;
    this.detachTickets();
    this.progressListeners.length = 0;
    this.onReplaced.clear();
  }

  /** Aborts the fetches of the load in flight. Delivery still happens in `PreUpdate`. */
  abort(): void {
    this.controller?.abort();
  }

  /** Detaches every abort listener a request installed. */
  detachTickets(): void {
    const tickets = this.tickets;
    for (let index = 0; index < tickets.length; index += 1) {
      tickets[index]?.();
    }
    tickets.length = 0;
  }
}

/**
 * What {@link AssetHandleImpl} is constructed from.
 *
 * @internal
 */
export interface AssetHandleInit {
  /** The address as requested, fragment included. */
  readonly address: string;
  /** The fragment-free part of the address. */
  readonly path: string;
  /** The text after `#`, or `null`. */
  readonly fragment: string | null;
  /** The asset type. */
  readonly type: string;
  /** The cache key. */
  readonly key: string;
  /** The URL the path resolved to. */
  readonly url: string;
  /** The loader that produces the value. */
  readonly loader: AssetLoader;
  /** The service that owns the cache. */
  readonly host: AssetHandleHost;
}

/**
 * The no-op used as the initial value of the captured promise callbacks and as the silent rejection
 * handler.
 *
 * @param value - Ignored.
 */
function passThrough(value: unknown): void {
  // Deliberately empty: the real callbacks replace it synchronously, and the rejection handler only
  // exists to keep an unobserved failure from becoming an unhandled rejection.
  void value;
}
