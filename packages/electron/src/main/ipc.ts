import { app, dialog, ipcMain, shell } from "electron";
import { electronError, ElectronErrorCode } from "../errors.js";
import { HOST_CHANNELS, IGNIFX_ORIGIN } from "../host-contract.js";
import { originOfUrl } from "./origin.js";
import { FileStorage } from "./storage-fs.js";
import { DEFAULT_EXTERNAL_PROTOCOLS, isDevServerEntry } from "./window.js";
import type { HostOpenDialogOptions, HostPaths, HostStoredValue } from "../host-contract.js";
import type { BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions, WebContents } from "electron";

/**
 * Validate each IPC sender and payload before filesystem or shell access.
 * Only the game window's top frame on an allowed origin is trusted (`IGX-1467` otherwise).
 * Request/response handlers return failures as rejected promises.
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
 * As much of an IPC sender as the trust decision depends on.
 *
 * @remarks
 * A plain record rather than the `IpcMainInvokeEvent` itself, so {@link isTrustedSender} is pure
 * and the unit suite can state each of the three ways a sender fails without an Electron process.
 *
 * @public
 */
export interface SenderIdentity {
  /** The frame's origin, or `null` when the frame is gone or has an opaque origin. */
  readonly origin: string | null;
  /** Whether the frame is the top frame of its document tree, rather than an embedded one. */
  readonly isMainFrame: boolean;
  /** Whether the message came from the game window's own `WebContents`. */
  readonly isGameWindow: boolean;
}

/**
 * The origins a game window's document may invoke the bridge from.
 *
 * @remarks
 * A packaged build has exactly one: `ignifx://app`. A development build is loaded from the Vite dev
 * server instead, so the origin of the `entry` URL is added — the same rule `cspValueFor` uses to
 * pick the development policy, and for the same reason.
 *
 * @param entry - The `entry` given to `createGameWindow`, when the caller knows it.
 * @returns The allowed origins, sorted, with no duplicates.
 *
 * @example
 * ```ts
 * allowedSenderOrigins();                          // ["ignifx://app"]
 * allowedSenderOrigins("http://localhost:5173/");  // ["http://localhost:5173", "ignifx://app"]
 * ```
 *
 * @public
 */
export function allowedSenderOrigins(entry?: string): readonly string[] {
  if (entry === undefined || !isDevServerEntry(entry)) {
    return Object.freeze([IGNIFX_ORIGIN]);
  }
  const development = originOfUrl(entry);
  if (development === null || development === IGNIFX_ORIGIN) {
    return Object.freeze([IGNIFX_ORIGIN]);
  }
  return Object.freeze([development, IGNIFX_ORIGIN].toSorted((left, right) => left.localeCompare(right)));
}

/**
 * Reports whether an IPC message may be acted on.
 *
 * @remarks
 * Pure, and exported so the checklist test can state every way a sender is refused. All three
 * conditions have to hold: a message from another window, from a subframe, or from an origin the
 * window was not built to load is refused even when the other two are satisfied.
 *
 * @param sender - Who sent the message.
 * @param origins - The origins the window may be loaded from, from {@link allowedSenderOrigins}.
 * @returns `true` when the message came from the game window's own top-level document.
 *
 * @example
 * ```ts
 * isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: true }, ["ignifx://app"]);
 * // true
 * ```
 *
 * @public
 */
export function isTrustedSender(sender: SenderIdentity, origins: readonly string[]): boolean {
  if (!sender.isGameWindow || !sender.isMainFrame || sender.origin === null) {
    return false;
  }
  return origins.includes(sender.origin);
}

/**
 * Reads the sender identity out of an invoke event.
 *
 * @param event - The event `ipcMain.handle` delivered.
 * @param contents - The game window's `WebContents`, captured when the handlers were installed.
 * @returns What {@link isTrustedSender} needs.
 */
function identifySender(event: IpcMainInvokeEvent, contents: WebContents): SenderIdentity {
  const frame = event.senderFrame;
  return {
    // `WebFrameMain.origin` (`electron.d.ts` 19272) is Chromium's own serialization of the frame's
    // origin, which for a `standard` scheme is the tuple `ignifx://app` — not the `"null"` that
    // Node's URL parser produces for the same URL.
    origin: frame === null ? null : frame.origin,
    isMainFrame: frame !== null && frame.parent === null,
    isGameWindow: event.sender === contents,
  };
}

/** Refuses an untrusted invoke event, or returns. */
type SenderGate = (event: IpcMainInvokeEvent, channel: string) => void;

/**
 * Builds the gate every handler runs before it reads an argument.
 *
 * @remarks
 * The window's `WebContents` is captured **here**, while the window is alive: reading
 * `window.webContents` from inside a handler would throw once the window is destroyed, and a gate
 * that throws for the wrong reason is a gate nobody can read.
 *
 * @param window - The game window.
 * @param origins - The origins its document may be loaded from.
 * @returns A function that throws `IGX-1467` for anything else.
 */
function senderGateFor(window: BrowserWindow, origins: readonly string[]): SenderGate {
  const contents = window.webContents;
  return (event: IpcMainInvokeEvent, channel: string): void => {
    const sender = identifySender(event, contents);
    if (isTrustedSender(sender, origins)) {
      return;
    }
    throw electronError(
      ElectronErrorCode.hostSenderRefused,
      `${channel} was invoked from a frame that is not the game window's own document.`,
      {
        context: { channel, origin: sender.origin ?? "unknown" },
        hint: "The ignifx host bridge is only callable from the game window's top-level document.",
      },
    );
  };
}

/**
 * Registers one guarded `ipcMain.handle`.
 *
 * @param gate - The sender check.
 * @param channel - The channel name.
 * @param handler - What to run once the sender is trusted.
 */
function handleFromGameWindow(
  gate: SenderGate,
  channel: string,
  handler: (...args: readonly unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: readonly unknown[]): unknown => {
    gate(event, channel);
    return handler(...args);
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
  /**
   * The same `entry` the window was created with, so a development build's dev-server origin is
   * accepted by the sender check as well as the packaged `ignifx://app` one.
   *
   * @defaultValue `undefined` — only `ignifx://app` may call.
   */
  readonly entry?: string;
  /**
   * The origins the game window's document may invoke from, overriding what `entry` implies.
   *
   * @defaultValue {@link allowedSenderOrigins} of `entry`.
   */
  readonly origins?: readonly string[];
}

/**
 * Installs every `ipcMain.handle` the preload bridge invokes.
 *
 * @remarks
 * Call once, after `app.whenReady()` and after the window exists. The returned function removes the
 * handlers again, which matters when a window is recreated on macOS `activate`: a second
 * `ipcMain.handle` on the same channel throws.
 *
 * @param options - The window, the store, the `openExternal` allow-list, and the entry the window
 * was created with.
 * @returns A function that removes every handler this call installed.
 *
 * @example
 * ```ts
 * const entry = process.env["ELECTRON_RENDERER_URL"] ?? "index.html";
 * const window = createGameWindow({ entry, preload });
 * const removeHandlers = installHostHandlers({ window, entry });
 * ```
 *
 * @public
 */
export function installHostHandlers(options: HostHandlerOptions): () => void {
  const { window } = options;
  const gate = senderGateFor(window, options.origins ?? allowedSenderOrigins(options.entry));
  installStorageHandlers(gate, options.storage ?? new FileStorage(app.getPath("userData")));
  installWindowHandlers(gate, window);
  installShellHandlers(gate, window, options.externalProtocols ?? DEFAULT_EXTERNAL_PROTOCOLS);
  handleFromGameWindow(gate, HOST_CHANNELS.paths, (): HostPaths => resolveHostPaths());

  return (): void => {
    for (const channel of Object.values(HOST_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}

/**
 * Installs the five `app.storage` handlers.
 *
 * @param gate - The sender check every handler runs first.
 * @param storage - The store the renderer writes through.
 */
function installStorageHandlers(gate: SenderGate, storage: FileStorage): void {
  handleFromGameWindow(gate, HOST_CHANNELS.storageGet, async (namespace: unknown, key: unknown) =>
    storage.get(requireString(namespace, "namespace"), requireString(key, "key")),
  );
  handleFromGameWindow(gate, HOST_CHANNELS.storageSet, async (namespace: unknown, key: unknown, value: unknown) =>
    storage.set(requireString(namespace, "namespace"), requireString(key, "key"), requireStoredValue(value)),
  );
  handleFromGameWindow(gate, HOST_CHANNELS.storageDelete, async (namespace: unknown, key: unknown) =>
    storage.delete(requireString(namespace, "namespace"), requireString(key, "key")),
  );
  handleFromGameWindow(gate, HOST_CHANNELS.storageKeys, async (namespace: unknown, prefix: unknown) =>
    storage.keys(
      requireString(namespace, "namespace"),
      ...(typeof prefix === "string" ? ([prefix] as const) : ([] as const)),
    ),
  );
  handleFromGameWindow(gate, HOST_CHANNELS.storageClear, async (namespace: unknown) =>
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
 * @param gate - The sender check every handler runs first.
 * @param window - The game window.
 */
function installWindowHandlers(gate: SenderGate, window: BrowserWindow): void {
  handleFromGameWindow(gate, HOST_CHANNELS.windowSetFullscreen, (fullscreen: unknown): void => {
    if (!window.isDestroyed()) {
      window.setFullScreen(fullscreen === true);
    }
  });
  handleFromGameWindow(
    gate,
    HOST_CHANNELS.windowIsFullscreen,
    (): boolean => !window.isDestroyed() && window.isFullScreen(),
  );
  handleFromGameWindow(gate, HOST_CHANNELS.windowSetTitle, (title: unknown): void => {
    if (!window.isDestroyed()) {
      window.setTitle(requireString(title, "title"));
    }
  });
  handleFromGameWindow(gate, HOST_CHANNELS.windowQuit, (): void => {
    app.quit();
  });
}

/**
 * Installs the open dialog and the `openExternal` gate.
 *
 * @param gate - The sender check every handler runs first.
 * @param window - The window the dialog is modal over.
 * @param protocols - The `openExternal` allow-list.
 */
function installShellHandlers(gate: SenderGate, window: BrowserWindow, protocols: readonly string[]): void {
  handleFromGameWindow(gate, HOST_CHANNELS.dialogsShowOpen, async (raw: unknown) => {
    const request = isRecord(raw) ? raw : {};
    const result = await dialog.showOpenDialog(window, openDialogOptionsFor(request));
    return { canceled: result.canceled, paths: result.filePaths };
  });

  handleFromGameWindow(gate, HOST_CHANNELS.shellOpenExternal, async (url: unknown): Promise<void> => {
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
