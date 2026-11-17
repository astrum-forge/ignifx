import { BrowserWindow } from "electron";
import { HOST_WINDOW_EVENT_CHANNEL, IGNIFX_ORIGIN } from "../host-contract.js";
import { cspFor } from "./csp.js";
import { originOfUrl } from "./origin.js";
import { packagedEntryUrl } from "./protocol.js";
import type { CspOptions } from "./csp.js";
import type { HostWindowEvent } from "../host-contract.js";
import type { BrowserWindowConstructorOptions, Session, WebContents } from "electron";

/**
 * Write required security settings after caller options so they cannot be overridden
 * (constitution §9.2). Sandboxed preloads must be bundled as CommonJS; see ADR-0018.
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
  /**
   * The origins the window's sub-frames may navigate to: a list, or a function read on every
   * navigation for a list that changes (a dev server that restarts on another port). Passed to
   * {@link lockNavigation}; the CSP's `frame-src` must admit them too (`csp: { frameSources }`).
   *
   * @defaultValue the window's own origin only, which is what `lockNavigation` has always allowed.
   */
  readonly frameOrigins?: FrameOrigins;
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
  readonly enableBlinkFeatures: "";
  readonly enableWebSQL: false;
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
  // Empty rather than absent: `enableBlinkFeatures` (`electron.d.ts` 19410) turns on Blink features
  // that ship disabled, and stating the empty list is what makes "none" reviewable in one place
  // instead of being a default someone has to look up.
  enableBlinkFeatures: "",
  // `enableWebSQL` (`electron.d.ts` 19427) is one of the four values Electron's own security
  // warnings check; WebSQL is a removed API with a history of memory-safety bugs and no game uses it.
  enableWebSQL: false,
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
 * Which responses {@link installCspHeader} puts its policy on: an origin, compared with
 * {@link originOfUrl}, or a predicate over the response URL (for a scheme, or several origins).
 *
 * @public
 */
export type CspHeaderScope = string | ((url: string) => boolean);

/**
 * The part of Electron's `onHeadersReceived` details {@link cspHeadersFor} reads.
 *
 * @public
 */
export interface CspResponseDetails {
  /** The response's URL. */
  readonly url: string;
  /** The headers the response carried, if any. */
  readonly responseHeaders?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Reports whether a response URL is in a {@link CspHeaderScope}.
 *
 * @param url - The response's URL.
 * @param scope - The scope, or `undefined` for every response.
 * @returns `true` when the policy goes on the response.
 */
function isInCspScope(url: string, scope: CspHeaderScope | undefined): boolean {
  if (scope === undefined) {
    return true;
  }
  if (typeof scope === "string") {
    return originOfUrl(url) === scope;
  }
  return scope(url);
}

/**
 * Decides the headers of one response: in scope, exactly one Content-Security-Policy, replacing
 * any the response carried; out of scope, nothing changes.
 *
 * @remarks
 * Pure, which is what lets the scoping be tested without a session. A policy is replaced rather
 * than appended because two `Content-Security-Policy` headers intersect, and the effective policy
 * would then be something no single file states.
 *
 * @param details - The response.
 * @param csp - The header value.
 * @param scope - Which responses get it; omitted, every response.
 * @returns The new headers, or `null` to leave the response as it is.
 *
 * @example
 * ```ts
 * cspHeadersFor({ url: "ignifx://app/index.html" }, cspFor(), "ignifx://app"); // { "Content-Security-Policy": [...] }
 * cspHeadersFor({ url: "http://127.0.0.1:5173/" }, cspFor(), "ignifx://app");  // null
 * ```
 *
 * @public
 */
export function cspHeadersFor(
  details: CspResponseDetails,
  csp: string,
  scope?: CspHeaderScope,
): Record<string, string[]> | null {
  if (!isInCspScope(details.url, scope)) {
    return null;
  }
  const headers: Record<string, string[]> = {};
  const received = details.responseHeaders ?? {};
  for (const name of Object.keys(received)) {
    if (name.toLowerCase() === "content-security-policy") {
      continue;
    }
    headers[name] = [...(received[name] ?? [])];
  }
  headers["Content-Security-Policy"] = [csp];
  return headers;
}

/**
 * Injects a Content-Security-Policy response header into the responses a session serves: every
 * response, or only those in `scope`.
 *
 * @remarks
 * `session.webRequest.onHeadersReceived` (`electron.d.ts` 19657) is the documented hook. The
 * listener replaces any policy the response already carried rather than appending one (see
 * {@link cspHeadersFor}).
 *
 * Pass a `scope` when the window frames another origin: a session-wide policy would also be served
 * to the framed document, whose `frame-ancestors 'none'` would then refuse to load it. Responses
 * outside the scope keep their own headers. {@link createGameWindow} scopes to the window's origin.
 *
 * @param session - The session to filter, normally the window's own.
 * @param csp - The header value to inject.
 * @param scope - The app's origin, or a predicate over the response URL; omitted, every response
 * (the behaviour before the parameter existed).
 *
 * @example
 * ```ts
 * installCspHeader(window.webContents.session, cspFor(), "ignifx://app");
 * ```
 *
 * @public
 */
export function installCspHeader(session: Session, csp: string, scope?: CspHeaderScope): void {
  session.webRequest.onHeadersReceived((details, callback): void => {
    const headers = cspHeadersFor(details, csp, scope);
    callback(headers === null ? {} : { responseHeaders: headers });
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
 * The origins a window's sub-frames may navigate to: a fixed list, or a function
 * {@link lockNavigation} calls on every navigation, for a list that changes while the window is
 * open.
 *
 * @public
 */
export type FrameOrigins = readonly string[] | (() => readonly string[]);

/**
 * What {@link lockNavigation} accepts besides the app's origin.
 *
 * @public
 */
export interface NavigationLockOptions {
  /**
   * The origins a sub-frame may navigate to. Exact origins (`http://127.0.0.1:5173`), compared with
   * {@link originOfUrl}; the main frame never leaves the app's origin whatever this says.
   *
   * @defaultValue the app's origin only.
   */
  readonly frameOrigins?: FrameOrigins;
}

/**
 * Decides one navigation: the main frame stays on the app's origin, and a sub-frame may go only to
 * one of `frameOrigins`. A URL with no tuple origin (`about:blank`, `data:`, `javascript:`, `file:`,
 * or one that does not parse) is refused in every frame.
 *
 * @param url - Where the frame would go.
 * @param isMainFrame - Whether it is the window's top frame.
 * @param appOrigin - The one origin the top frame may be on.
 * @param frameOrigins - The origins a sub-frame may be on.
 * @returns Whether the navigation may proceed.
 *
 * @example
 * ```ts
 * isNavigationAllowed("http://127.0.0.1:5173/", false, "ignifx://app", ["http://127.0.0.1:5173"]); // true
 * isNavigationAllowed("http://127.0.0.1:5173/", true, "ignifx://app", ["http://127.0.0.1:5173"]);  // false
 * ```
 *
 * @public
 */
export function isNavigationAllowed(
  url: string,
  isMainFrame: boolean,
  appOrigin: string,
  frameOrigins: readonly string[],
): boolean {
  const origin = originOfUrl(url);
  if (origin === null) {
    return false;
  }
  return isMainFrame ? origin === appOrigin : frameOrigins.includes(origin);
}

/**
 * Refuses every new window and every navigation off the app: the main frame is locked to
 * `allowedOrigin`, and sub-frames to `options.frameOrigins` (by default `allowedOrigin` too).
 *
 * @remarks
 * A packaged game navigates nowhere: its only document is the one it was loaded with, and anything
 * that tries to replace it — a stray `<a href>`, a `window.open`, an injected script — is a bug at
 * best. Outbound links go through `app.desktop.openExternal`, which checks the protocol against an
 * allow-list and hands the URL to the OS browser instead of loading it in the game window.
 *
 * Four hooks, because a navigation has four ways in and blocking one of them is not blocking the
 * navigation:
 *
 * - `setWindowOpenHandler` (`electron.d.ts` 18632) — `window.open`, `target="_blank"`, and every
 *   other request for a second window. Denied outright.
 * - `will-navigate` (`electron.d.ts` 17671) — the top-level document being replaced.
 * - `will-redirect` (`electron.d.ts` 17802) — a **server-side** redirect mid-navigation, which
 *   `will-navigate` never sees: the first hop passes the origin check and the redirect target is
 *   what actually loads. Gated per frame like the rest.
 * - `will-frame-navigate` (`electron.d.ts` 17652) — any frame, sub-frames included. The default
 *   policy forbids frames (`frame-src 'none'`), so this is the layer that says so when the policy is
 *   not there — a development window whose CSP the game replaced, for instance.
 *
 * Every event's details carry `isMainFrame`, which selects the rule ({@link isNavigationAllowed}).
 * A function `frameOrigins` is called on every navigation, so a host whose framed dev server moves
 * to another port answers with the current origin rather than the one it had at window creation.
 * If it throws, the navigation is refused and the error logged as a Node process warning
 * (`process.emitWarning`).
 *
 * The origin is read with {@link originOfUrl}, not with `URL.origin`: `ignifx` is not a *special*
 * scheme to the WHATWG parser, so `new URL("ignifx://evil/x").origin` is the string `"null"` and an
 * equality test written on it admits every authority. See `main/origin.ts`.
 *
 * `will-attach-webview` (`electron.d.ts` 17579) is refused for the same reason `webviewTag: false`
 * is set: two independent layers, because a `<webview>` that attaches is a second renderer with its
 * own preferences.
 *
 * @param contents - The window's web contents.
 * @param allowedOrigin - The one origin the main frame may stay on; anything else is blocked.
 * @param options - The origins sub-frames may navigate to.
 *
 * @example
 * ```ts
 * lockNavigation(window.webContents, "ignifx://app");
 * lockNavigation(editorWindow.webContents, "ignifx-editor://app", {
 *   frameOrigins: () => (server.running ? [server.origin] : []),
 * });
 * ```
 *
 * @public
 */
export function lockNavigation(
  contents: WebContents,
  allowedOrigin: string,
  options: NavigationLockOptions = {},
): void {
  const frameOrigins = options.frameOrigins ?? [allowedOrigin];
  const currentFrameOrigins = (): readonly string[] =>
    typeof frameOrigins === "function" ? frameOrigins() : frameOrigins;
  contents.setWindowOpenHandler((): { readonly action: "deny" } => ({ action: "deny" }));
  const gate = (details: { readonly url: string; readonly isMainFrame: boolean; preventDefault: () => void }): void => {
    // The frame-origin function is called only for a sub-frame navigation. If it throws, the lock
    // fails closed: the navigation is refused and the error logged, never let through.
    let allowed = false;
    try {
      allowed = details.isMainFrame
        ? isNavigationAllowed(details.url, true, allowedOrigin, [])
        : isNavigationAllowed(details.url, false, allowedOrigin, currentFrameOrigins());
    } catch (error) {
      // The main process has no `app.log`; a Node process warning is its log channel.
      process.emitWarning(
        `lockNavigation refused ${details.url} because the frameOrigins function threw: ${String(error)}`,
        { type: "IgnifxNavigationLockWarning" },
      );
    }
    if (!allowed) {
      details.preventDefault();
    }
  };
  contents.on("will-navigate", gate);
  contents.on("will-redirect", gate);
  contents.on("will-frame-navigate", gate);
  contents.on("will-attach-webview", (event): void => {
    event.preventDefault();
  });
}

/**
 * The permissions a game window is allowed to ask Chromium for.
 *
 * @remarks
 * Pointer lock and full screen are the two a game genuinely needs; measured on Electron 44.2.0,
 * `document.body.requestPointerLock` is present in a sandboxed `ignifx://` window and
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
 * @remarks
 * Three handlers, because Electron asks three different questions and answering one of them leaves
 * the other two on their defaults:
 *
 * - `setPermissionRequestHandler` (`electron.d.ts` 13426) — the prompt path, `navigator.*.request*`.
 * - `setPermissionCheckHandler` (`electron.d.ts` 13417) — the silent path, `permissions.query` and
 *   every API that checks before asking. Electron's own documentation says both are needed for
 *   "complete permission handling".
 * - `setDevicePermissionHandler` (`electron.d.ts` 13383) — the per-**device** grant that WebHID,
 *   WebUSB and Web Serial consult once a chooser has run. `false` for everything, which is the
 *   second lock on a door the two handlers above already keep shut.
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
  session.setDevicePermissionHandler((): boolean => false);
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
  const url = isDevServerEntry(options.entry) ? options.entry : packagedEntryUrl(options.entry);
  // `originOfUrl`, not `new URL(url).origin`: the latter is the string `"null"` for every
  // `ignifx://` URL, which would have made the navigation check pass for `ignifx://anything`.
  const origin = originOfUrl(url) ?? IGNIFX_ORIGIN;
  const csp = cspValueFor(options);
  if (csp !== null) {
    // Scoped to the window's own origin, so a document it frames keeps its own headers.
    installCspHeader(window.webContents.session, csp, origin);
  }
  restrictPermissions(window.webContents.session);
  lockNavigation(
    window.webContents,
    origin,
    options.frameOrigins === undefined ? {} : { frameOrigins: options.frameOrigins },
  );
  forwardWindowEvents(window);

  if (options.show !== true) {
    window.once("ready-to-show", (): void => {
      window.show();
    });
  }
  void window.loadURL(url);
  return window;
}
