import { BrowserWindow } from "electron";
import { HOST_WINDOW_EVENT_CHANNEL } from "../host-contract.js";
import { cspFor } from "./csp.js";
import { packagedEntryUrl } from "./protocol.js";
import type { CspOptions } from "./csp.js";
import type { HostWindowEvent } from "../host-contract.js";
import type { BrowserWindowConstructorOptions, Session, WebContents } from "electron";

/**
 * The game window (`docs/architecture/14-platform-electron.md` §3, `CONSTITUTION.md` §9.2).
 *
 * The four `webPreferences` values §9.2 fixes — `contextIsolation: true`, `sandbox: true`,
 * `nodeIntegration: false`, `webSecurity: true` — are not options. {@link windowOptionsFor} writes
 * them last, after the caller's own object has been spread, so a caller cannot weaken them by
 * accident; deviating requires an ADR, which means editing this file rather than passing a flag.
 *
 * ## The sandbox decides the preload script's module format
 *
 * A sandboxed preload script **cannot be an ES module**. Measured on Electron 44.2.0 / macOS arm64
 * (S9.1): with `sandbox: true` and a `preload.mjs` containing
 * `import { contextBridge } from "electron"`, the renderer saw `window.ignifxHost === undefined`
 * and no error surfaced; the byte-identical script as CommonJS `preload.cjs` exposed the bridge.
 * `docs/architecture/14-platform-electron.md` §3 calls the preload `.mjs`, and that sentence is
 * wrong for a sandboxed window — the templates build `desktop/preload.ts` to CommonJS.
 */

/**
 * The protocols {@link createGameWindow} lets `shell.openExternal` hand to the OS.
 *
 * @remarks
 * An allow-list, not a deny-list: `file:`, `javascript:`, and every custom protocol some other
 * installed application registered are all things an `openExternal` call must never reach.
 *
 * @public
 */
export const DEFAULT_EXTERNAL_PROTOCOLS: readonly string[] = Object.freeze(["https:", "mailto:"]);

/**
 * The window size a template opens at when it asks for none.
 *
 * @public
 */
export const DEFAULT_WINDOW_SIZE: Readonly<{ readonly width: number; readonly height: number }> = Object.freeze({
  width: 1280,
  height: 720,
});

/**
 * What {@link createGameWindow} and {@link windowOptionsFor} accept.
 *
 * @public
 */
export interface GameWindowOptions {
  /**
   * What the window loads.
   *
   * @remarks
   * A bare document name such as `"index.html"` is served over `ignifx://app`, which is what a
   * packaged build wants. An absolute `http://` or `https://` URL is loaded as given, which is what
   * `electron-vite dev` needs while the renderer lives on a dev server.
   */
  readonly entry: string;
  /** Absolute path of the preload script. Must be CommonJS — see the module comment. */
  readonly preload: string;
  /**
   * Window width in logical pixels.
   *
   * @defaultValue `1280`
   */
  readonly width?: number;
  /**
   * Window height in logical pixels.
   *
   * @defaultValue `720`
   */
  readonly height?: number;
  /**
   * Smallest width the user may drag to.
   *
   * @defaultValue `640`
   */
  readonly minWidth?: number;
  /**
   * Smallest height the user may drag to.
   *
   * @defaultValue `360`
   */
  readonly minHeight?: number;
  /**
   * Whether the window opens full screen.
   *
   * @defaultValue `false`
   */
  readonly fullscreen?: boolean;
  /**
   * Whether the window has the platform's frame and title bar.
   *
   * @defaultValue `true`
   */
  readonly frame?: boolean;
  /**
   * The window title.
   *
   * @defaultValue `"ignifx"`
   */
  readonly title?: string;
  /** Absolute path of the window icon, where the platform uses one. */
  readonly icon?: string;
  /**
   * The colour painted before the first frame, which is what the user sees instead of a white
   * flash.
   *
   * @defaultValue `"#000000"`
   */
  readonly backgroundColor?: string;
  /**
   * Whether WebGPU is expected. Only documentation today: the switch that turns WebGPU on is a
   * process-wide command-line switch applied by `applyWebGpuSwitches` before `app.whenReady()`,
   * not a per-window preference.
   *
   * @defaultValue `true`
   */
  readonly webgpu?: boolean;
  /**
   * Whether the window is shown immediately.
   *
   * @defaultValue `false` — {@link createGameWindow} shows it on `ready-to-show`, which is what
   * removes the blank-window flash.
   */
  readonly show?: boolean;
  /**
   * The Content-Security-Policy header value, or the options to build one from, or `null` to inject
   * none (for a host that already sends its own).
   *
   * @defaultValue the policy `cspFor()` builds, in development mode when `entry` is an `http(s):`
   * URL.
   */
  readonly csp?: string | CspOptions | null;
  /**
   * Protocols `shell.openExternal` may hand to the OS.
   *
   * @defaultValue {@link DEFAULT_EXTERNAL_PROTOCOLS}
   */
  readonly externalProtocols?: readonly string[];
}

/**
 * The `webPreferences` every ignifx game window is built with, whatever the caller asked for
 * (`CONSTITUTION.md` §9.2).
 *
 * @remarks
 * Exported as data so the security checklist can assert the values without constructing a window.
 *
 * @public
 */
export const ENFORCED_WEB_PREFERENCES: Readonly<{
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webSecurity: true;
  readonly allowRunningInsecureContent: false;
  readonly experimentalFeatures: false;
  readonly webviewTag: false;
  readonly spellcheck: false;
}> = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
});

/**
 * Reports whether an entry is a dev-server URL rather than a packaged document.
 *
 * @param entry - The `entry` option.
 * @returns `true` for an `http:` or `https:` URL.
 *
 * @example
 * ```ts
 * isDevServerEntry("http://localhost:5173/"); // true
 * isDevServerEntry("index.html"); // false
 * ```
 *
 * @public
 */
export function isDevServerEntry(entry: string): boolean {
  return entry.startsWith("http://") || entry.startsWith("https://");
}

/**
 * Builds the `BrowserWindow` constructor options for a game window.
 *
 * @remarks
 * Pure, and exported for exactly that reason: the security checklist test (`test/security.test.ts`)
 * asserts the whole `webPreferences` object against {@link ENFORCED_WEB_PREFERENCES} without
 * launching Electron, so the invariant is checked on every `pnpm test` rather than only on a
 * machine with a display.
 *
 * @param options - What the game asked for.
 * @returns The constructor options, with `CONSTITUTION.md` §9.2's preferences forced on.
 *
 * @example
 * ```ts
 * const options = windowOptionsFor({ entry: "index.html", preload: "/app/preload.cjs" });
 * options.webPreferences?.sandbox; // true
 * ```
 *
 * @public
 */
export function windowOptionsFor(options: GameWindowOptions): BrowserWindowConstructorOptions {
  return {
    width: options.width ?? DEFAULT_WINDOW_SIZE.width,
    height: options.height ?? DEFAULT_WINDOW_SIZE.height,
    minWidth: options.minWidth ?? 640,
    minHeight: options.minHeight ?? 360,
    fullscreen: options.fullscreen ?? false,
    frame: options.frame ?? true,
    title: options.title ?? "ignifx",
    backgroundColor: options.backgroundColor ?? "#000000",
    show: options.show ?? false,
    // A game canvas is resized by the renderer on its own schedule; letting Chromium paint a
    // stretched bitmap during a live drag is worse than a frame of letterbox.
    useContentSize: true,
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    webPreferences: {
      preload: options.preload,
      // Spread last: nothing above can weaken what §9.2 fixes.
      ...ENFORCED_WEB_PREFERENCES,
      // Chromium throttles timers and rAF in an occluded window, which stops a game's fixed step
      // dead rather than pausing it cleanly. ignifx pauses through `onApplicationPause` instead.
      backgroundThrottling: false,
    },
  };
}

/**
 * Resolves the Content-Security-Policy header value for a set of options.
 *
 * @param options - What the game asked for.
 * @returns The header value, or `null` when the caller asked for no header.
 *
 * @example
 * ```ts
 * cspValueFor({ entry: "http://localhost:5173/", preload: "/p.cjs" });
 * // …a development policy that also allows http://localhost:5173 and ws://localhost:5173
 * ```
 *
 * @public
 */
export function cspValueFor(options: GameWindowOptions): string | null {
  const { csp } = options;
  if (csp === null) {
    return null;
  }
  if (typeof csp === "string") {
    return csp;
  }
  if (csp !== undefined) {
    return cspFor(csp);
  }
  if (isDevServerEntry(options.entry)) {
    return cspFor({ mode: "development", devServerOrigin: new URL(options.entry).origin });
  }
  return cspFor();
}

/**
 * Injects a Content-Security-Policy response header into every response a session serves.
 *
 * @remarks
 * `session.webRequest.onHeadersReceived` (`electron.d.ts` 19657) is the documented hook. The
 * listener replaces any policy the response already carried rather than appending one, because two
 * `Content-Security-Policy` headers intersect and the result is whichever is stricter — which makes
 * the effective policy something no single file states.
 *
 * @param session - The session to filter, normally the window's own.
 * @param csp - The header value to inject.
 *
 * @example
 * ```ts
 * installCspHeader(window.webContents.session, cspFor());
 * ```
 *
 * @public
 */
export function installCspHeader(session: Session, csp: string): void {
  session.webRequest.onHeadersReceived((details, callback): void => {
    const headers: Record<string, string[]> = {};
    const received = details.responseHeaders ?? {};
    for (const name of Object.keys(received)) {
      if (name.toLowerCase() === "content-security-policy") {
        continue;
      }
      headers[name] = received[name] ?? [];
    }
    headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
}

/**
 * The `BrowserWindow` events forwarded to the renderer. Electron's own event names and the
 * contract's are deliberately the same string.
 *
 * @remarks
 * `restore` is Electron's name for "came back from minimised"; the contract keeps it. The
 * full-screen pair carries the platform's own full-screen gesture, which `app.desktop.setFullscreen`
 * would otherwise be the only source of.
 *
 * @public
 */
export const FORWARDED_WINDOW_EVENTS: readonly HostWindowEvent[] = Object.freeze([
  "minimize",
  "restore",
  "focus",
  "blur",
  "enter-full-screen",
  "leave-full-screen",
]);

/**
 * Forwards a window's lifecycle events to its renderer over {@link HOST_WINDOW_EVENT_CHANNEL}.
 *
 * @param window - The window to watch.
 *
 * @example
 * ```ts
 * forwardWindowEvents(window);
 * ```
 *
 * @public
 */
export function forwardWindowEvents(window: BrowserWindow): void {
  // One closure per window per event, installed once at window creation: this is not a per-frame
  // path (coding standards §7). The six `on` calls are written out rather than looped, because
  // Electron types each event name as its own overload and a loop would need an assertion.
  const send = (event: HostWindowEvent): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(HOST_WINDOW_EVENT_CHANNEL, event);
  };
  window.on("minimize", (): void => {
    send("minimize");
  });
  window.on("restore", (): void => {
    send("restore");
  });
  window.on("focus", (): void => {
    send("focus");
  });
  window.on("blur", (): void => {
    send("blur");
  });
  window.on("enter-full-screen", (): void => {
    send("enter-full-screen");
  });
  window.on("leave-full-screen", (): void => {
    send("leave-full-screen");
  });
}

/**
 * Refuses every navigation and every new window a page tries to open.
 *
 * @remarks
 * A packaged game navigates nowhere: its only document is the one it was loaded with, and anything
 * that tries to replace it — a stray `<a href>`, a `window.open`, an injected script — is a bug at
 * best. Outbound links go through `app.desktop.openExternal`, which checks the protocol against an
 * allow-list and hands the URL to the OS browser instead of loading it in the game window.
 *
 * @param contents - The window's web contents.
 * @param allowedOrigin - The one origin a navigation may stay on; anything else is blocked.
 *
 * @example
 * ```ts
 * lockNavigation(window.webContents, "ignifx://app");
 * ```
 *
 * @public
 */
export function lockNavigation(contents: WebContents, allowedOrigin: string): void {
  contents.setWindowOpenHandler((): { readonly action: "deny" } => ({ action: "deny" }));
  contents.on("will-navigate", (event, url: string): void => {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (origin !== allowedOrigin) {
      event.preventDefault();
    }
  });
}

/**
 * The permissions a game window is allowed to ask Chromium for.
 *
 * @remarks
 * Pointer lock and full screen are the two a game genuinely needs; measured on Electron 44.2.0
 * (S9.1), `document.body.requestPointerLock` is present in a sandboxed `ignifx://` window and
 * `navigator.getGamepads()` returns its four slots without any permission at all. Everything else —
 * the camera, the microphone, geolocation, USB, HID, serial, notifications — is denied, because a
 * game that has not asked for them has no business being able to prompt for them.
 *
 * @public
 */
export const ALLOWED_PERMISSIONS: readonly string[] = Object.freeze([
  "pointerLock",
  "fullscreen",
  "automatic-fullscreen",
]);

/**
 * Denies every permission a game window has no business asking for.
 *
 * @param session - The window's session.
 * @param allowed - The permissions to grant; defaults to {@link ALLOWED_PERMISSIONS}.
 *
 * @example
 * ```ts
 * restrictPermissions(window.webContents.session);
 * ```
 *
 * @public
 */
export function restrictPermissions(session: Session, allowed: readonly string[] = ALLOWED_PERMISSIONS): void {
  session.setPermissionRequestHandler((_contents, permission, callback): void => {
    callback(allowed.includes(permission));
  });
  session.setPermissionCheckHandler((_contents, permission): boolean => allowed.includes(permission));
}

/**
 * Creates the game window: WebGPU-ready, sandboxed, context-isolated, served a strict CSP, with its
 * lifecycle events forwarded to the renderer.
 *
 * @remarks
 * The window is created hidden and shown on `ready-to-show` unless `show: true` was passed, which
 * is what keeps a user from watching an empty rectangle while the first scene loads.
 *
 * `applyWebGpuSwitches()` and `registerIgnifxScheme()` must already have run, and `app.whenReady()`
 * must already have resolved; both are ordering constraints of Chromium's own initialisation rather
 * than of this function.
 *
 * @param options - What the game asked for.
 * @returns The window, with its first load already started.
 *
 * @example
 * ```ts
 * const window = createGameWindow({
 *   entry: "index.html",
 *   preload: join(import.meta.dirname, "../preload/index.cjs"),
 *   width: 1600,
 *   height: 900,
 *   title: "My Game",
 * });
 * ```
 *
 * @public
 */
export function createGameWindow(options: GameWindowOptions): BrowserWindow {
  const window = new BrowserWindow(windowOptionsFor(options));
  const csp = cspValueFor(options);
  if (csp !== null) {
    installCspHeader(window.webContents.session, csp);
  }
  restrictPermissions(window.webContents.session);

  const url = isDevServerEntry(options.entry) ? options.entry : packagedEntryUrl(options.entry);
  lockNavigation(window.webContents, new URL(url).origin);
  forwardWindowEvents(window);

  if (options.show !== true) {
    window.once("ready-to-show", (): void => {
      window.show();
    });
  }
  void window.loadURL(url);
  return window;
}
