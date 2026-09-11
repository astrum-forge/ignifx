import { clamp01 } from "../math/math-utils.js";
import type { AssetHandleImpl } from "./asset-handle.js";
import type { AssetHandle, AssetRef, LoadOptions, LoaderContext } from "./types.js";
import type { App } from "../app/types.js";
import type { LiteEngine } from "../lite/scene.js";
import type { JsonObject } from "../schema/json.js";

/**
 * The object a loader is handed (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * It owns no policy: every method delegates to the service, which is what keeps the priority queue,
 * the byte counters, the retry logic, and the dependency reference counting in one place. The
 * context exists so a loader never needs a reference to the service itself.
 */

/**
 * What a {@link LoaderContextImpl} needs from the service that created it.
 *
 * @internal
 */
export interface LoaderContextHost {
  /** The app the load belongs to. */
  readonly app: App;
  /** The Lite engine the GPU loaders upload through; the null engine in headless mode. */
  readonly engine: LiteEngine;
  /**
   * The `.meta.json` sidecar the manifest recorded for an address.
   *
   * @param path - The fragment-free address.
   * @returns The sidecar, or `null` when the manifest lists none.
   */
  manifestMeta(path: string): JsonObject | null;
  /**
   * Reads an address as bytes through the priority queue.
   *
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The body.
   */
  fetchBytes(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<ArrayBuffer>;
  /**
   * Reads an address as UTF-8 text through the priority queue.
   *
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The decoded body.
   */
  fetchText(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<string>;
  /**
   * Reads an address as JSON through the priority queue.
   *
   * @typeParam J - The parsed shape.
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The parsed body.
   */
  fetchJson<J>(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<J>;
  /**
   * Requests a dependency of a load: it is retained on the parent's behalf and its progress counts
   * into the parent's.
   *
   * @param ref - The dependency's address or reference.
   * @param options - Priority, type, progress, and cancellation.
   * @param parent - The handle that depends on it.
   * @returns The dependency's handle.
   */
  requestDependency(ref: AssetRef | string, options: LoadOptions | undefined, parent: AssetHandleImpl): AssetHandleImpl;
}

/**
 * One load's context.
 *
 * @internal
 */
export class LoaderContextImpl implements LoaderContext {
  /** The address being loaded, fragment included. */
  readonly address: string;

  /** The URL the address resolved to. */
  readonly url: string;

  /** The text after `#`, or `null`. */
  readonly fragment: string | null;

  /** The asset type the loader is registered under. */
  readonly type: string;

  /** Aborted when the request is cancelled or the app is disposed. */
  readonly signal: AbortSignal;

  /** The `.meta.json` sidecar the build recorded for this address, or `null`. */
  readonly meta: JsonObject | null;

  readonly #host: LoaderContextHost;

  readonly #handle: AssetHandleImpl;

  readonly #priority: number;

  /**
   * Creates a context for one load.
   *
   * @param host - The service behind every method.
   * @param handle - The handle being loaded.
   * @param signal - The abort signal for this attempt.
   * @param priority - The request priority the fetches inherit.
   */
  constructor(host: LoaderContextHost, handle: AssetHandleImpl, signal: AbortSignal, priority: number) {
    this.#host = host;
    this.#handle = handle;
    this.#priority = priority;
    this.address = handle.address;
    this.url = handle.url;
    this.fragment = handle.fragment;
    this.type = handle.type;
    this.signal = signal;
    this.meta = host.manifestMeta(handle.path);
  }

  /**
   * The app the load belongs to.
   *
   * @returns The app.
   */
  get app(): App {
    return this.#host.app;
  }

  /**
   * The unstable Babylon Lite escape hatch GPU loaders upload through.
   *
   * @returns The engine handle.
   */
  get lite(): { readonly engine: LiteEngine } {
    return { engine: this.#host.engine };
  }

  /**
   * Fetches the address as bytes.
   *
   * @returns The body.
   */
  fetchBytes(): Promise<ArrayBuffer> {
    return this.#host.fetchBytes(this.#handle, this.#priority, this.signal);
  }

  /**
   * Fetches the address as UTF-8 text.
   *
   * @returns The decoded body.
   */
  fetchText(): Promise<string> {
    return this.#host.fetchText(this.#handle, this.#priority, this.signal);
  }

  /**
   * Fetches the address and parses it as JSON.
   *
   * @typeParam J - The parsed shape, as the loader declares it.
   * @returns The parsed body.
   */
  fetchJson<J = unknown>(): Promise<J> {
    return this.#host.fetchJson<J>(this.#handle, this.#priority, this.signal);
  }

  /**
   * Loads another asset as a dependency of this one.
   *
   * @typeParam D - The dependency's loaded value type.
   * @param ref - The dependency's address or reference.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The dependency's handle, once it has been delivered.
   */
  async loadDependency<D>(ref: AssetRef<D> | string, options?: LoadOptions): Promise<AssetHandle<D>> {
    const dependency = this.#host.requestDependency(ref, options, this.#handle);
    await dependency.promise;
    // The cache is untyped because loaders return
    // `unknown`; `D` is the caller's declaration of what this address holds.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return dependency as unknown as AssetHandle<D>;
  }

  /**
   * Reports progress for loaders that cannot express it in bytes. Ignored once bytes are known,
   * because a byte count is the better signal.
   *
   * @param fraction - How far along the load is, in `[0, 1]`.
   */
  reportProgress(fraction: number): void {
    this.#handle.reportedFraction = clamp01(fraction);
  }
}
