/**
 * The contract the preload bridge exposes and the renderer extension consumes
 * (`docs/architecture/14-platform-electron.md` §3). It is the one module both processes share, and
 * it deliberately imports nothing: the preload side pulls in `electron`, the renderer side pulls in
 * `@ignifx/core`, and a shared module that imported either would drag it across the process
 * boundary.
 *
 * Everything crossing the bridge is structured-clonable. `Uint8Array` survives Electron's
 * structured clone, which is what lets a binary save round-trip without base64.
 */

/**
 * The `ignifx://` scheme the packaged renderer is served from.
 *
 * @public
 */
export const IGNIFX_SCHEME = "ignifx";

/**
 * The authority the packaged renderer is served under, so the whole origin reads
 * `ignifx://app`.
 *
 * @remarks
 * A privileged `standard` scheme has a real origin, and a real origin is what makes `'self'` in the
 * Content-Security-Policy mean "the packaged app" rather than nothing at all.
 *
 * @public
 */
export const IGNIFX_HOST_AUTHORITY = "app";

/**
 * The origin the packaged renderer runs on: `ignifx://app`.
 *
 * @public
 */
export const IGNIFX_ORIGIN: string = `${IGNIFX_SCHEME}://${IGNIFX_HOST_AUTHORITY}`;

/**
 * The version of this contract that the preload bridge announces as `window.ignifxHost.version`.
 *
 * @remarks
 * Semver over the *bridge*, not over the package: the renderer refuses a host whose major differs
 * from its own, because a preload script from a different install is the one thing a packaged app
 * can genuinely end up with (an `asar` from a previous build, a partially applied update).
 *
 * @public
 */
export const HOST_CONTRACT_VERSION = "1.0.0";

/**
 * The major component of {@link HOST_CONTRACT_VERSION}, which is what compatibility is decided on.
 *
 * @public
 */
export const HOST_CONTRACT_MAJOR = 1;

/**
 * A stored value as it crosses the bridge: the wire form of `@ignifx/core`'s `StoredValue`
 * (`docs/architecture/14-platform-electron.md` §2).
 *
 * @public
 */
export type HostStoredValue =
  | {
      /** Discriminant: this value is JSON text. */
      readonly kind: "json";
      /** The canonical JSON text of the value. */
      readonly json: string;
    }
  | {
      /** Discriminant: this value is a byte array. */
      readonly kind: "bytes";
      /** The octets. May be empty. */
      readonly bytes: Uint8Array;
    };

/**
 * The storage half of the bridge. Namespaces and keys arrive already validated by the `Storage`
 * facade, so the main process treats a key as opaque text and encodes it for the file system.
 *
 * @public
 */
export interface HostStorage {
  /**
   * Reads one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside that namespace.
   * @returns The stored value, or `null` when there is none.
   */
  get(namespace: string, key: string): Promise<HostStoredValue | null>;
  /**
   * Writes one value, replacing whatever was there.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside that namespace.
   * @param value - The JSON text or the octets to persist.
   * @returns A promise that settles once the value is durable.
   */
  set(namespace: string, key: string, value: HostStoredValue): Promise<void>;
  /**
   * Removes one value.
   *
   * @param namespace - The namespace path.
   * @param key - The key inside that namespace.
   * @returns A promise that settles once the value is gone.
   */
  delete(namespace: string, key: string): Promise<void>;
  /**
   * Lists the keys of one namespace.
   *
   * @param namespace - The namespace path.
   * @param prefix - When given, only keys that start with this string are returned.
   * @returns The matching keys, sorted ascending.
   */
  keys(namespace: string, prefix?: string): Promise<readonly string[]>;
  /**
   * Removes every value of one namespace.
   *
   * @param namespace - The namespace path.
   * @returns A promise that settles once the namespace is empty.
   */
  clear(namespace: string): Promise<void>;
}

/**
 * The directories a desktop build is allowed to know about, resolved once at startup.
 *
 * @remarks
 * Read-only strings, not handles: a game that wants to *write* somewhere uses `app.storage`, which
 * goes through the same bridge and cannot escape `userData`.
 *
 * @public
 */
export interface HostPaths {
  /** The per-user, per-app directory Electron gives the app; where `app.storage` lives. */
  readonly userData: string;
  /** The platform's roaming application-data directory. */
  readonly appData: string;
  /** The platform's temporary directory. */
  readonly temp: string;
  /** The current user's home directory. */
  readonly home: string;
  /** The current user's downloads directory, or `""` where the platform has none. */
  readonly downloads: string;
  /** The current user's documents directory, or `""` where the platform has none. */
  readonly documents: string;
  /** The directory the packaged application resources were loaded from. */
  readonly appPath: string;
}

/**
 * One file-type row of an open dialog.
 *
 * @public
 */
export interface HostFileFilter {
  /** The row's label, for example `"Saved games"`. */
  readonly name: string;
  /** Extensions without a leading dot, for example `["sav", "json"]`. */
  readonly extensions: readonly string[];
}

/**
 * What `HostDialogs.showOpenDialog` accepts. A deliberate subset of Electron's
 * `OpenDialogOptions` (`electron.d.ts` 15318): everything here is a plain value, so nothing about
 * the main process leaks into the renderer's types.
 *
 * @public
 */
export interface HostOpenDialogOptions {
  /** The dialog's title, where the platform shows one. */
  readonly title?: string;
  /** The directory the dialog opens in. */
  readonly defaultPath?: string;
  /** The confirm button's label. */
  readonly buttonLabel?: string;
  /** The file-type rows. */
  readonly filters?: readonly HostFileFilter[];
  /** Whether files may be chosen. Defaults to `true`. */
  readonly files?: boolean;
  /** Whether directories may be chosen. Defaults to `false`. */
  readonly directories?: boolean;
  /** Whether more than one entry may be chosen. Defaults to `false`. */
  readonly multiple?: boolean;
}

/**
 * What an open dialog returned.
 *
 * @public
 */
export interface HostOpenDialogResult {
  /** Whether the user dismissed the dialog. */
  readonly canceled: boolean;
  /** The absolute paths chosen; empty when the dialog was dismissed. */
  readonly paths: readonly string[];
}

/**
 * The window controls the bridge exposes.
 *
 * @public
 */
export interface HostWindow {
  /**
   * Enters or leaves full screen.
   *
   * @param fullscreen - `true` to enter, `false` to leave.
   * @returns A promise that settles once the main process has applied it.
   */
  setFullscreen(fullscreen: boolean): Promise<void>;
  /**
   * Reports whether the window is full screen.
   *
   * @returns `true` when it is.
   */
  isFullscreen(): Promise<boolean>;
  /**
   * Sets the window's title.
   *
   * @param title - The new title.
   * @returns A promise that settles once the main process has applied it.
   */
  setTitle(title: string): Promise<void>;
  /**
   * Closes the window and quits the application.
   *
   * @returns A promise that settles once the quit has been requested.
   */
  quit(): Promise<void>;
  /**
   * Subscribes to the window lifecycle events the main process forwards.
   *
   * @param listener - Called with each event name.
   * @returns A function that unsubscribes.
   */
  onEvent(listener: (event: HostWindowEvent) => void): () => void;
}

/**
 * The window lifecycle events the main process forwards to the renderer.
 *
 * @remarks
 * `minimize`/`restore` and `focus`/`blur` are the four `14-platform-electron.md` §3 names; the
 * full-screen pair is carried too because `app.desktop.setFullscreen` is asynchronous and a game
 * that wants to reflect the state in its own menu needs to hear about the platform's own
 * full-screen gesture as well.
 *
 * @public
 */
export type HostWindowEvent = "minimize" | "restore" | "focus" | "blur" | "enter-full-screen" | "leave-full-screen";

/**
 * The dialogs the bridge exposes.
 *
 * @public
 */
export interface HostDialogs {
  /**
   * Shows a modal open dialog over the game window.
   *
   * @param options - What the dialog offers.
   * @returns What the user chose.
   */
  showOpenDialog(options?: HostOpenDialogOptions): Promise<HostOpenDialogResult>;
}

/**
 * The shell half of the bridge.
 *
 * @public
 */
export interface HostShell {
  /**
   * Opens a URL in the user's browser or mail client.
   *
   * @remarks
   * The main process checks the protocol against an allow-list before handing it to the OS; a
   * refusal rejects rather than silently doing nothing.
   *
   * @param url - The absolute URL to open.
   * @returns A promise that settles once the OS accepted it.
   */
  openExternal(url: string): Promise<void>;
}

/**
 * `window.ignifxHost`: everything the preload script exposes to the renderer
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * @remarks
 * Every member is a function or a plain value. No `ipcRenderer`, no `Electron` object, and nothing
 * with a prototype the renderer could walk back to Node — `contextBridge` would refuse most of that
 * anyway, and the ones it would allow are exactly the ones `CONSTITUTION.md` §9.2 forbids.
 *
 * @example
 * ```ts
 * if (window.ignifxHost !== undefined) {
 *   const { userData } = await window.ignifxHost.paths();
 * }
 * ```
 *
 * @public
 */
export interface IgnifxHost {
  /** The {@link HOST_CONTRACT_VERSION} this bridge was built from. */
  readonly version: string;
  /** The Electron, Chromium, and Node versions the app is running on. */
  readonly versions: HostVersions;
  /** Reference-counted key/value storage under `userData`. */
  readonly storage: HostStorage;
  /**
   * Resolves the platform directories.
   *
   * @returns The directories, resolved by the main process.
   */
  paths(): Promise<HostPaths>;
  /** Window controls and window lifecycle events. */
  readonly window: HostWindow;
  /** Native dialogs. */
  readonly dialogs: HostDialogs;
  /** The OS shell. */
  readonly shell: HostShell;
}

/**
 * The runtime versions the bridge reports, read from `process.versions` in the preload script.
 *
 * @public
 */
export interface HostVersions {
  /** The Electron version, for example `"44.2.0"`. */
  readonly electron: string;
  /** The Chromium version. */
  readonly chrome: string;
  /** The Node version bundled with Electron. */
  readonly node: string;
}

/**
 * The IPC channel names the preload script invokes and the main process handles.
 *
 * @remarks
 * One flat `as const` table rather than a nested one: the values are what both processes must agree
 * on literally, and a flat table is what a `switch` over channels can be exhaustive against
 * (coding standards §5.2).
 *
 * @public
 */
export const HOST_CHANNELS = {
  /** `storage.get(namespace, key)`. */
  storageGet: "ignifx:storage.get",
  /** `storage.set(namespace, key, value)`. */
  storageSet: "ignifx:storage.set",
  /** `storage.delete(namespace, key)`. */
  storageDelete: "ignifx:storage.delete",
  /** `storage.keys(namespace, prefix)`. */
  storageKeys: "ignifx:storage.keys",
  /** `storage.clear(namespace)`. */
  storageClear: "ignifx:storage.clear",
  /** `paths()`. */
  paths: "ignifx:paths",
  /** `window.setFullscreen(fullscreen)`. */
  windowSetFullscreen: "ignifx:window.setFullscreen",
  /** `window.isFullscreen()`. */
  windowIsFullscreen: "ignifx:window.isFullscreen",
  /** `window.setTitle(title)`. */
  windowSetTitle: "ignifx:window.setTitle",
  /** `window.quit()`. */
  windowQuit: "ignifx:window.quit",
  /** `dialogs.showOpenDialog(options)`. */
  dialogsShowOpen: "ignifx:dialogs.showOpenDialog",
  /** `shell.openExternal(url)`. */
  shellOpenExternal: "ignifx:shell.openExternal",
} as const;

/**
 * The union of the channel names {@link HOST_CHANNELS} declares.
 *
 * @public
 */
export type HostChannel = (typeof HOST_CHANNELS)[keyof typeof HOST_CHANNELS];

/**
 * The one main-to-renderer channel: window lifecycle events, pushed rather than polled.
 *
 * @public
 */
export const HOST_WINDOW_EVENT_CHANNEL = "ignifx:window-event";

/**
 * The property `contextBridge` exposes the host under.
 *
 * @public
 */
export const HOST_GLOBAL_NAME = "ignifxHost";

/**
 * Reports whether a bridge's announced version is one this build can talk to.
 *
 * @remarks
 * Major equality, nothing else: a bridge with a newer minor has methods this renderer does not
 * call, and a bridge with an older minor is caught by the per-member check in
 * `renderer/host.ts` rather than by the version string.
 *
 * @param version - The value of `window.ignifxHost.version`.
 * @returns `true` when the majors match.
 *
 * @example
 * ```ts
 * isCompatibleHostVersion("1.4.0"); // true
 * isCompatibleHostVersion("2.0.0"); // false
 * ```
 *
 * @public
 */
export function isCompatibleHostVersion(version: string): boolean {
  const major = Number.parseInt(version, 10);
  return Number.isInteger(major) && major === HOST_CONTRACT_MAJOR;
}

/**
 * The marker a main-process quota failure is re-thrown with, so the renderer can tell `IGX-1424`
 * from `IGX-1425` after the error has crossed IPC.
 *
 * @remarks
 * Electron flattens an error thrown inside `ipcMain.handle` down to its message by the time it
 * reaches the renderer: neither a `code` property nor the prototype survives the trip. A prefix on
 * the message does, and it is the only channel available without wrapping every reply in an
 * envelope. It lives in the contract module because both processes have to agree on the string, and
 * this is the one module both of them import.
 *
 * @public
 */
export const QUOTA_MESSAGE_PREFIX = "IGNIFX_STORAGE_QUOTA: ";
