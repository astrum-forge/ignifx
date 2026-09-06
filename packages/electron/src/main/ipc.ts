import { app, dialog, ipcMain, shell } from "electron";
import { electronError, ElectronErrorCode } from "../errors.js";
import { HOST_CHANNELS } from "../host-contract.js";
import { FileStorage } from "./storage-fs.js";
import { DEFAULT_EXTERNAL_PROTOCOLS } from "./window.js";
import type { HostOpenDialogOptions, HostPaths, HostStoredValue } from "../host-contract.js";
import type { BrowserWindow, OpenDialogOptions } from "electron";

/**
 * The main-process ends of the preload bridge
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * Every handler is `ipcMain.handle` (`electron.d.ts` 8993) — request/response, never a fire-and-
 * forget `on`. That is what makes the renderer side a promise-returning method rather than a
 * message pump, and what makes a failure in the main process reach the game as a rejection instead
 * of as silence.
 *
 * Nothing here trusts its arguments. The renderer is sandboxed and context-isolated, but a renderer
 * is still the process an attacker reaches first, so each handler re-validates the shapes it was
 * given before touching the file system or the shell.
 */

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
 * Narrows an unknown IPC argument to a string.
 *
 * @param value - The argument.
 * @param what - The parameter's name, for the failure message.
 * @returns The string.
 * @throws An `IgnifxError` with code `IGX-1463` when it is not one.
 */
function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw electronError(ElectronErrorCode.hostCallFailed, `${what} must be a string.`, {
      context: { channel: what },
    });
  }
  return value;
}

/**
 * Narrows an unknown IPC argument to a stored value.
 *
 * @param value - The argument.
 * @returns The stored value.
 * @throws An `IgnifxError` with code `IGX-1463` when it is not one.
 */
function requireStoredValue(value: unknown): HostStoredValue {
  if (isRecord(value)) {
    const json: unknown = value["json"];
    const bytes: unknown = value["bytes"];
    if (value["kind"] === "json" && typeof json === "string") {
      return { kind: "json", json };
    }
    if (value["kind"] === "bytes" && bytes instanceof Uint8Array) {
      return { kind: "bytes", bytes };
    }
  }
  throw electronError(ElectronErrorCode.hostCallFailed, "The value is neither JSON text nor bytes.", {
    context: { channel: HOST_CHANNELS.storageSet },
  });
}

/**
 * Reports whether a URL may be handed to the OS shell.
 *
 * @remarks
 * Pure, and exported so the unit suite can assert the allow-list without a shell. The check is on
 * the parsed protocol, not on a prefix match: `https:/\/evil` and `javascript:` both fail here, and
 * a URL that does not parse at all fails too.
 *
 * @param url - The URL the renderer asked to open.
 * @param protocols - The allow-list, for example `["https:", "mailto:"]`.
 * @returns `true` when the URL parses and its protocol is on the list.
 *
 * @example
 * ```ts
 * isAllowedExternalUrl("https://ignifx.com", DEFAULT_EXTERNAL_PROTOCOLS); // true
 * isAllowedExternalUrl("file:///etc/passwd", DEFAULT_EXTERNAL_PROTOCOLS); // false
 * ```
 *
 * @public
 */
export function isAllowedExternalUrl(url: string, protocols: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return protocols.includes(parsed.protocol);
}

/**
 * Maps the bridge's open-dialog options onto Electron's.
 *
 * @remarks
 * Pure, and the reason the contract's options are booleans rather than Electron's `properties`
 * array: a renderer that could pass `properties` straight through could pass
 * `"promptToCreate"` or `"showHiddenFiles"`, neither of which a game window has any business
 * turning on by itself.
 *
 * @param options - What the game asked for.
 * @returns Electron's `OpenDialogOptions` (`electron.d.ts` 23045).
 *
 * @example
 * ```ts
 * openDialogOptionsFor({ directories: true, multiple: true }).properties;
 * // ["openDirectory", "multiSelections"]
 * ```
 *
 * @public
 */
export function openDialogOptionsFor(options: HostOpenDialogOptions = {}): OpenDialogOptions {
  const properties: ("openFile" | "openDirectory" | "multiSelections")[] = [];
  const directories = options.directories ?? false;
  // `files` defaults to true, but a dialog with neither `openFile` nor `openDirectory` opens
  // nothing at all, so asking for directories only is what turns files off.
  if (options.files ?? !directories) {
    properties.push("openFile");
  }
  if (directories) {
    properties.push("openDirectory");
  }
  if (options.multiple === true) {
    properties.push("multiSelections");
  }
  return {
    properties,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.defaultPath === undefined ? {} : { defaultPath: options.defaultPath }),
    ...(options.buttonLabel === undefined ? {} : { buttonLabel: options.buttonLabel }),
    ...(options.filters === undefined
      ? {}
      : {
          filters: options.filters.map((filter) => ({
            name: filter.name,
            extensions: [...filter.extensions],
          })),
        }),
  };
}

/**
 * Reads a path the platform may not have.
 *
 * @param name - The `app.getPath` name.
 * @returns The directory, or `""` when the platform has none.
 */
function optionalPath(name: "downloads" | "documents"): string {
  try {
    return app.getPath(name);
  } catch {
    return "";
  }
}

/**
 * Resolves the platform directories the bridge reports.
 *
 * @remarks
 * `app.getPath` (`electron.d.ts` 1301) throws for a name the platform has none of — `downloads` and
 * `documents` on a bare Linux container, for instance — so each optional one is read defensively and
 * reported as `""`.
 *
 * @returns The directories.
 *
 * @example
 * ```ts
 * const { userData } = resolveHostPaths();
 * ```
 *
 * @public
 */
export function resolveHostPaths(): HostPaths {
  return {
    userData: app.getPath("userData"),
    appData: app.getPath("appData"),
    temp: app.getPath("temp"),
    home: app.getPath("home"),
    downloads: optionalPath("downloads"),
    documents: optionalPath("documents"),
    appPath: app.getAppPath(),
  };
}

/**
 * What {@link installHostHandlers} accepts.
 *
 * @public
 */
export interface HostHandlerOptions {
  /**
   * The game window the window controls and the dialogs act on.
   *
   * @remarks
   * Captured rather than derived from the IPC event's sender, so a handler cannot be talked into
   * acting on some other window.
   */
  readonly window: BrowserWindow;
  /**
   * Where `app.storage` writes.
   *
   * @defaultValue a {@link FileStorage} rooted at `app.getPath("userData")`.
   */
  readonly storage?: FileStorage;
  /**
   * Protocols `shell.openExternal` may hand to the OS.
   *
   * @defaultValue `DEFAULT_EXTERNAL_PROTOCOLS`
   */
  readonly externalProtocols?: readonly string[];
}

/**
 * Installs every `ipcMain.handle` the preload bridge invokes.
 *
 * @remarks
 * Call once, after `app.whenReady()` and after the window exists. The returned function removes the
 * handlers again, which matters when a window is recreated on macOS `activate`: a second
 * `ipcMain.handle` on the same channel throws.
 *
 * @param options - The window, the store, and the `openExternal` allow-list.
 * @returns A function that removes every handler this call installed.
 *
 * @example
 * ```ts
 * const window = createGameWindow({ entry: "index.html", preload });
 * const removeHandlers = installHostHandlers({ window });
 * ```
 *
 * @public
 */
export function installHostHandlers(options: HostHandlerOptions): () => void {
  const { window } = options;
  installStorageHandlers(options.storage ?? new FileStorage(app.getPath("userData")));
  installWindowHandlers(window);
  installShellHandlers(window, options.externalProtocols ?? DEFAULT_EXTERNAL_PROTOCOLS);
  ipcMain.handle(HOST_CHANNELS.paths, (): HostPaths => resolveHostPaths());

  return (): void => {
    for (const channel of Object.values(HOST_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}

/**
 * Installs the five `app.storage` handlers.
 *
 * @param storage - The store the renderer writes through.
 */
function installStorageHandlers(storage: FileStorage): void {
  ipcMain.handle(HOST_CHANNELS.storageGet, async (_event, namespace: unknown, key: unknown) =>
    storage.get(requireString(namespace, "namespace"), requireString(key, "key")),
  );
  ipcMain.handle(HOST_CHANNELS.storageSet, async (_event, namespace: unknown, key: unknown, value: unknown) =>
    storage.set(requireString(namespace, "namespace"), requireString(key, "key"), requireStoredValue(value)),
  );
  ipcMain.handle(HOST_CHANNELS.storageDelete, async (_event, namespace: unknown, key: unknown) =>
    storage.delete(requireString(namespace, "namespace"), requireString(key, "key")),
  );
  ipcMain.handle(HOST_CHANNELS.storageKeys, async (_event, namespace: unknown, prefix: unknown) =>
    storage.keys(
      requireString(namespace, "namespace"),
      ...(typeof prefix === "string" ? ([prefix] as const) : ([] as const)),
    ),
  );
  ipcMain.handle(HOST_CHANNELS.storageClear, async (_event, namespace: unknown) =>
    storage.clear(requireString(namespace, "namespace")),
  );
}

/**
 * Installs the four window-control handlers.
 *
 * @remarks
 * The window is captured rather than derived from the IPC event's sender, so a handler cannot be
 * talked into acting on some other window.
 *
 * @param window - The game window.
 */
function installWindowHandlers(window: BrowserWindow): void {
  ipcMain.handle(HOST_CHANNELS.windowSetFullscreen, (_event, fullscreen: unknown): void => {
    if (!window.isDestroyed()) {
      window.setFullScreen(fullscreen === true);
    }
  });
  ipcMain.handle(HOST_CHANNELS.windowIsFullscreen, (): boolean => !window.isDestroyed() && window.isFullScreen());
  ipcMain.handle(HOST_CHANNELS.windowSetTitle, (_event, title: unknown): void => {
    if (!window.isDestroyed()) {
      window.setTitle(requireString(title, "title"));
    }
  });
  ipcMain.handle(HOST_CHANNELS.windowQuit, (): void => {
    app.quit();
  });
}

/**
 * Installs the open dialog and the `openExternal` gate.
 *
 * @param window - The window the dialog is modal over.
 * @param protocols - The `openExternal` allow-list.
 */
function installShellHandlers(window: BrowserWindow, protocols: readonly string[]): void {
  ipcMain.handle(HOST_CHANNELS.dialogsShowOpen, async (_event, raw: unknown) => {
    const request = isRecord(raw) ? raw : {};
    const result = await dialog.showOpenDialog(window, openDialogOptionsFor(request));
    return { canceled: result.canceled, paths: result.filePaths };
  });

  ipcMain.handle(HOST_CHANNELS.shellOpenExternal, async (_event, url: unknown): Promise<void> => {
    const text = requireString(url, "url");
    if (!isAllowedExternalUrl(text, protocols)) {
      throw electronError(ElectronErrorCode.externalUrlRefused, `${text} does not use an allowed protocol.`, {
        context: { url: text, allowed: protocols.join(" ") },
        hint: `Allowed protocols are ${protocols.join(", ")}.`,
      });
    }
    await shell.openExternal(text);
  });
}
