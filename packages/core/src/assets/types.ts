import { IgnifxError } from "../errors/ignifx-error.js";
import type { App } from "../app/types.js";
import type { ErrorCode } from "../errors/error-codes.js";
import type { IgnifxErrorOptions } from "../errors/ignifx-error.js";
import type { LiteEngine } from "../lite/scene.js";
import type { JsonObject } from "../schema/json.js";
import type { SignalLike } from "../signal/signal.js";

/**
 * The asset contract (`docs/architecture/05-assets-and-loading.md` §2–§5): addresses, handles,
 * loaders, the manifest, and the `app.assets` service itself.
 *
 * The module declares types plus one error class — no service behaviour — so that loaders written
 * in other packages (`@ignifx/audio`, `@ignifx/2d`, the GPU loaders of `07-rendering.md`) can be
 * written against it without importing the implementation, and so that nothing here imports
 * `@babylonjs/lite` (coding standards §4; the `LoaderContext.lite` escape hatch carries the engine
 * handle through as the adapter's own re-exported type alias).
 */

/**
 * The serializable form of an asset reference (`docs/architecture/05-assets-and-loading.md` §2).
 * It is a plain object so that it survives `JSON.stringify` and the schema codec unchanged; the way
 * to turn one into a handle is `app.assets.load(ref)`, never a method on the reference.
 *
 * @typeParam T - The loaded value type this reference points at. It is a compile-time marker only:
 * `assetOf` is never assigned at runtime and is never serialized. It exists so that
 * `AssetRef<TextureAsset>` and `AssetRef<ModelAsset>` are different types.
 *
 * @example
 * ```ts
 * const hero: AssetRef<ModelAsset> = assetRef("models/hero.glb");
 * const handle = app.assets.load(hero);
 * ```
 *
 * @public
 */
export interface AssetRef<T = unknown> {
  /** The address, for example `models/hero.glb` or `sprites/ui.atlas.json#frame:button_idle`. */
  readonly address: string;
  /** The asset type name, when the address alone does not identify it. */
  readonly type?: string;
  /** Compile-time marker for the loaded value type; never present at runtime. */
  readonly assetOf?: T;
}

/**
 * Where an {@link AssetHandle} is in its life
 * (`docs/architecture/05-assets-and-loading.md` §3).
 *
 * @public
 */
export type AssetState = "loading" | "loaded" | "failed" | "released";

/**
 * The reference-counted handle every load returns
 * (`docs/architecture/05-assets-and-loading.md` §3). Handles are shared: two loads of the same
 * `(address, type)` return the same object with `refCount` incremented, and each `load` must be
 * paired with exactly one {@link AssetHandle.release}.
 *
 * @typeParam T - The loaded value type.
 *
 * @remarks
 * A handle never becomes an invalid object. After the last holder releases it and the collector
 * has run, `state` is `"released"` and reading `value` throws `IGX-0501`; loading the same address
 * again starts a fresh load and returns a fresh handle.
 *
 * @example
 * ```ts
 * const model = app.assets.load<ModelAsset>("models/hero.glb");
 * // In a coroutine: `yield model.promise` resumes on the first Update after delivery.
 * await model.promise;
 * model.release();
 * ```
 *
 * @public
 */
export interface AssetHandle<T = unknown> {
  /** The address this handle was requested under, fragment included. */
  readonly address: string;
  /** The asset type the loader is registered under, for example `"model"`. */
  readonly type: string;
  /** Where the handle is in its life. */
  readonly state: AssetState;
  /**
   * The loaded value.
   *
   * @throws IgnifxError with code `IGX-0501` unless `state` is `"loaded"`.
   */
  readonly value: T;
  /** Resolves with {@link AssetHandle.value} at delivery, or rejects with an {@link AssetLoadError}. */
  readonly promise: Promise<T>;
  /** How far along the load is, in `[0, 1]`; bytes-weighted when the sizes are known. */
  readonly progress: number;
  /** Why the load failed, or `null` when it has not. */
  readonly error: AssetLoadError | null;
  /** How many holders the handle has. */
  readonly refCount: number;
  /**
   * Adds a holder.
   *
   * @returns This handle, so a retain reads inline.
   */
  retain(): this;
  /** Removes a holder. At zero the asset is unloaded after `assets.gcDelay` seconds. */
  release(): void;
  /** Emitted at delivery when hot reload replaced the value; `value` is already the new one. */
  readonly onReplaced: SignalLike<T>;
  /**
   * Releases one holder when the handle leaves a `using` block — exactly {@link AssetHandle.release}
   * (`docs/architecture/05-assets-and-loading.md` §3).
   *
   * @example
   * ```ts
   * using icon = app.assets.load<TextureAsset>("ui/icon.png");
   * await icon.promise;
   * ```
   */
  [Symbol.dispose](): void;
}

/**
 * Options accepted by every load entry point of {@link Assets}.
 *
 * @public
 */
export interface LoadOptions {
  /** Aborts this request. Whether it aborts the shared load is documented on {@link Assets.load}. */
  readonly signal?: AbortSignal;
  /** Higher runs first; ties break in request order. Defaults to `0`. */
  readonly priority?: number;
  /** The asset type, when the address's extension does not identify it. */
  readonly type?: string;
  /**
   * Called at delivery whenever this request's progress changed.
   *
   * @param fraction - How far along the load is, in `[0, 1]`.
   */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * A group of loads requested together
 * (`docs/architecture/05-assets-and-loading.md` §4).
 *
 * @public
 */
export interface BatchHandle {
  /** Settles once every handle in the batch has settled; rejects with the first failure. */
  readonly promise: Promise<void>;
  /** The mean of the batch's handle progresses, in `[0, 1]`. */
  readonly progress: number;
  /** The handles the batch retains. */
  readonly handles: readonly AssetHandle[];
  /** Releases every handle the batch retains. Calling it twice is a no-op. */
  release(): void;
  /** Aborts every load the batch started and releases it. */
  cancel(): void;
}

/**
 * One address in the manifest (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @public
 */
export interface AssetManifestEntry {
  /** The address game code asks for. */
  readonly address: string;
  /** The URL to fetch, usually content-hashed in production builds. */
  readonly url: string;
  /** The byte size, when the build knows it; it makes progress bytes-weighted. */
  readonly bytes?: number;
  /** The content hash, for cache validation. */
  readonly hash?: string;
  /** The asset type, when the extension does not identify it. */
  readonly type?: string;
  /** The group labels this entry belongs to, such as `"boot"` or `"level1"`. */
  readonly groups?: readonly string[];
  /**
   * The `.meta.json` sidecar the build read for this address, verbatim
   * (`docs/architecture/05-assets-and-loading.md` §7). Loaders read the sub-object they own — the
   * texture loader reads `meta.texture`, the model loader reads `meta.model` — and ignore the rest,
   * so one sidecar can carry options for several tools.
   *
   * @example
   * ```json
   * { "groups": ["level1"], "texture": { "srgb": true, "mipMaps": false } }
   * ```
   */
  readonly meta?: JsonObject;
}

/**
 * The address-to-URL table generated by `@ignifx/vite-plugin`
 * (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @public
 */
export interface AssetManifest {
  /** The file's format discriminator. */
  readonly format: "ignifx.manifest";
  /** The format version this build can read. */
  readonly formatVersion: 1;
  /** The asset root every relative address is resolved against. */
  readonly root: string;
  /** Every addressed file. */
  readonly entries: readonly AssetManifestEntry[];
}

/**
 * What a loader is handed for one load
 * (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * @remarks
 * The three `fetch*` methods share one code path: the bytes are streamed through the service's
 * priority queue, counted into the handle's progress, and aborted with {@link LoaderContext.signal}.
 * A loader that reaches the network any other way loses progress, cancellation, and retries.
 *
 * @public
 */
export interface LoaderContext {
  /** The address being loaded, fragment included. */
  readonly address: string;
  /** The URL the address resolved to, fragment stripped. */
  readonly url: string;
  /** The `#fragment` part of the address, or `null` when it carries none. */
  readonly fragment: string | null;
  /** The asset type the loader is registered under. */
  readonly type: string;
  /** The app the load belongs to. */
  readonly app: App;
  /** Aborted when the request is cancelled or the app is disposed. */
  readonly signal: AbortSignal;
  /**
   * Fetches the address as bytes, with progress and cancellation.
   *
   * @returns The response body.
   */
  fetchBytes(): Promise<ArrayBuffer>;
  /**
   * Fetches the address as UTF-8 text.
   *
   * @returns The decoded body.
   */
  fetchText(): Promise<string>;
  /**
   * Fetches the address and parses it as JSON.
   *
   * @typeParam J - The parsed shape, as the loader declares it.
   * @returns The parsed body.
   */
  fetchJson<J = unknown>(): Promise<J>;
  /**
   * Loads another asset as a dependency of this one: its progress counts into this load and the
   * retain it takes is released when this asset is unloaded.
   *
   * @typeParam D - The dependency's loaded value type.
   * @param ref - The dependency's address or reference.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The dependency's handle, once it has been delivered.
   */
  loadDependency<D>(ref: AssetRef<D> | string, options?: LoadOptions): Promise<AssetHandle<D>>;
  /**
   * Reports progress for loaders that cannot express it in bytes.
   *
   * @param fraction - How far along the load is, in `[0, 1]`.
   */
  reportProgress(fraction: number): void;
  /**
   * The `.meta.json` sidecar the build recorded for this address, or `null` when the manifest lists
   * none (`docs/architecture/05-assets-and-loading.md` §7).
   *
   * @remarks
   * Read the sub-object your loader owns and ignore the rest: one sidecar carries options for
   * several tools, and `groups` in it belongs to the manifest generator, not to a loader.
   *
   * @example
   * ```ts
   * const srgb = asRecord(ctx.meta?.["texture"])?.["srgb"] === true;
   * ```
   */
  readonly meta: JsonObject | null;
  /** Unstable Babylon Lite escape hatch for GPU loaders (`docs/architecture/00-overview.md` §3). */
  readonly lite: { readonly engine: LiteEngine };
}

/**
 * How one asset type is turned into a value
 * (`docs/architecture/05-assets-and-loading.md` §5). Loaders are pure with respect to the world:
 * they produce values and never create entities.
 *
 * @typeParam T - The value the loader produces.
 *
 * @example
 * ```ts
 * const jsonLoader: AssetLoader<unknown> = {
 *   type: "json",
 *   extensions: [".json"],
 *   load: (ctx) => ctx.fetchJson(),
 * };
 * ```
 *
 * @public
 */
export interface AssetLoader<T = unknown> {
  /** The type name the loader is registered under, for example `"texture"`. */
  readonly type: string;
  /** The address suffixes that select this loader, each with its leading dot. */
  readonly extensions: readonly string[];
  /**
   * Produces the value.
   *
   * @param ctx - The address, the fetch helpers, and the abort signal.
   * @returns The loaded value.
   */
  load(ctx: LoaderContext): Promise<T>;
  /**
   * Releases whatever the value owns — GPU buffers, audio nodes, object URLs.
   *
   * @param value - The value {@link AssetLoader.load} produced.
   * @param ctx - The same context the load ran with.
   */
  unload?(value: T, ctx: LoaderContext): void;
  /**
   * Re-produces the value in development hot reload. Defaults to unload plus load.
   *
   * @param ctx - The context for the new load.
   * @param previous - The value being replaced.
   * @returns The new value.
   */
  reload?(ctx: LoaderContext, previous: T): Promise<T>;
  /**
   * Extracts a sub-asset named by an address fragment, such as `#animation:Run`.
   *
   * @remarks
   * Declaring it is what makes `models/hero.glb#animation:Run` load the base address once and share
   * it: the fragment handle retains the base handle and its value is whatever this returns. A
   * loader that does not declare it is invoked with the fragment in {@link LoaderContext.fragment}
   * and owns the whole address itself.
   *
   * @param fragment - The text after `#`.
   * @param value - The base address's value.
   * @returns The sub-asset.
   */
  parseFragment?(fragment: string, value: T): unknown;
}

/**
 * An asset type declared without a loader, so that addresses resolve to a type before the loader
 * that reads them is registered (`docs/architecture/04-extensions.md` §1).
 *
 * @public
 */
export interface AssetTypeDefinition {
  /** The type name, for example `"texture"`. */
  readonly type: string;
  /** The address suffixes that select it, each with its leading dot. */
  readonly extensions: readonly string[];
}

/**
 * The aggregate payload of {@link Assets.onProgress}: how the current batch of work is going
 * (`docs/architecture/05-assets-and-loading.md` §4).
 *
 * @public
 */
export interface AssetProgress {
  /** How many of the loads in flight have settled. */
  readonly loaded: number;
  /** How many loads are in the current run. */
  readonly total: number;
  /** Bytes received so far. */
  readonly bytesLoaded: number;
  /** Bytes expected, as far as the manifest and the response headers say. */
  readonly bytesTotal: number;
}

/**
 * The `assets` project settings section
 * (`docs/architecture/04-extensions.md` §5, `05-assets-and-loading.md` §4).
 *
 * @public
 */
export interface AssetsSettings {
  /** The asset root relative addresses resolve against. Defaults to `"assets"`. */
  readonly root: string;
  /** Manifest group labels loaded during `app.start()`. Defaults to none. */
  readonly preload: readonly string[];
  /** How many fetches may be in flight at once. Defaults to `6`. */
  readonly concurrency: number;
  /** How many seconds a zero-reference asset stays cached. Defaults to `5`. */
  readonly gcDelay: number;
  /** How many times a failed fetch is retried. Defaults to `2`. */
  readonly retries: number;
}

/**
 * Options accepted by {@link Assets.register}.
 *
 * @public
 */
export interface RegisterAssetOptions {
  /** The asset type the value is published under, for example `"mesh"` or `"material"`. */
  readonly type: string;
  /**
   * The address to publish it at. Defaults to a generated `memory:<type>/<ulid>`; pass one only to
   * make an in-code asset reachable by name from `app.assets.get`.
   */
  readonly address?: string;
}

/**
 * The `fetch` implementation the service performs every read through
 * (`docs/architecture/05-assets-and-loading.md` §8). Injecting it is how headless tests supply
 * deterministic responses and how a Node app maps addresses onto `fs` (Phase 9).
 *
 * @public
 */
export type FetchLike = typeof globalThis.fetch;

/**
 * The asset service, reached as `app.assets`
 * (`docs/architecture/05-assets-and-loading.md` §4).
 *
 * @example
 * ```ts
 * const batch = app.assets.loadAll(["ui/font.ttf", "sprites/hero.png"]);
 * app.assets.onProgress.connect((p) => bar.set(p.loaded / p.total));
 * await batch.promise;
 * ```
 *
 * @public
 */
export interface Assets {
  /**
   * Requests an asset and returns its handle immediately.
   *
   * @remarks
   * Completion is delivered in the `PreUpdate` phase of a later frame, never mid-phase: `state`
   * flips and `promise` settles at that one point
   * (`docs/architecture/01-lifecycle-and-time.md` §3 step 2).
   *
   * An `options.signal` abort drops *this* request's hold. It aborts the shared load only when no
   * other request is still interested in it; a load two scripts asked for keeps going when one of
   * them cancels, and the shared handle still resolves.
   *
   * @typeParam T - The loaded value type.
   * @param ref - The address, or a reference carrying one.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The shared handle, with one more holder.
   * @throws IgnifxError with code `IGX-0504` when no loader claims the address, or `IGX-0106` when
   * the app has been disposed.
   */
  load<T>(ref: AssetRef<T> | string, options?: LoadOptions): AssetHandle<T>;
  /**
   * Requests an asset and waits for the same delivery point {@link Assets.load} settles at.
   *
   * @typeParam T - The loaded value type.
   * @param ref - The address, or a reference carrying one.
   * @param options - Priority, type, progress, and cancellation.
   * @returns The handle, once it has loaded.
   */
  loadAsync<T>(ref: AssetRef<T> | string, options?: LoadOptions): Promise<AssetHandle<T>>;
  /**
   * Reloads a loaded asset from its source, delivering the new value through `onReplaced` the way a
   * development hot reload does (`docs/architecture/05-assets-and-loading.md` §7); a handle that is
   * not loaded is left alone. The Vite plugin's HMR channel and the devtools Assets panel call it.
   *
   * @param address - The asset's address.
   */
  reload(address: string): void;
  /**
   * Requests several assets as one batch.
   *
   * @param refs - The addresses or references.
   * @param options - Priority, type, progress, and cancellation, applied to every member.
   * @returns The batch.
   */
  loadAll(refs: readonly (AssetRef | string)[], options?: LoadOptions): BatchHandle;
  /**
   * Loads every manifest entry carrying a group label.
   *
   * @param group - The label, such as `"boot"`.
   * @param options - Priority, progress, and cancellation.
   * @returns The batch; empty when the manifest knows no such group.
   */
  preloadGroup(group: string, options?: LoadOptions): BatchHandle;
  /**
   * Looks a cached handle up without changing its reference count.
   *
   * @typeParam T - The loaded value type.
   * @param address - The address, fragment included.
   * @returns The handle, or `null` when the address is not cached.
   */
  get<T>(address: string): AssetHandle<T> | null;
  /**
   * Removes one holder from a handle, by object or by address.
   *
   * @param handleOrAddress - The handle, or the address it was requested under.
   */
  release(handleOrAddress: AssetHandle | string): void;
  /** Unloads every zero-reference asset now, without waiting for {@link Assets.gcDelay}. */
  gc(): void;
  /** How many seconds a zero-reference asset stays cached. `0` unloads at the next delivery. */
  gcDelay: number;
  /**
   * Resolves an address to the URL the service fetches.
   *
   * @param address - The address; the fragment is stripped.
   * @returns The manifest's URL for the address, or `<root>/<address>`.
   */
  resolveUrl(address: string): string;
  /**
   * Registers a loader. Extensions normally call `ctx.registerAssetLoader` instead.
   *
   * @param loader - The loader.
   * @throws IgnifxError with code `IGX-0506` when the type is already registered.
   */
  registerLoader(loader: AssetLoader): void;
  /**
   * Declares an asset type that has no loader yet.
   *
   * @param type - The type name and the extensions that select it.
   */
  registerType(type: AssetTypeDefinition): void;
  /**
   * Publishes a value built in code as an asset, so an `asset()` field can hold it
   * (`docs/architecture/05-assets-and-loading.md` §3). This is what `MeshAsset.box(…)` and
   * `MaterialAsset.pbr(…)` return.
   *
   * @remarks
   * The handle is created already `loaded`, under a synthetic `memory:<type>/<ulid>` address, with
   * one holder — the caller. It plays by the ordinary rules from there: `retain`/`release` count,
   * the collector unloads it `gcDelay` seconds after the last holder lets go, and the registered
   * type's loader `unload` runs then if one exists. Because the address names no file, serializing
   * a component that references it writes `null` and reports the loss.
   *
   * @typeParam T - The value type.
   * @param value - The already-built value.
   * @param options - The asset type it is registered under, and an explicit address to publish it
   * at instead of the generated one.
   * @returns The handle, with one holder.
   *
   * @example
   * ```ts
   * using box = app.assets.register(mesh, { type: "mesh" });
   * ```
   */
  register<T>(value: T, options: RegisterAssetOptions): AssetHandle<T>;
  /** The address-to-URL table, empty until a build supplies one. */
  readonly manifest: AssetManifest;
  /** Emitted at delivery whenever the aggregate progress of the loads in flight changed. */
  readonly onProgress: SignalLike<AssetProgress>;
}

/**
 * Options accepted by {@link AssetLoadError}.
 *
 * @public
 */
export interface AssetLoadErrorOptions extends IgnifxErrorOptions {
  /** The address that failed. */
  readonly address: string;
  /** The URL it resolved to. */
  readonly url: string;
}

/**
 * The failure an {@link AssetHandle.promise} rejects with
 * (`docs/architecture/05-assets-and-loading.md` §9). Its `code` is one of `IGX-0502` (aborted),
 * `IGX-0503` (the app was disposed), `IGX-0504` (no loader), or `IGX-0505` (the load failed after
 * every retry, with the last failure as `cause`).
 *
 * @example
 * ```ts
 * try {
 *   await app.assets.loadAsync("levels/1.scene.json");
 * } catch (error) {
 *   if (error instanceof AssetLoadError) {
 *     app.log.error("{address} failed from {url}", error.address, error.url);
 *   }
 * }
 * ```
 *
 * @public
 */
export class AssetLoadError extends IgnifxError {
  /** The address that failed. */
  readonly address: string;

  /** The URL it resolved to. */
  readonly url: string;

  /**
   * Creates an asset failure.
   *
   * @param code - The `IGX-05xx` code.
   * @param message - The actionable development sentence.
   * @param options - The address and URL, plus the standard `context`, `hint`, and `cause`.
   */
  constructor(code: ErrorCode, message: string, options: AssetLoadErrorOptions) {
    super(code, message, options);
    this.name = "AssetLoadError";
    this.address = options.address;
    this.url = options.url;
  }
}
