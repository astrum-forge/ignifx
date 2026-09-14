import { contextBridge, ipcRenderer } from "electron";
import { HOST_CHANNELS, HOST_CONTRACT_VERSION, HOST_GLOBAL_NAME, HOST_WINDOW_EVENT_CHANNEL } from "../host-contract.js";
import type {
  HostOpenDialogOptions,
  HostOpenDialogResult,
  HostPaths,
  HostStoredValue,
  HostVersions,
  HostWindowEvent,
  IgnifxHost,
} from "../host-contract.js";
import type { IpcRendererEvent } from "electron";

/**
 * Expose only the fixed async host methods and plain event data to the renderer.
 * Never pass `ipcRenderer` or its event objects across the bridge.
 * Bundle the preload as CommonJS for sandboxed windows (ADR-0018).
 */

/**
 * Invokes one main-process handler.
 *
 * @remarks
 * The one place this package narrows an IPC reply. `ipcRenderer.invoke` is declared
 * `Promise<any>` (`electron.d.ts` 9553), so every call site would otherwise be an unsafe return;
 * funnelling them through one typed helper puts the single assertion here, next to the reason for
 * it. What each channel actually resolves to is fixed by the matching `ipcMain.handle` in
 * `main/ipc.ts`, and the renderer re-checks anything it cannot afford to be wrong about — see
 * `renderer/storage-backend.ts`.
 *
 * @typeParam T - What the channel's handler resolves to.
 * @param channel - The channel name from `HOST_CHANNELS`.
 * @param args - The arguments the handler takes.
 * @returns What the handler resolved.
 */
async function invoke<T>(channel: string, ...args: readonly unknown[]): Promise<T> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the remarks above.
  return result as T;
}

/**
 * Narrows an unknown value to something whose string keys can be read.
 *
 * @param value - The value to test.
 * @returns `true` for any non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the runtime versions from the `process` shim a sandboxed preload is given.
 *
 * @remarks
 * A sandboxed preload has no Node, but Electron still injects a small `process` with `versions`,
 * `platform`, and a handful of other read-only fields. It is read defensively anyway, so that this
 * module can be imported in a unit test where no such global exists.
 *
 * @returns The Electron, Chromium, and Node versions, each `""` when unavailable.
 *
 * @public
 */
export function readHostVersions(): HostVersions {
  const scope: unknown = globalThis;
  if (!isRecord(scope)) {
    return { electron: "", chrome: "", node: "" };
  }
  const candidate: unknown = scope["process"];
  if (!isRecord(candidate)) {
    return { electron: "", chrome: "", node: "" };
  }
  const versions: unknown = candidate["versions"];
  if (!isRecord(versions)) {
    return { electron: "", chrome: "", node: "" };
  }
  const read = (name: string): string => {
    const value: unknown = versions[name];
    return typeof value === "string" ? value : "";
  };
  return { electron: read("electron"), chrome: read("chrome"), node: read("node") };
}

/**
 * Builds the object the bridge exposes.
 *
 * @remarks
 * Exported separately from {@link exposeIgnifxHost} so the unit suite can assert the contract's
 * shape — every member present, every one a function or a plain value — without a `contextBridge`.
 *
 * @returns The host object.
 *
 * @example
 * ```ts
 * const host = createIgnifxHost();
 * host.version; // "1.0.0"
 * ```
 *
 * @public
 */
export function createIgnifxHost(): IgnifxHost {
  return {
    version: HOST_CONTRACT_VERSION,
    versions: readHostVersions(),
    storage: {
      get: (namespace: string, key: string): Promise<HostStoredValue | null> =>
        invoke<HostStoredValue | null>(HOST_CHANNELS.storageGet, namespace, key),
      set: (namespace: string, key: string, value: HostStoredValue): Promise<void> =>
        invoke<void>(HOST_CHANNELS.storageSet, namespace, key, value),
      delete: (namespace: string, key: string): Promise<void> =>
        invoke<void>(HOST_CHANNELS.storageDelete, namespace, key),
      keys: (namespace: string, prefix?: string): Promise<readonly string[]> =>
        invoke<readonly string[]>(HOST_CHANNELS.storageKeys, namespace, prefix),
      clear: (namespace: string): Promise<void> => invoke<void>(HOST_CHANNELS.storageClear, namespace),
    },
    paths: (): Promise<HostPaths> => invoke<HostPaths>(HOST_CHANNELS.paths),
    window: {
      setFullscreen: (fullscreen: boolean): Promise<void> =>
        invoke<void>(HOST_CHANNELS.windowSetFullscreen, fullscreen),
      isFullscreen: (): Promise<boolean> => invoke<boolean>(HOST_CHANNELS.windowIsFullscreen),
      setTitle: (title: string): Promise<void> => invoke<void>(HOST_CHANNELS.windowSetTitle, title),
      quit: (): Promise<void> => invoke<void>(HOST_CHANNELS.windowQuit),
      onEvent: (listener: (event: HostWindowEvent) => void): (() => void) => {
        // The `IpcRendererEvent` is dropped here on purpose: it carries a live `sender`, and the
        // whole point of the bridge is that the renderer never holds one.
        const forward = (_event: IpcRendererEvent, name: HostWindowEvent): void => {
          listener(name);
        };
        ipcRenderer.on(HOST_WINDOW_EVENT_CHANNEL, forward);
        return (): void => {
          ipcRenderer.removeListener(HOST_WINDOW_EVENT_CHANNEL, forward);
        };
      },
    },
    dialogs: {
      showOpenDialog: (options?: HostOpenDialogOptions): Promise<HostOpenDialogResult> =>
        invoke<HostOpenDialogResult>(HOST_CHANNELS.dialogsShowOpen, options ?? {}),
    },
    shell: {
      openExternal: (url: string): Promise<void> => invoke<void>(HOST_CHANNELS.shellOpenExternal, url),
    },
  };
}

/**
 * Exposes the bridge as `window.ignifxHost`.
 *
 * @remarks
 * The one call a desktop app's `desktop/preload.ts` has to make. It runs at import time by
 * design — a preload script *is* an application entry point, which is the one place
 * `CONSTITUTION.md` §3.5's no-side-effects rule does not reach — so this package exports the
 * function and lets the app's own entry call it.
 *
 * @example
 * ```ts
 * // desktop/preload.ts
 * import { exposeIgnifxHost } from "@ignifx/electron/preload";
 *
 * exposeIgnifxHost();
 * ```
 *
 * @public
 */
export function exposeIgnifxHost(): void {
  contextBridge.exposeInMainWorld(HOST_GLOBAL_NAME, createIgnifxHost());
}
