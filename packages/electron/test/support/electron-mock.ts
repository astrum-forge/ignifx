import { vi } from "vitest";

/**
 * The `electron` module a Node unit test gets.
 *
 * The real one cannot be imported here at all: `electron`'s `main` field is a CommonJS shim whose
 * only export is the **path of the Electron binary**, so `import { protocol } from "electron"` is a
 * missing-export failure rather than a stub. Every test that touches `src/main/**` or
 * `src/preload/**` therefore mocks the module, and this file is the one recording implementation
 * they share.
 *
 * The mock is deliberately dumb: it records calls and replays queued answers. What it is *not* is a
 * second implementation of Electron — anything whose behaviour depends on Chromium is proved in
 * `tests/visual/tests/desktop.spec.ts` against a real Electron process instead.
 */

/** One recorded call: the member invoked and the arguments it was given. */
export interface RecordedCall {
  /** The member's name, for example `"ipcMain.handle"`. */
  readonly member: string;
  /** The arguments, as given. */
  readonly args: readonly unknown[];
}

/** A handler registered through the fake `ipcMain.handle`. */
export type FakeHandler = (event: unknown, ...args: readonly unknown[]) => unknown;

/**
 * The fake Electron surface, plus the recordings a test asserts against.
 *
 * @public
 */
export interface ElectronMock {
  /** Every call, in order. */
  readonly calls: RecordedCall[];
  /** The `ipcMain.handle` registrations, by channel. */
  readonly handlers: Map<string, FakeHandler>;
  /** The switches `app.commandLine.appendSwitch` was given, as `name` or `name=value`. */
  readonly switches: string[];
  /** What `app.getPath` answers, by name. */
  readonly paths: Map<string, string>;
  /** Names `app.getPath` throws for, the way a platform without that directory does. */
  readonly missingPaths: Set<string>;
  /** What the next `dialog.showOpenDialog` resolves to. */
  openDialogResult: { canceled: boolean; filePaths: string[] };
  /** URLs `shell.openExternal` was given. */
  readonly opened: string[];
  /** Whether `app.quit` was called. */
  quitCalled: boolean;
}

/**
 * Builds the recordings object a fresh mock starts from.
 *
 * @returns The empty state.
 */
export function createElectronMockState(): ElectronMock {
  return {
    calls: [],
    handlers: new Map<string, FakeHandler>(),
    switches: [],
    paths: new Map<string, string>([
      ["userData", "/tmp/ignifx-test/userData"],
      ["appData", "/tmp/ignifx-test/appData"],
      ["temp", "/tmp"],
      ["home", "/tmp/ignifx-test/home"],
      ["downloads", "/tmp/ignifx-test/Downloads"],
      ["documents", "/tmp/ignifx-test/Documents"],
    ]),
    missingPaths: new Set<string>(),
    openDialogResult: { canceled: true, filePaths: [] },
    opened: [],
    quitCalled: false,
  };
}

/** The shared state every mocked member reads and writes. */
export const electronMock: ElectronMock = createElectronMockState();

/**
 * Resets the shared state between tests.
 */
export function resetElectronMock(): void {
  electronMock.calls.length = 0;
  electronMock.handlers.clear();
  electronMock.switches.length = 0;
  electronMock.missingPaths.clear();
  electronMock.opened.length = 0;
  electronMock.openDialogResult = { canceled: true, filePaths: [] };
  electronMock.quitCalled = false;
}

/**
 * Records one call.
 *
 * @param member - The member's name.
 * @param args - The arguments.
 */
function record(member: string, ...args: readonly unknown[]): void {
  electronMock.calls.push({ member, args });
}

/**
 * A `Session` stand-in: records the header filter, the permission handlers, and lets a test replay
 * a response through them.
 *
 * @public
 */
export class FakeSession {
  /** The listener `installCspHeader` registered, or `null`. */
  headersListener:
    | ((
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
      ) => void)
    | null = null;

  /** The handler `restrictPermissions` registered for prompts, or `null`. */
  permissionRequestHandler:
    | ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void)
    | null = null;

  /** The handler `restrictPermissions` registered for silent checks, or `null`. */
  permissionCheckHandler: ((contents: unknown, permission: string) => boolean) | null = null;

  /** The `webRequest` surface `installCspHeader` reaches. */
  readonly webRequest = {
    onHeadersReceived: (listener: FakeSession["headersListener"]): void => {
      this.headersListener = listener;
    },
  };

  /**
   * Records the prompt handler.
   *
   * @param handler - The handler.
   */
  setPermissionRequestHandler(
    handler: ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null,
  ): void {
    this.permissionRequestHandler = handler;
  }

  /**
   * Records the silent-check handler.
   *
   * @param handler - The handler.
   */
  setPermissionCheckHandler(handler: ((contents: unknown, permission: string) => boolean) | null): void {
    this.permissionCheckHandler = handler;
  }

  /**
   * Replays one response through the header filter.
   *
   * @param responseHeaders - The headers the response carried.
   * @returns The headers the filter produced.
   */
  filterHeaders(responseHeaders: Record<string, string[]>): Record<string, string[]> {
    let produced: Record<string, string[]> = {};
    this.headersListener?.({ responseHeaders }, (response) => {
      produced = response.responseHeaders ?? {};
    });
    return produced;
  }

  /**
   * Asks the prompt handler about one permission.
   *
   * @param permission - The permission name.
   * @returns Whether it was granted.
   */
  askPermission(permission: string): boolean {
    let granted = false;
    this.permissionRequestHandler?.(null, permission, (value) => {
      granted = value;
    });
    return granted;
  }
}

/**
 * A minimal `BrowserWindow` stand-in for the window-control handlers.
 *
 * @public
 */
export class FakeBrowserWindow {
  /** Whether the window has been destroyed. */
  destroyed = false;

  /** Whether the window is full screen. */
  fullscreen = false;

  /** The window's title. */
  title = "ignifx";

  /** The events `forwardWindowEvents` subscribed to, by name. */
  readonly listeners = new Map<string, (() => void)[]>();

  /** What `webContents.send` was given, in order. */
  readonly sent: { channel: string; payload: unknown }[] = [];

  /** The options the constructor was given, when it was built through `new BrowserWindow(...)`. */
  readonly options: unknown;

  /** Whether `show()` was called. */
  shown = false;

  /** URLs `loadURL` was given. */
  readonly loaded: string[] = [];

  /** The handler `lockNavigation` installed for `window.open`, or `null`. */
  windowOpenHandler: (() => { readonly action: string }) | null = null;

  /** The `will-navigate` listeners `lockNavigation` installed. */
  readonly navigationListeners: ((event: { preventDefault: () => void }, url: string) => void)[] = [];

  /** The window's session. */
  readonly session = new FakeSession();

  /** The stand-in `webContents`. */
  readonly webContents = {
    isDestroyed: (): boolean => this.destroyed,
    send: (channel: string, payload: unknown): void => {
      this.sent.push({ channel, payload });
    },
    session: this.session,
    setWindowOpenHandler: (handler: () => { readonly action: string }): void => {
      this.windowOpenHandler = handler;
    },
    on: (event: string, listener: (event: { preventDefault: () => void }, url: string) => void): void => {
      if (event === "will-navigate") {
        this.navigationListeners.push(listener);
      }
    },
  };

  /**
   * Records the constructor options.
   *
   * @param options - What `windowOptionsFor` produced.
   */
  constructor(options?: unknown) {
    this.options = options;
  }

  /**
   * Records a load.
   *
   * @param url - The URL.
   * @returns A resolved promise, the way Electron's does.
   */
  async loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    return Promise.resolve();
  }

  /** Records that the window was shown. */
  show(): void {
    this.shown = true;
  }

  /**
   * Subscribes to a one-shot window event.
   *
   * @param event - The event name.
   * @param listener - The listener.
   */
  once(event: string, listener: () => void): void {
    this.on(event, listener);
  }

  /**
   * Asks whether a navigation to a URL would be allowed.
   *
   * @param url - The URL being navigated to.
   * @returns `true` when no listener called `preventDefault`.
   */
  wouldAllowNavigation(url: string): boolean {
    let prevented = false;
    for (const listener of this.navigationListeners) {
      listener(
        {
          preventDefault: (): void => {
            prevented = true;
          },
        },
        url,
      );
    }
    return !prevented;
  }

  /**
   * Subscribes to a window event.
   *
   * @param event - The event name.
   * @param listener - The listener.
   */
  on(event: string, listener: () => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  /**
   * Fires every listener registered for an event.
   *
   * @param event - The event name.
   */
  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  /**
   * Reports whether the window has been destroyed.
   *
   * @returns `true` when it has.
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Reports whether the window is full screen.
   *
   * @returns `true` when it is.
   */
  isFullScreen(): boolean {
    return this.fullscreen;
  }

  /**
   * Enters or leaves full screen.
   *
   * @param value - `true` to enter.
   */
  setFullScreen(value: boolean): void {
    this.fullscreen = value;
  }

  /**
   * Sets the title.
   *
   * @param value - The new title.
   */
  setTitle(value: string): void {
    this.title = value;
  }
}

// Registering the mock is a module-level statement rather than something a test calls: Vitest
// hoists `vi.mock` to the top of the module it appears in and refuses one written inside a
// function. A test file therefore imports this module **first**, before anything that reaches
// `electron`, and the registration is in place by the time `src/main/**` is evaluated.
vi.mock("electron", () => ({
  app: {
    commandLine: {
      appendSwitch: (name: string, value?: string): void => {
        electronMock.switches.push(value === undefined ? name : `${name}=${value}`);
      },
    },
    getPath: (name: string): string => {
      if (electronMock.missingPaths.has(name)) {
        throw new Error(`no such path: ${name}`);
      }
      return electronMock.paths.get(name) ?? "";
    },
    getAppPath: (): string => "/tmp/ignifx-test/app",
    quit: (): void => {
      electronMock.quitCalled = true;
    },
    whenReady: async (): Promise<void> => Promise.resolve(),
  },
  BrowserWindow: FakeBrowserWindow,
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown): void => {
      record("contextBridge.exposeInMainWorld", key, api);
    },
  },
  dialog: {
    showOpenDialog: async (window: unknown, options: unknown): Promise<unknown> => {
      record("dialog.showOpenDialog", window, options);
      return Promise.resolve(electronMock.openDialogResult);
    },
  },
  ipcMain: {
    handle: (channel: string, handler: FakeHandler): void => {
      electronMock.handlers.set(channel, handler);
    },
    removeHandler: (channel: string): void => {
      electronMock.handlers.delete(channel);
    },
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: readonly unknown[]): Promise<unknown> => {
      record("ipcRenderer.invoke", channel, ...args);
      return Promise.resolve(null);
    },
    on: (channel: string, listener: unknown): void => {
      record("ipcRenderer.on", channel, listener);
    },
    removeListener: (channel: string, listener: unknown): void => {
      record("ipcRenderer.removeListener", channel, listener);
    },
  },
  protocol: {
    registerSchemesAsPrivileged: (schemes: unknown): void => {
      record("protocol.registerSchemesAsPrivileged", schemes);
    },
    handle: (scheme: string, handler: unknown): void => {
      record("protocol.handle", scheme, handler);
    },
    unhandle: (scheme: string): void => {
      record("protocol.unhandle", scheme);
    },
  },
  shell: {
    openExternal: async (url: string): Promise<void> => {
      electronMock.opened.push(url);
      return Promise.resolve();
    },
  },
}));
