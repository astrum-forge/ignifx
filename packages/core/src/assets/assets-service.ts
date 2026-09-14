import { CoreErrorCode } from "../errors/error-codes.js";
import { assertNever, IgnifxError } from "../errors/ignifx-error.js";
import { Signal } from "../signal/signal.js";
import {
  isAbsoluteAddress,
  joinRoot,
  matchExtension,
  MEMORY_ADDRESS_PREFIX,
  normalizeExtension,
  splitFragment,
} from "./address.js";
import { AssetHandleImpl, NO_TIMER } from "./asset-handle.js";
import { addressOf, declaredTypeOf } from "./asset-ref.js";
import { fetchAssetBytes, fetchAssetJson, fetchAssetText } from "./fetcher.js";
import { LoaderContextImpl } from "./loader-context.js";
import { assertSupportedManifest, EMPTY_ASSET_MANIFEST, ManifestIndex } from "./manifest.js";
import { RequestQueue } from "./request-queue.js";
import { AssetLoadError } from "./types.js";
import type { AssetHandleHost } from "./asset-handle.js";
import type { LoaderContextHost } from "./loader-context.js";
import type {
  AssetHandle,
  AssetLoader,
  AssetManifest,
  AssetProgress,
  AssetRef,
  AssetTypeDefinition,
  Assets,
  AssetsSettings,
  BatchHandle,
  FetchLike,
  LoadOptions,
  RegisterAssetOptions,
} from "./types.js";
import type { App } from "../app/types.js";
import type { DiagnosticsGroup } from "../diagnostics/diagnostics-group.js";
import type { Diagnostics } from "../diagnostics/diagnostics.js";
import type { LiteEngine } from "../lite/scene.js";
import type { JsonObject } from "../schema/json.js";

/**
 * Cache assets by address and deliver completions, failures, and reload swaps in `PreUpdate`
 * while the loop runs. Outside the loop, completed loads settle immediately. Progress getters read
 * live counters; progress signals follow delivery timing.
 *
 * An aborted request releases its own hold; shared callers still receive the result. Releasing the
 * last hold without aborting lets the load finish before collection. Failed handles stay cached
 * until collected, preventing repeated requests for a permanent failure.
 *
 * Retries use unscaled time; collection uses scaled time. Reloads keep the old value until a
 * replacement loads successfully (docs/architecture/05-assets-and-loading.md).
 */

/**
 * The first retry waits this many seconds; each further attempt doubles it (§9).
 *
 * @internal
 */
export const ASSET_RETRY_BASE_SECONDS = 0.1;

/**
 * The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @public
 */
export const ASSET_DIAGNOSTICS_GROUP = "assets";

/**
 * The counters the `assets` diagnostics group publishes, in index order.
 *
 * @public
 */
export const ASSET_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "loaded",
  "inFlight",
  "queued",
  "bytesLoaded",
  "failed",
  "zeroRefCandidates",
]);

/** Separates the type from the address in a cache key. A type name never contains it. */
const KEY_SEPARATOR = "::";
/** Wall-clock unit for the idle retry timer. */
const MILLISECONDS_PER_SECOND = 1000;

/** What the delivery queue carries from a settled load to the next `PreUpdate`. */
type DeliveryItem =
  | { readonly kind: "loaded"; readonly handle: AssetHandleImpl; readonly value: unknown }
  | { readonly kind: "failed"; readonly handle: AssetHandleImpl; readonly error: AssetLoadError }
  | { readonly kind: "replaced"; readonly handle: AssetHandleImpl; readonly value: unknown };

/**
 * What {@link AssetsImpl} is constructed with.
 *
 * @internal
 */
export interface AssetsOptions {
  /** The app the service belongs to. */
  readonly app: App;
  /** Where the `assets` counter group is registered. */
  readonly diagnostics: Diagnostics;
  /** The `fetch` every read goes through. Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
  /** The address-to-URL table. Defaults to {@link EMPTY_ASSET_MANIFEST}. */
  readonly manifest?: AssetManifest;
}

/**
 * A group of loads requested together.
 *
 * @internal
 */
class BatchHandleImpl implements BatchHandle {
  /** The handles the batch retains. */
  readonly handles: readonly AssetHandle[];

  /** Settles once every member has settled. */
  readonly promise: Promise<void>;

  readonly #members: readonly AssetHandleImpl[];

  readonly #controller: AbortController;

  #isReleased = false;

  /**
   * Creates a batch.
   *
   * @param members - The handles, each already retained once on the batch's behalf.
   * @param controller - The controller {@link BatchHandleImpl.cancel} aborts.
   */
  constructor(members: readonly AssetHandleImpl[], controller: AbortController) {
    this.#members = members;
    this.#controller = controller;
    this.handles = members;
    const promises: Promise<unknown>[] = [];
    for (const member of members) {
      promises.push(member.promise);
    }
    this.promise = Promise.all(promises).then(toVoid);
    // Same reasoning as `AssetHandleImpl`: a batch nobody awaited must not raise an unhandled
    // rejection (coding standards §8).
    void this.promise.catch(ignoreRejection);
  }

  /**
   * The mean progress of the batch's members.
   *
   * @returns A fraction in `[0, 1]`; `1` for an empty batch, which has nothing left to do.
   */
  get progress(): number {
    const members = this.#members;
    if (members.length === 0) {
      return 1;
    }
    let sum = 0;
    for (const member of members) {
      sum += member.progress;
    }
    return sum / members.length;
  }

  /** Releases every handle the batch retains. Calling it twice is a no-op. */
  release(): void {
    if (this.#isReleased) {
      return;
    }
    this.#isReleased = true;
    for (const member of this.#members) {
      member.release();
    }
  }

  /**
   * Aborts every load the batch started. The abort tickets release the batch's holds, so this does
   * not also call {@link BatchHandleImpl.release}.
   */
  cancel(): void {
    if (this.#isReleased) {
      return;
    }
    this.#isReleased = true;
    this.#controller.abort();
  }
}

/**
 * The asset service of one app.
 *
 * @internal
 */
export class AssetsImpl implements Assets, AssetHandleHost, LoaderContextHost {
  /** Emitted at delivery whenever the aggregate progress of the loads in flight changed. */
  readonly onProgress: Signal<AssetProgress>;

  /** How many seconds a zero-reference asset stays cached. */
  gcDelay = 5;

  readonly #app: App;

  readonly #fetch: FetchLike;

  readonly #queue = new RequestQueue();

  readonly #loaders = new Map<string, AssetLoader>();

  readonly #typeByExtension = new Map<string, string>();

  readonly #entries = new Map<string, AssetHandleImpl>();

  readonly #byAddress = new Map<string, AssetHandleImpl>();

  readonly #delivery: DeliveryItem[] = [];

  readonly #retrying: AssetHandleImpl[] = [];

  readonly #collecting: AssetHandleImpl[] = [];

  readonly #watching: AssetHandleImpl[] = [];

  readonly #session: AssetHandleImpl[] = [];

  readonly #counters: DiagnosticsGroup;

  readonly #countersLoaded: number;

  readonly #countersInFlight: number;

  readonly #countersQueued: number;

  readonly #countersBytes: number;

  readonly #countersFailed: number;

  readonly #countersCandidates: number;

  #index: ManifestIndex;

  #root: string;

  #hasExplicitManifest: boolean;

  #engine: LiteEngine | null = null;

  #retries = 2;

  #preload: readonly string[] = [];

  #memorySerial = 0;

  #sessionSettled = 0;

  #loadedCount = 0;

  #failedCount = 0;

  #inFlightCount = 0;

  #bytesLoadedTotal = 0;

  #lastLoaded = -1;

  #lastTotal = -1;

  #lastBytesLoaded = -1;

  #lastBytesTotal = -1;

  #isDisposed = false;

  /**
   * Creates the asset service of one app.
   *
   * @param options - The app, the diagnostics table, the injected `fetch`, and the manifest.
   * @throws IgnifxError with code `IGX-0603` when the manifest declares an unreadable format
   * version.
   */
  constructor(options: AssetsOptions) {
    this.#app = options.app;
    this.#fetch = options.fetch ?? defaultFetch();
    const manifest = options.manifest;
    this.#hasExplicitManifest = manifest !== undefined;
    this.#index = new ManifestIndex(manifest === undefined ? EMPTY_ASSET_MANIFEST : assertSupportedManifest(manifest));
    this.#root = this.#index.manifest.root;
    this.onProgress = new Signal<AssetProgress>();
    const counters = options.diagnostics.registerGroup(ASSET_DIAGNOSTICS_GROUP, ASSET_DIAGNOSTICS_COUNTERS);
    this.#counters = counters;
    this.#countersLoaded = counters.index("loaded");
    this.#countersInFlight = counters.index("inFlight");
    this.#countersQueued = counters.index("queued");
    this.#countersBytes = counters.index("bytesLoaded");
    this.#countersFailed = counters.index("failed");
    this.#countersCandidates = counters.index("zeroRefCandidates");
  }

  /**
   * The address-to-URL table.
   *
   * @returns The manifest the service resolves addresses through.
   */
  get manifest(): AssetManifest {
    return this.#index.manifest;
  }

  /**
   * The app the service belongs to.
   *
   * @returns The app.
   */
  get app(): App {
    return this.#app;
  }

  /**
   * The Lite engine GPU loaders upload through.
   *
   * @returns The engine handle.
   * @throws IgnifxError with code `IGX-0107` before `createApp()` has attached one.
   */
  get engine(): LiteEngine {
    const engine = this.#engine;
    if (engine === null) {
      throw new IgnifxError(CoreErrorCode.appNotReady, "ctx.lite.engine is not available until createApp() resolves.", {
        context: { member: "ctx.lite.engine" },
      });
    }
    return engine;
  }

  /**
   * The `.meta.json` sidecar the manifest recorded for an address.
   *
   * @param path - The fragment-free address.
   * @returns The sidecar, or `null` when the manifest lists none.
   */
  manifestMeta(path: string): JsonObject | null {
    return this.#index.entry(path)?.meta ?? null;
  }

  /**
   * The manifest group labels the `assets` settings section asked to preload.
   *
   * @returns The labels, in configuration order.
   */
  get preloadGroups(): readonly string[] {
    return this.#preload;
  }

  /**
   * Requests an asset and returns its shared handle immediately.
   *
   * @typeParam T - The loaded value type.
   * @param ref - The address, or a reference carrying one.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The handle, with one more holder.
   * @throws IgnifxError with code `IGX-0504` when no loader claims the address.
   */
  load<T>(ref: AssetRef<T> | string, options?: LoadOptions): AssetHandle<T> {
    return toTyped<T>(this.#request(ref, options, null));
  }

  /**
   * Requests an asset and waits for the delivery point its state flips at.
   *
   * @typeParam T - The loaded value type.
   * @param ref - The address, or a reference carrying one.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The handle, once it has loaded.
   */
  async loadAsync<T>(ref: AssetRef<T> | string, options?: LoadOptions): Promise<AssetHandle<T>> {
    const handle = this.#request(ref, options, null);
    await handle.promise;
    return toTyped<T>(handle);
  }

  /**
   * Requests several assets as one batch.
   *
   * @param refs - The addresses or references.
   * @param options - Priority, type, progress, and cancellation, applied to every member.
   * @returns The batch.
   */
  loadAll(refs: readonly (AssetRef | string)[], options?: LoadOptions): BatchHandle {
    return this.#batch(refs, options);
  }

  /**
   * Loads every manifest entry carrying a group label.
   *
   * @param group - The label, such as `"boot"`.
   * @param options - Priority, progress, and cancellation.
   * @returns The batch; empty when the manifest knows no such group.
   */
  preloadGroup(group: string, options?: LoadOptions): BatchHandle {
    return this.#batch(this.#index.group(group), options);
  }

  /**
   * Looks a cached handle up without changing its reference count.
   *
   * @typeParam T - The loaded value type.
   * @param address - The address, fragment included.
   * @returns The handle, or `null` when the address is not cached.
   */
  get<T>(address: string): AssetHandle<T> | null {
    const handle = this.#byAddress.get(address);
    return handle === undefined ? null : toTyped<T>(handle);
  }

  /**
   * Removes one holder from a handle, by object or by address.
   *
   * @param handleOrAddress - The handle, or the address it was requested under.
   */
  release(handleOrAddress: AssetHandle | string): void {
    if (typeof handleOrAddress === "string") {
      this.#byAddress.get(handleOrAddress)?.release();
      return;
    }
    handleOrAddress.release();
  }

  /** Unloads every zero-reference asset that has finished loading, now. */
  gc(): void {
    // Every entry of the candidate list is at zero references with a running countdown: `retain`
    // calls `onRetained`, which takes it back out again. So the only question left here is whether
    // the load has settled — an asset still in flight has nothing to unload yet.
    const candidates = this.#collecting.slice();
    this.#collecting.length = 0;
    for (const handle of candidates) {
      if (handle.state === "loading") {
        this.#collecting.push(handle);
        continue;
      }
      this.#unload(handle);
    }
  }

  /**
   * Resolves an address to the URL the service fetches.
   *
   * @param address - The address; the fragment is stripped.
   * @returns The manifest's URL for the address, or `<root>/<address>`.
   */
  resolveUrl(address: string): string {
    const path = splitFragment(address).path;
    if (isAbsoluteAddress(path)) {
      return path;
    }
    const entry = this.#index.entry(path);
    return entry === null ? joinRoot(this.#root, path) : entry.url;
  }

  /**
   * Registers a loader and the extensions that select it.
   *
   * @param loader - The loader.
   * @throws IgnifxError with code `IGX-0506` when the type is already registered.
   */
  registerLoader(loader: AssetLoader): void {
    if (this.#loaders.has(loader.type)) {
      throw new IgnifxError(
        CoreErrorCode.duplicateAssetLoader,
        `A loader for the asset type ${loader.type} is already registered.`,
        {
          context: { type: loader.type },
          hint: "One loader owns one type; give the new loader its own type name.",
        },
      );
    }
    this.#loaders.set(loader.type, loader);
    this.#mapExtensions(loader.type, loader.extensions);
  }

  /**
   * Declares an asset type that has no loader yet, so addresses resolve to a type before the
   * extension that reads them is registered.
   *
   * @param type - The type name and the extensions that select it.
   */
  registerType(type: AssetTypeDefinition): void {
    this.#mapExtensions(type.type, type.extensions);
  }

  /**
   * Publishes a value built in code as an asset (`docs/architecture/05-assets-and-loading.md` §3).
   *
   * @remarks
   * The entry is a normal cache entry from the moment it exists: it is shared by address, it is
   * reference counted, and the collector unloads it — running the registered type's `unload` — once
   * the last holder lets go. What it never does is fetch, because a `memory:` address names no
   * file. Registering twice at the same explicit address replaces the first entry, which is
   * released immediately rather than after `gcDelay`: the caller has just said the old value is
   * gone.
   *
   * @typeParam T - The value type.
   * @param value - The already-built value.
   * @param options - The asset type, and an explicit address instead of the generated one.
   * @returns The handle, already `loaded`, with one holder.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed.
   */
  register<T>(value: T, options: RegisterAssetOptions): AssetHandle<T> {
    if (this.#isDisposed) {
      throw new IgnifxError(
        CoreErrorCode.appDisposed,
        "The app has been disposed; app.assets is no longer available.",
        { context: { member: "app.assets.register()" } },
      );
    }
    const type = options.type;
    this.#memorySerial += 1;
    const address = options.address ?? `${MEMORY_ADDRESS_PREFIX}${type}/${String(this.#memorySerial)}`;
    const key = `${type}${KEY_SEPARATOR}${address}`;
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      this.#unload(existing);
      removeFrom(this.#collecting, existing);
    }
    const handle = new AssetHandleImpl({
      address,
      path: address,
      fragment: null,
      type,
      key,
      url: address,
      loader: this.#loaders.get(type) ?? memoryLoader(type),
      host: this,
    });
    this.#entries.set(key, handle);
    if (!this.#byAddress.has(address)) {
      this.#byAddress.set(address, handle);
    }
    handle.settleLoaded(value);
    this.#loadedCount += 1;
    handle.retain();
    return toTyped<T>(handle);
  }

  /**
   * Reports that a handle lost its last holder.
   *
   * @param handle - The handle now at zero references.
   */
  onZeroReferences(handle: AssetHandleImpl): void {
    if (handle.gcRemaining !== NO_TIMER || handle.state === "released") {
      return;
    }
    handle.gcRemaining = this.gcDelay;
    this.#collecting.push(handle);
  }

  /**
   * Reports that a handle gained a holder, calling off a pending collection.
   *
   * @param handle - The handle that was retained.
   */
  onRetained(handle: AssetHandleImpl): void {
    if (handle.gcRemaining === NO_TIMER) {
      return;
    }
    handle.gcRemaining = NO_TIMER;
    removeFrom(this.#collecting, handle);
  }

  /**
   * Reads an address as bytes through the priority queue.
   *
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The body.
   */
  fetchBytes(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<ArrayBuffer> {
    return this.#queue.run(priority, () => fetchAssetBytes(this.#fetch, handle.url, signal, handle));
  }

  /**
   * Reads an address as UTF-8 text through the priority queue.
   *
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The decoded body.
   */
  fetchText(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<string> {
    return this.#queue.run(priority, () => fetchAssetText(this.#fetch, handle.url, signal, handle));
  }

  /**
   * Reads an address as JSON through the priority queue.
   *
   * @typeParam J - The parsed shape.
   * @param handle - The handle whose byte counters the read feeds.
   * @param priority - The request priority.
   * @param signal - The abort signal.
   * @returns The parsed body.
   */
  fetchJson<J>(handle: AssetHandleImpl, priority: number, signal: AbortSignal): Promise<J> {
    return this.#queue.run(priority, () => fetchAssetJson<J>(this.#fetch, handle.url, signal, handle));
  }

  /**
   * Requests a dependency of a load.
   *
   * @param ref - The dependency's address or reference.
   * @param options - Priority, type, progress, and cancellation.
   * @param parent - The handle that depends on it.
   * @returns The dependency's handle.
   */
  requestDependency(
    ref: AssetRef | string,
    options: LoadOptions | undefined,
    parent: AssetHandleImpl,
  ): AssetHandleImpl {
    return this.#request(ref, options, parent);
  }

  /**
   * Binds the Lite engine `LoaderContext.lite` exposes. `createApp` calls it once the engine exists.
   *
   * @param engine - The app's engine, or the null engine in headless mode.
   */
  attachEngine(engine: LiteEngine): void {
    this.#engine = engine;
  }

  /**
   * Applies the resolved `assets` settings section. `createApp` calls it once the extensions have
   * registered and the settings are frozen.
   *
   * @param settings - The resolved section.
   */
  applySettings(settings: AssetsSettings): void {
    if (!this.#hasExplicitManifest) {
      this.#root = settings.root;
    }
    this.#queue.concurrency = Math.max(1, Math.floor(settings.concurrency));
    this.gcDelay = Math.max(0, settings.gcDelay);
    this.#retries = Math.max(0, Math.floor(settings.retries));
    this.#preload = settings.preload;
  }

  /**
   * Replaces the manifest after construction — what `@ignifx/vite-plugin` does once it has resolved
   * the virtual development manifest.
   *
   * @param manifest - The new table.
   * @throws IgnifxError with code `IGX-0603` when the manifest declares an unreadable format
   * version.
   */
  setManifest(manifest: AssetManifest): void {
    this.#index = new ManifestIndex(assertSupportedManifest(manifest));
    this.#root = manifest.root;
    this.#hasExplicitManifest = true;
  }

  /**
   * Runs the loader again for every cached handle of an address and swaps the value in at delivery
   * — the hot-reload entry point the Vite plugin's HMR channel calls (§7).
   *
   * @remarks
   * A `#fragment` handle carved out of a base address by `parseFragment` is *not* reloaded on its
   * own: it is re-derived from the base's new value when that base is delivered, which is the only
   * order that cannot show a fragment of the old file next to a fragment of the new one.
   *
   * @param address - The address that changed on disk, with or without a fragment.
   */
  reload(address: string): void {
    const path = splitFragment(address).path;
    for (const handle of this.#entries.values()) {
      if (handle.address !== address && handle.path !== path) {
        continue;
      }
      if (handle.state !== "loaded" || handle.isRunning) {
        continue;
      }
      if (handle.fragment !== null && handle.loader.parseFragment !== undefined) {
        continue;
      }
      void this.#runReload(handle);
    }
  }

  /**
   * Drains the delivery queue, advances the retry and collector timers, and publishes progress and
   * counters. `AssetDeliverySystem` calls it once per frame in `PreUpdate`; while the app is not
   * running, `#enqueueDelivery` delivers as loads finish instead.
   *
   * @param deltaSeconds - Scaled seconds since the previous frame; the collector's clock.
   * @param unscaledDeltaSeconds - Unscaled seconds since the previous frame; the retry clock.
   */
  deliver(deltaSeconds: number, unscaledDeltaSeconds: number): void {
    if (this.#isDisposed) {
      return;
    }
    this.#drainDelivery();
    this.#tickRetries(unscaledDeltaSeconds);
    this.#tickCollector(deltaSeconds);
    this.#publishProgress();
    this.#publishCounters();
  }

  /**
   * Cancels every load in flight, rejects the promises that were still pending with `IGX-0503`, and
   * unloads every value. `createApp` registers it as the core extension's disposer.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    const handles: AssetHandleImpl[] = [];
    for (const handle of this.#entries.values()) {
      handles.push(handle);
      handle.abort();
    }
    this.#entries.clear();
    this.#byAddress.clear();
    this.#queue.clear(
      new IgnifxError(CoreErrorCode.assetAppDisposed, "The app was disposed before the asset request ran.", {
        context: { asset: "pending" },
      }),
    );
    for (const handle of handles) {
      if (handle.state === "loading") {
        handle.settleFailed(
          new AssetLoadError(
            CoreErrorCode.assetAppDisposed,
            `The app that owned the asset ${handle.address} was disposed before loading finished.`,
            { address: handle.address, url: handle.url, context: { asset: handle.address } },
          ),
        );
      }
      this.#releaseValue(handle);
    }
    this.#delivery.length = 0;
    this.#retrying.length = 0;
    this.#collecting.length = 0;
    this.#watching.length = 0;
    this.#session.length = 0;
    this.onProgress.clear();
  }

  /**
   * Maps a type's extensions onto it.
   *
   * @param type - The type name.
   * @param extensions - The extensions, with or without their leading dot.
   */
  #mapExtensions(type: string, extensions: readonly string[]): void {
    for (const extension of extensions) {
      this.#typeByExtension.set(normalizeExtension(extension), type);
    }
  }

  /**
   * The one entry point every load goes through.
   *
   * @param ref - The address or reference.
   * @param options - Priority, type, progress, and cancellation.
   * @param parent - The handle this load is a dependency of, or `null`.
   * @returns The shared handle, with one more holder.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed, or `IGX-0504` when no
   * loader claims the address.
   */
  #request(ref: AssetRef | string, options: LoadOptions | undefined, parent: AssetHandleImpl | null): AssetHandleImpl {
    if (this.#isDisposed) {
      throw new IgnifxError(
        CoreErrorCode.appDisposed,
        "The app has been disposed; app.assets is no longer available.",
        {
          context: { member: "app.assets" },
        },
      );
    }
    const address = addressOf(ref);
    const split = splitFragment(address);
    const declared = options?.type ?? declaredTypeOf(ref);
    const type = this.#resolveType(split.path, declared);
    const loader = type === null ? undefined : this.#loaders.get(type);
    if (type === null || loader === undefined) {
      throw new AssetLoadError(CoreErrorCode.assetNoLoader, `No loader is registered for ${address}.`, {
        address,
        url: this.resolveUrl(address),
        context: { asset: address, type: type ?? "unknown" },
        hint: "Register the extension that owns the type, or pass { type } to load().",
      });
    }
    const key = `${type}${KEY_SEPARATOR}${address}`;
    const priority = options?.priority ?? 0;
    let handle = this.#entries.get(key);
    if (handle === undefined) {
      handle = this.#createHandle(address, split.path, split.fragment, type, key, loader, priority);
    }
    handle.priority = Math.max(handle.priority, priority);
    handle.retain();
    if (handle.state === "loading") {
      handle.interested += 1;
    }
    const onProgress = options?.onProgress;
    if (onProgress !== undefined) {
      handle.progressListeners.push(onProgress);
      this.#watch(handle);
    }
    if (parent !== null) {
      this.#linkDependency(parent, handle);
    }
    const signal = options?.signal;
    if (signal !== undefined) {
      this.#attachTicket(handle, signal);
    }
    return handle;
  }

  /**
   * Creates a cache entry and starts its load.
   *
   * @param address - The address as requested.
   * @param path - The fragment-free address.
   * @param fragment - The text after `#`, or `null`.
   * @param type - The resolved asset type.
   * @param key - The cache key.
   * @param loader - The loader that owns the type.
   * @param priority - The priority of the request that created it; the fetches inherit it.
   * @returns The new handle, already loading.
   */
  #createHandle(
    address: string,
    path: string,
    fragment: string | null,
    type: string,
    key: string,
    loader: AssetLoader,
    priority: number,
  ): AssetHandleImpl {
    const handle = new AssetHandleImpl({
      address,
      path,
      fragment,
      type,
      key,
      url: this.resolveUrl(path),
      loader,
      host: this,
    });
    const entry = this.#index.entry(path);
    const bytes = entry?.bytes;
    if (bytes !== undefined && bytes > 0) {
      handle.bytesTotal = bytes;
    }
    this.#entries.set(key, handle);
    if (!this.#byAddress.has(address)) {
      this.#byAddress.set(address, handle);
    }
    this.#beginSession(handle);
    this.#watch(handle);
    handle.attempt = 0;
    // Set before the load starts: the fetch reads it when it enters the priority queue.
    handle.priority = priority;
    void this.#runLoad(handle);
    return handle;
  }

  /**
   * Works out which asset type an address is.
   *
   * @param path - The fragment-free address.
   * @param declared - The type the caller or the reference declared, or `null`.
   * @returns The type name, or `null` when nothing identifies it.
   */
  #resolveType(path: string, declared: string | null): string | null {
    if (declared !== null) {
      return declared;
    }
    const entry = this.#index.entry(path);
    const fromManifest = entry?.type;
    if (fromManifest !== undefined) {
      return fromManifest;
    }
    const extension = matchExtension(path, this.#typeByExtension.keys());
    return extension === null ? null : (this.#typeByExtension.get(extension) ?? null);
  }

  /**
   * Records a dependency once, undoing the extra retain when a retry asks for the same one again.
   *
   * @param parent - The dependent asset.
   * @param dependency - The asset it depends on.
   */
  #linkDependency(parent: AssetHandleImpl, dependency: AssetHandleImpl): void {
    const dependencies = parent.dependencies;
    if (dependencies.includes(dependency)) {
      dependency.release();
      return;
    }
    dependencies.push(dependency);
  }

  /**
   * Attaches one request's abort listener.
   *
   * @param handle - The handle the request holds.
   * @param signal - The caller's signal.
   */
  #attachTicket(handle: AssetHandleImpl, signal: AbortSignal): void {
    if (signal.aborted) {
      this.#abortRequest(handle);
      return;
    }
    const onAbort = (): void => {
      this.#abortRequest(handle);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    handle.tickets.push((): void => {
      signal.removeEventListener("abort", onAbort);
    });
  }

  /**
   * Drops one request's hold and, when nothing is interested any more, aborts the fetch.
   *
   * @param handle - The handle the request held.
   */
  #abortRequest(handle: AssetHandleImpl): void {
    if (handle.state !== "loading") {
      handle.release();
      return;
    }
    handle.interested -= 1;
    handle.release();
    if (handle.interested > 0) {
      return;
    }
    if (handle.retryRemaining !== NO_TIMER) {
      // Aborted while waiting out a retry backoff: no attempt is in flight to observe the abort, so
      // the retry is cancelled here and the handle fails as aborted (`IGX-0502`).
      handle.retryRemaining = NO_TIMER;
      const index = this.#retrying.indexOf(handle);
      if (index !== -1) {
        this.#retrying.splice(index, 1);
      }
      this.#enqueueDelivery({ kind: "failed", handle, error: this.#abortError(handle) });
      return;
    }
    handle.abort();
  }

  /**
   * Runs one load attempt.
   *
   * @param handle - The handle to load.
   */
  async #runLoad(handle: AssetHandleImpl): Promise<void> {
    const controller = new AbortController();
    handle.controller = controller;
    handle.isRunning = true;
    this.#inFlightCount += 1;
    try {
      const value = await this.#invokeLoader(handle, controller.signal, false, null);
      if (this.#isDisposed) {
        return;
      }
      if (controller.signal.aborted) {
        this.#enqueueDelivery({ kind: "failed", handle, error: this.#abortError(handle) });
        return;
      }
      this.#enqueueDelivery({ kind: "loaded", handle, value });
    } catch (error) {
      if (!this.#isDisposed) {
        this.#onAttemptFailed(handle, controller, error);
      }
    } finally {
      handle.isRunning = false;
      this.#inFlightCount -= 1;
    }
  }

  /**
   * Runs one hot-reload attempt.
   *
   * @param handle - The loaded handle to refresh.
   */
  async #runReload(handle: AssetHandleImpl): Promise<void> {
    const controller = new AbortController();
    const previous = handle.value;
    handle.isRunning = true;
    try {
      const value = await this.#invokeLoader(handle, controller.signal, true, previous);
      if (this.#isDisposed) {
        return;
      }
      if (handle.loader.reload === undefined) {
        // The default reload is "unload + load" (§5) done in the safe order: the old value is only
        // released once the new one exists, so a failed reload leaves the asset working.
        this.#runUnload(handle, previous);
      }
      this.#enqueueDelivery({ kind: "replaced", handle, value });
    } catch (error) {
      this.#report(error);
    } finally {
      handle.isRunning = false;
    }
  }

  /**
   * Calls the loader, resolving a `#fragment` address through the base address first.
   *
   * @param handle - The handle being loaded.
   * @param signal - The abort signal of this attempt.
   * @param isReload - Whether this is a hot-reload attempt.
   * @param previous - The value being replaced, for a reload.
   * @returns What the loader produced.
   */
  async #invokeLoader(
    handle: AssetHandleImpl,
    signal: AbortSignal,
    isReload: boolean,
    previous: unknown,
  ): Promise<unknown> {
    const loader = handle.loader;
    const fragment = handle.fragment;
    if (fragment !== null && loader.parseFragment !== undefined) {
      // The base address is loaded as an ordinary dependency: one fetch is shared by every fragment
      // of the same file, and the base is released when the last fragment handle is unloaded.
      const base = this.#request(handle.path, { type: handle.type, priority: handle.priority }, handle);
      await base.promise;
      return loader.parseFragment(fragment, base.value);
    }
    const context = new LoaderContextImpl(this, handle, signal, handle.priority);
    if (isReload && loader.reload !== undefined) {
      return loader.reload(context, previous);
    }
    return loader.load(context);
  }

  /**
   * Decides between a retry and a permanent failure.
   *
   * @param handle - The handle that failed.
   * @param controller - The attempt's controller, which says whether it was aborted.
   * @param error - What the loader threw.
   */
  #onAttemptFailed(handle: AssetHandleImpl, controller: AbortController, error: unknown): void {
    if (controller.signal.aborted) {
      this.#enqueueDelivery({ kind: "failed", handle, error: this.#abortError(handle) });
      return;
    }
    if (handle.attempt < this.#retries) {
      handle.attempt += 1;
      handle.retryRemaining = ASSET_RETRY_BASE_SECONDS * 2 ** (handle.attempt - 1);
      this.#retrying.push(handle);
      if (!this.#app.isRunning) {
        this.#armIdleRetry(handle);
      }
      return;
    }
    this.#enqueueDelivery({
      kind: "failed",
      handle,
      error: new AssetLoadError(
        CoreErrorCode.assetLoadFailed,
        `Loading ${handle.address} from ${handle.url} failed after ${String(handle.attempt + 1)} attempts.`,
        {
          address: handle.address,
          url: handle.url,
          cause: error,
          context: { asset: handle.address, url: handle.url, attempts: handle.attempt + 1 },
          hint: "Check the address against the manifest and the network response.",
        },
      ),
    });
  }

  /**
   * Builds the failure an aborted request settles with.
   *
   * @param handle - The handle that was aborted.
   * @returns The `IGX-0502` failure.
   */
  #abortError(handle: AssetHandleImpl): AssetLoadError {
    return new AssetLoadError(CoreErrorCode.assetLoadAborted, `Loading ${handle.address} was aborted.`, {
      address: handle.address,
      url: handle.url,
      context: { asset: handle.address },
    });
  }

  /**
   * Queues a completed load, a failure, or a reload for delivery. While the loop is running the
   * queue drains once per frame in `PreUpdate`. Before `app.start()` and after `app.stop()` there is
   * no frame to wait for, so the item is delivered at once — a game can `await` its preloads and
   * then start, and a headless test can `await` a handle without stepping
   * (`05-assets-and-loading.md` §4).
   *
   * @param item - What to deliver.
   */
  #enqueueDelivery(item: DeliveryItem): void {
    this.#delivery.push(item);
    if (!this.#app.isRunning) {
      this.#drainDelivery();
      this.#publishProgress();
      this.#publishCounters();
    }
  }

  /**
   * Runs a retry's backoff on the wall clock, because before `app.start()` no frame advances the
   * retry timer. The frame ticker (`#tickRetries`) and this timer guard each other through
   * `retryRemaining`: whichever fires first sets it to `NO_TIMER`, and the other stands down; an
   * abort during the backoff resets it too (`#abortRequest`), so the timer then does nothing.
   *
   * @param handle - The handle whose backoff is counting down.
   */
  #armIdleRetry(handle: AssetHandleImpl): void {
    setTimeout(() => {
      if (this.#isDisposed || handle.retryRemaining === NO_TIMER) {
        return;
      }
      handle.retryRemaining = NO_TIMER;
      const index = this.#retrying.indexOf(handle);
      if (index !== -1) {
        this.#retrying.splice(index, 1);
      }
      void this.#runLoad(handle);
    }, handle.retryRemaining * MILLISECONDS_PER_SECOND);
  }

  /** Applies every settled load of the last frame, at the one point §4 allows. */
  #drainDelivery(): void {
    const queue = this.#delivery;
    if (queue.length === 0) {
      return;
    }
    const batch = queue.slice();
    queue.length = 0;
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      if (item === undefined) {
        continue;
      }
      const handle = item.handle;
      if (handle.state === "released") {
        continue;
      }
      switch (item.kind) {
        case "loaded": {
          handle.settleLoaded(item.value);
          this.#loadedCount += 1;
          this.#bytesLoadedTotal += handle.bytesLoaded;
          this.#settleSession(handle);
          break;
        }
        case "failed": {
          handle.settleFailed(item.error);
          this.#failedCount += 1;
          this.#settleSession(handle);
          break;
        }
        case "replaced": {
          handle.settleReplaced(item.value);
          this.#refreshFragments(handle);
          break;
        }
        default: {
          assertNever(item, "asset delivery item");
        }
      }
      if (handle.refCount === 0) {
        this.onZeroReferences(handle);
      }
    }
  }

  /**
   * Re-derives every cached `#fragment` handle carved out of a base address that hot reload just
   * replaced, in the same delivery tick, so no two fragments of one file ever disagree.
   *
   * @param base - The base handle whose value changed.
   */
  #refreshFragments(base: AssetHandleImpl): void {
    if (base.fragment !== null) {
      return;
    }
    for (const handle of this.#entries.values()) {
      const fragment = handle.fragment;
      if (fragment === null || handle.loader.parseFragment === undefined || handle.state !== "loaded") {
        continue;
      }
      if (!handle.dependencies.includes(base)) {
        continue;
      }
      try {
        handle.settleReplaced(handle.loader.parseFragment(fragment, base.value));
      } catch (error) {
        this.#report(error);
      }
    }
  }

  /**
   * Advances the retry countdowns and restarts the attempts that came due.
   *
   * @param deltaSeconds - Unscaled seconds since the previous frame.
   */
  #tickRetries(deltaSeconds: number): void {
    const list = this.#retrying;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const handle = list[index];
      if (handle === undefined || handle.retryRemaining === NO_TIMER) {
        list.splice(index, 1);
        continue;
      }
      handle.retryRemaining -= deltaSeconds;
      if (handle.retryRemaining <= 0) {
        handle.retryRemaining = NO_TIMER;
        list.splice(index, 1);
        void this.#runLoad(handle);
      }
    }
  }

  /**
   * Advances the collector countdowns and unloads what came due.
   *
   * @param deltaSeconds - Scaled seconds since the previous frame.
   */
  #tickCollector(deltaSeconds: number): void {
    const list = this.#collecting;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const handle = list[index];
      if (handle === undefined) {
        list.splice(index, 1);
        continue;
      }
      if (handle.state === "loading") {
        continue;
      }
      handle.gcRemaining -= deltaSeconds;
      if (handle.gcRemaining <= 0) {
        list.splice(index, 1);
        this.#unload(handle);
      }
    }
  }

  /** Hands each watched handle's progress to its request callbacks, once per frame. */
  #publishProgress(): void {
    const watching = this.#watching;
    for (let index = watching.length - 1; index >= 0; index -= 1) {
      const handle = watching[index];
      if (handle === undefined) {
        watching.splice(index, 1);
        continue;
      }
      const progress = handle.progress;
      if (progress !== handle.lastDeliveredProgress) {
        handle.lastDeliveredProgress = progress;
        const listeners = handle.progressListeners;
        for (let at = 0; at < listeners.length; at += 1) {
          this.#invokeProgress(listeners[at], progress);
        }
      }
      if (handle.state !== "loading") {
        watching.splice(index, 1);
        handle.isWatched = false;
        handle.progressListeners.length = 0;
      }
    }
    this.#publishAggregate();
  }

  /**
   * Calls one progress listener, reporting a throw rather than letting it stop delivery.
   *
   * @param listener - The callback, or `undefined` for a hole the index checks produced.
   * @param progress - The fraction to report.
   */
  #invokeProgress(listener: ((fraction: number) => void) | undefined, progress: number): void {
    if (listener === undefined) {
      return;
    }
    try {
      listener(progress);
    } catch (error) {
      this.#report(error);
    }
  }

  /** Emits {@link AssetsImpl.onProgress} when the aggregate of the current run changed. */
  #publishAggregate(): void {
    const session = this.#session;
    let bytesLoaded = 0;
    let bytesTotal = 0;
    for (let index = 0; index < session.length; index += 1) {
      const handle = session[index];
      if (handle === undefined) {
        continue;
      }
      bytesLoaded += handle.bytesLoaded;
      bytesTotal += handle.bytesTotal;
    }
    const loaded = this.#sessionSettled;
    const total = session.length;
    if (
      loaded === this.#lastLoaded &&
      total === this.#lastTotal &&
      bytesLoaded === this.#lastBytesLoaded &&
      bytesTotal === this.#lastBytesTotal
    ) {
      return;
    }
    this.#lastLoaded = loaded;
    this.#lastTotal = total;
    this.#lastBytesLoaded = bytesLoaded;
    this.#lastBytesTotal = bytesTotal;
    this.onProgress.emit({ loaded, total, bytesLoaded, bytesTotal });
  }

  /** Writes the `assets` diagnostics counters (`15-devtools-and-diagnostics.md` §3). */
  #publishCounters(): void {
    const counters = this.#counters;
    counters.set(this.#countersLoaded, this.#loadedCount);
    counters.set(this.#countersInFlight, this.#inFlightCount);
    counters.set(this.#countersQueued, this.#queue.pendingCount);
    counters.set(this.#countersBytes, this.#bytesLoadedTotal);
    counters.set(this.#countersFailed, this.#failedCount);
    counters.set(this.#countersCandidates, this.#collecting.length);
  }

  /**
   * Adds a handle to the progress watch list once.
   *
   * @param handle - The handle to watch.
   */
  #watch(handle: AssetHandleImpl): void {
    if (handle.isWatched) {
      return;
    }
    handle.isWatched = true;
    this.#watching.push(handle);
  }

  /**
   * Starts a new aggregate-progress run when the previous one finished, and counts the handle into
   * it.
   *
   * @param handle - The handle whose load just started.
   */
  #beginSession(handle: AssetHandleImpl): void {
    if (this.#sessionSettled >= this.#session.length) {
      for (let index = 0; index < this.#session.length; index += 1) {
        const member = this.#session[index];
        if (member !== undefined) {
          member.isInSession = false;
        }
      }
      this.#session.length = 0;
      this.#sessionSettled = 0;
    }
    handle.isInSession = true;
    this.#session.push(handle);
  }

  /**
   * Counts a settled handle into the aggregate-progress run.
   *
   * @param handle - The handle that just settled.
   */
  #settleSession(handle: AssetHandleImpl): void {
    if (!handle.isInSession) {
      return;
    }
    handle.isInSession = false;
    this.#sessionSettled += 1;
  }

  /**
   * Builds one batch of requests behind a controller {@link BatchHandleImpl.cancel} can abort.
   *
   * @param refs - The addresses or references.
   * @param options - The options every member inherits, with the batch's own signal substituted.
   * @returns The batch.
   */
  #batch(refs: readonly (AssetRef | string)[], options: LoadOptions | undefined): BatchHandle {
    const controller = new AbortController();
    const outer = options?.signal;
    if (outer !== undefined) {
      if (outer.aborted) {
        controller.abort();
      } else {
        outer.addEventListener(
          "abort",
          (): void => {
            controller.abort();
          },
          { once: true },
        );
      }
    }
    const memberOptions: LoadOptions = { ...options, signal: controller.signal };
    const members: AssetHandleImpl[] = [];
    for (const ref of refs) {
      members.push(this.#request(ref, memberOptions, null));
    }
    return new BatchHandleImpl(members, controller);
  }

  /**
   * Drops a handle from the cache and releases everything it owns.
   *
   * @param handle - The handle to collect.
   */
  #unload(handle: AssetHandleImpl): void {
    this.#entries.delete(handle.key);
    if (this.#byAddress.get(handle.address) === handle) {
      this.#byAddress.delete(handle.address);
    }
    this.#releaseValue(handle);
  }

  /**
   * Releases a handle's value and its dependencies, and marks it released.
   *
   * @param handle - The handle to tear down.
   */
  #releaseValue(handle: AssetHandleImpl): void {
    if (handle.state === "loaded") {
      this.#loadedCount -= 1;
      this.#runUnload(handle, handle.value);
    }
    const dependencies = handle.dependencies;
    for (const dependency of dependencies) {
      dependency.release();
    }
    dependencies.length = 0;
    handle.isWatched = false;
    removeFrom(this.#watching, handle);
    handle.markReleased();
  }

  /**
   * Runs a loader's `unload`, reporting a throw rather than letting teardown fail.
   *
   * @param handle - The handle the value belonged to.
   * @param value - The value to release.
   */
  #runUnload(handle: AssetHandleImpl, value: unknown): void {
    if (handle.loader.unload === undefined) {
      return;
    }
    try {
      handle.loader.unload(value, new LoaderContextImpl(this, handle, new AbortController().signal, handle.priority));
    } catch (error) {
      this.#report(error);
    }
  }

  /**
   * Reports a failure the service caught at its boundary
   * (`docs/architecture/01-lifecycle-and-time.md` §5: `source: "asset"`).
   *
   * @param error - What was thrown.
   */
  #report(error: unknown): void {
    this.#app.onError.emit({ error, source: "asset", phase: null, entity: null, component: null });
  }
}

/**
 * Reads the host's `fetch`.
 *
 * @returns The global `fetch`, bound to `globalThis` so it keeps working when it is called as a
 * bare function.
 */
function defaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}

/**
 * The loader a {@link AssetsImpl.register} entry gets when no extension owns its type: it never
 * loads, because the value already exists, and it releases nothing, because an in-code value that
 * owns a resource is expected to be registered under a type whose loader knows how to free it.
 *
 * @param type - The asset type name.
 * @returns A loader that claims no extension.
 */
function memoryLoader(type: string): AssetLoader {
  return {
    type,
    extensions: [],
    load: (): Promise<never> =>
      Promise.reject(
        new IgnifxError(CoreErrorCode.assetNoLoader, `The in-memory asset type ${type} has no loader.`, {
          context: { type },
          hint: "Register a loader for the type, or keep using app.assets.register() to publish values.",
        }),
      ),
  };
}

/**
 * Narrows the untyped cache handle to what the caller declared.
 *
 * @typeParam T - The loaded value type the caller declared.
 * @param handle - The cache entry.
 * @returns The same object, typed.
 */
function toTyped<T>(handle: AssetHandleImpl): AssetHandle<T> {
  // A loader returns `unknown`, so `T` is the caller's
  // declaration of what this address holds — the same escape hatch `JSON.parse` callers take.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return handle as unknown as AssetHandle<T>;
}

/**
 * Removes the first occurrence of a handle from a list, by swapping the last entry into its slot.
 *
 * @param list - The list to edit.
 * @param handle - The handle to remove.
 */
function removeFrom(list: AssetHandleImpl[], handle: AssetHandleImpl): void {
  const index = list.indexOf(handle);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

/**
 * Discards the array `Promise.all` resolves with, so a batch promise is a `Promise<void>`.
 */
function toVoid(): void {
  // Deliberately empty: the batch reports completion, not values.
}

/**
 * Swallows a rejection that has already been reported through `state`, `error`, and the handle's own
 * promise.
 */
function ignoreRejection(): void {
  // Deliberately empty: see the comment at the call site.
}

/**
 * Reaches the engine-owned half of `app.assets` — delivery, hot reload, settings, and disposal —
 * from the kernel and the core extension, which only ever see the public {@link Assets} interface.
 *
 * @param assets - The service, normally `app.assets`.
 * @returns The same object, typed as its implementation.
 * @throws IgnifxError with code `IGX-0702` when the object was not created by ignifx.
 *
 * @internal
 */
export function assetsInternals(assets: Assets): AssetsImpl {
  if (assets instanceof AssetsImpl) {
    return assets;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.assets was not created by this copy of @ignifx/core.", {
    context: { member: "app.assets" },
    hint: "Reach the service through the app that created it.",
  });
}
