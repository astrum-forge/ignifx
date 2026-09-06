import { defineExtension, platformInternals, storageInternals } from "@ignifx/core";
import { ELECTRON_ERROR_MESSAGES } from "../errors.js";
import { VERSION } from "../version.js";
import { defineDesktopAppProperty } from "./augmentation.js";
import { HostDesktop, UnavailableDesktop } from "./desktop.js";
import { assertHostContract, findIgnifxHost } from "./host.js";
import { ElectronStorageBackend } from "./storage-backend.js";
import type { Desktop } from "./desktop.js";
import type { HostWindowEvent, IgnifxHost } from "../host-contract.js";
import type { App, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `electron()` extension: the renderer half of `@ignifx/electron`
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * Registering it is the whole installation. In an Electron window it finds `window.ignifxHost`,
 * checks the contract, swaps `app.storage`'s backend for the file-system one, records
 * `app.platform.kind = "electron"`, wires the host's window events to `onApplicationFocus`, and
 * defines `app.desktop`. In a browser tab or a headless test there is no bridge, so it logs one
 * debug line and defines a `app.desktop` that answers `isElectron === false` and refuses everything
 * else — which is what lets one renderer bundle serve both builds.
 *
 * ## It imports no `electron`
 *
 * A renderer is sandboxed and context-isolated: it has no Node, no `require`, and no Electron
 * module system. `window.ignifxHost` is the entire interface, which is also why this file is the
 * one part of the package a browser build can safely bundle.
 */

/**
 * What `electron()` accepts.
 *
 * @public
 */
export interface ElectronOptions {
  /**
   * Whether the file-system storage backend replaces whatever `createApp` installed.
   *
   * @defaultValue `true`
   */
  readonly storage?: boolean;
  /**
   * Whether the host's `focus` and `blur` events are delivered as `onApplicationFocus`.
   *
   * @defaultValue `true`
   */
  readonly applicationEvents?: boolean;
  /**
   * Where to look for the bridge. Tests pass a fake global; a game never sets this.
   *
   * @defaultValue `globalThis`
   */
  readonly hostScope?: unknown;
}

/**
 * Turns the host's `focus` and `blur` into the DOM events `@ignifx/core` already listens for.
 *
 * @remarks
 * This is the "reuse the path" half of §3, and it works because of an asymmetry in how `App`
 * delivers the two application callbacks. `onApplicationFocus` is dispatched with a literal `true`
 * or `false` taken from *which listener fired*, so a synthetic `focus`/`blur` `Event` on `window`
 * delivers exactly the right value through core's own code. `onApplicationPause`, by contrast, is
 * dispatched with `globalThis.document.hidden`, which a synthetic event cannot influence.
 *
 * Measured on Electron 44.2.0 / macOS arm64 (S9.1): minimising, restoring, and blurring the window
 * fired `minimize`, `blur`, `restore`, and `focus` on the `BrowserWindow` in the main process and
 * delivered **nothing at all** to the page — no `visibilitychange`, no window `focus` or `blur`,
 * and `document.hidden` stayed `false` and `document.hasFocus()` stayed `true` throughout. So there
 * is no double delivery to worry about: without this forwarding a desktop game hears nothing.
 *
 * `minimize` and `restore` therefore reach games through `app.desktop.onWindowEvent` only, until
 * `@ignifx/core` grows a way for an extension to dispatch `onApplicationPause` directly. That gap
 * is recorded in `docs/adr/0018-electron-tooling.md`.
 *
 * @param event - The host event.
 * @param scope - The window to dispatch on; defaults to `globalThis`.
 */
function forwardApplicationEvent(event: HostWindowEvent, scope: unknown = globalThis): void {
  if (event !== "focus" && event !== "blur") {
    return;
  }
  // `instanceof` rather than a duck-typed `dispatchEvent` check: it is the one test that also
  // proves `new Event(...)` exists, and it is `false` rather than a `ReferenceError` under Node.
  if (typeof EventTarget === "undefined" || !(scope instanceof EventTarget)) {
    return;
  }
  scope.dispatchEvent(new Event(event));
}

/**
 * Builds the desktop service and installs everything a found bridge enables.
 *
 * @param ctx - The registration surface.
 * @param host - The validated bridge.
 * @param options - What the game passed to `electron(...)`.
 * @returns The service `app.desktop` returns.
 */
function installHost(ctx: ExtensionContext, host: IgnifxHost, options: ElectronOptions): Desktop {
  const desktop = new HostDesktop(host);

  // `app.platform.kind` is `"browser"` until now: an Electron renderer *is* a browser as far as the
  // kernel can tell, and guessing from the user agent would be worse than being wrong loudly.
  // `platformInternals` is the `@internal` seam core documents for exactly this call.
  platformInternals(ctx.app.platform).setKind("electron");

  if (options.storage !== false) {
    // `createApp` installed IndexedDB, because a document was reachable. Chromium's IndexedDB works
    // in an Electron renderer, but it lives in the session's cache directory rather than in
    // `userData`, which means a save that does not survive a cache clear and cannot be found by a
    // player or a support tool. The file backend is the one §2 specifies.
    storageInternals(ctx.app.storage).setBackend(new ElectronStorageBackend(host));
  }

  const scope = options.hostScope ?? globalThis;
  const forwardToDom = options.applicationEvents ?? true;
  // The signal is fed either way, so `app.desktop.onWindowEvent` always works; the option only
  // decides whether `onApplicationFocus` is driven from it as well.
  desktop.watchWindowEvents((event: HostWindowEvent): void => {
    if (forwardToDom) {
      forwardApplicationEvent(event, scope);
    }
  });

  ctx.onDispose((): void => {
    desktop.dispose();
  });
  return desktop;
}

/**
 * The `@ignifx/electron` extension factory.
 *
 * @param options - The three switches in {@link ElectronOptions}; a game passes none.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * import { createApp } from "@ignifx/core";
 * import { electron } from "@ignifx/electron";
 *
 * const app = await createApp({
 *   canvas,
 *   extensions: [physics(), input(), audio(), electron()],
 * });
 * app.desktop.isElectron; // true in a desktop build, false in a browser tab
 * ```
 *
 * @public
 */
export const electron: (options?: ElectronOptions) => Extension = defineExtension<ElectronOptions | undefined>(
  (raw) => {
    // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
    // game wrote `electron()`; the typed signature cannot express that, so the default lands here.
    const options: ElectronOptions = raw ?? {};
    return {
      name: "@ignifx/electron",
      version: VERSION,
      engine: ">=0.0.0 <1.0.0",
      requires: ["@ignifx/core"],
      register(ctx: ExtensionContext): void {
        ctx.registerErrorCodes(ELECTRON_ERROR_MESSAGES);
        const host = findIgnifxHost(options.hostScope ?? globalThis);
        if (host === null) {
          ctx.log.debug("no ignifxHost bridge on this page; app.desktop will report isElectron=false");
          defineDesktopAppProperty(ctx, new UnavailableDesktop());
          return;
        }
        // A bridge that is present but wrong is a hard failure, not a fallback: silently running a
        // desktop build on IndexedDB would lose a player's saves at the next update.
        assertHostContract(host);
        defineDesktopAppProperty(ctx, installHost(ctx, host, options));
      },
      onStart(app: App): void {
        if (app.desktop.isElectron) {
          const { versions } = app.desktop;
          app.log.info(
            "desktop host ready: Electron {electron}, Chromium {chrome}",
            versions?.electron ?? "?",
            versions?.chrome ?? "?",
          );
        }
      },
    };
  },
);
