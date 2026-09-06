import { Signal } from "@ignifx/core";
import { electronError, ElectronErrorCode } from "../errors.js";
import { hostCallError } from "./host.js";
import type {
  HostOpenDialogOptions,
  HostOpenDialogResult,
  HostPaths,
  HostVersions,
  HostWindowEvent,
  IgnifxHost,
} from "../host-contract.js";
import type { SignalLike } from "@ignifx/core";

/**
 * `app.desktop` (`docs/architecture/14-platform-electron.md` §3): the five window and shell
 * operations a game can ask a desktop host for, plus the two questions it can ask about one.
 *
 * The whole surface exists in a browser build too — the property is always defined once `electron()`
 * is registered — but every method rejects with `IGX-1462` there. A game that means to run in both
 * places branches on {@link Desktop.isElectron}, which is the one member that answers rather than
 * refuses.
 */

/**
 * The desktop service reached as `app.desktop`.
 *
 * @example
 * ```ts
 * class PauseMenu extends Script {
 *   async toggleFullscreen(): Promise<void> {
 *     if (this.app.desktop.isElectron) {
 *       await this.app.desktop.setFullscreen(!(await this.app.desktop.isFullscreen()));
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export interface Desktop {
  /**
   * Whether a preload bridge was found — that is, whether this really is a desktop build.
   *
   * @remarks
   * The one member that works everywhere. Everything else rejects with `IGX-1462` when this is
   * `false`.
   */
  readonly isElectron: boolean;
  /** The Electron, Chromium, and Node versions, or `null` in a browser build. */
  readonly versions: HostVersions | null;
  /**
   * The host window's lifecycle events, as the main process reports them.
   *
   * @remarks
   * This signal is the **only** source of `minimize` and `restore` in an Electron renderer.
   * Measured on Electron 44.2.0 / macOS arm64 (S9.1): minimising, restoring, and blurring the
   * window fired the matching `BrowserWindow` events in the main process and delivered **nothing**
   * to the page — no `visibilitychange`, no window `focus`/`blur`, and `document.hidden` stayed
   * `false` throughout. `electron()` turns `focus` and `blur` into `onApplicationFocus`, which
   * needs no `document` reading; `minimize` and `restore` have no `onApplicationPause` path today,
   * so a game that must pause on minimise subscribes here.
   *
   * @example
   * ```ts
   * app.desktop.onWindowEvent.connect((event) => {
   *   if (event === "minimize") {
   *     app.time.timeScale = 0;
   *   }
   * }, { owner: this });
   * ```
   */
  readonly onWindowEvent: SignalLike<HostWindowEvent>;
  /**
   * Resolves the platform directories.
   *
   * @returns The directories the host reported.
   */
  paths(): Promise<HostPaths>;
  /**
   * Enters or leaves full screen.
   *
   * @param fullscreen - `true` to enter, `false` to leave.
   * @returns A promise that settles once the host applied it.
   */
  setFullscreen(fullscreen: boolean): Promise<void>;
  /**
   * Reports whether the window is full screen.
   *
   * @returns `true` when it is.
   */
  isFullscreen(): Promise<boolean>;
  /**
   * Sets the window title.
   *
   * @param title - The new title.
   * @returns A promise that settles once the host applied it.
   */
  setWindowTitle(title: string): Promise<void>;
  /**
   * Closes the window and quits the application.
   *
   * @returns A promise that settles once the quit has been requested.
   */
  quit(): Promise<void>;
  /**
   * Shows a modal open dialog over the game window.
   *
   * @param options - What the dialog offers.
   * @returns What the user chose.
   */
  showOpenDialog(options?: HostOpenDialogOptions): Promise<HostOpenDialogResult>;
  /**
   * Opens a URL in the user's browser or mail client.
   *
   * @remarks
   * The main process checks the protocol against an allow-list — `https:` and `mailto:` by default
   * — and rejects with `IGX-1464` for anything else, rather than silently doing nothing.
   *
   * @param url - The absolute URL to open.
   * @returns A promise that settles once the OS accepted it.
   */
  openExternal(url: string): Promise<void>;
}

/**
 * The `Desktop` a browser build gets: `isElectron === false`, and every call refused.
 *
 * @remarks
 * A refusing implementation rather than an absent property, because the alternative — leaving
 * `app.desktop` undefined outside Electron — turns a portable game's every desktop call into an
 * optional-chaining exercise and hides the mistake of calling one unconditionally.
 *
 * @public
 */
export class UnavailableDesktop implements Desktop {
  /** Always `false`. */
  readonly isElectron: boolean = false;

  /** Always `null`. */
  readonly versions: HostVersions | null = null;

  /** Never emits: a browser build has no host window to report on. */
  readonly onWindowEvent: SignalLike<HostWindowEvent> = new Signal<HostWindowEvent>();

  /**
   * Refuses.
   *
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  paths(): Promise<HostPaths> {
    return Promise.reject(this.#refuse("paths"));
  }

  /**
   * Refuses.
   *
   * @param _fullscreen - Ignored.
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  setFullscreen(_fullscreen: boolean): Promise<void> {
    return Promise.reject(this.#refuse("setFullscreen"));
  }

  /**
   * Refuses.
   *
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  isFullscreen(): Promise<boolean> {
    return Promise.reject(this.#refuse("isFullscreen"));
  }

  /**
   * Refuses.
   *
   * @param _title - Ignored.
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  setWindowTitle(_title: string): Promise<void> {
    return Promise.reject(this.#refuse("setWindowTitle"));
  }

  /**
   * Refuses.
   *
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  quit(): Promise<void> {
    return Promise.reject(this.#refuse("quit"));
  }

  /**
   * Refuses.
   *
   * @param _options - Ignored.
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  showOpenDialog(_options?: HostOpenDialogOptions): Promise<HostOpenDialogResult> {
    return Promise.reject(this.#refuse("showOpenDialog"));
  }

  /**
   * Refuses.
   *
   * @param _url - Ignored.
   * @returns Never; the promise rejects with `IGX-1462`.
   */
  openExternal(_url: string): Promise<void> {
    return Promise.reject(this.#refuse("openExternal"));
  }

  /**
   * Builds the refusal.
   *
   * @param member - The member that was called.
   * @returns The error to reject with.
   */
  #refuse(member: string): Error {
    return electronError(
      ElectronErrorCode.hostUnavailable,
      `app.desktop.${member}() needs the @ignifx/electron preload bridge; this app is not running in one.`,
      {
        context: { member },
        hint: "Guard the call with app.desktop.isElectron, or scaffold the desktop variant with create-ignifx --desktop.",
      },
    );
  }
}

/**
 * The `Desktop` a desktop build gets: every call forwarded over the preload bridge.
 *
 * @public
 */
export class HostDesktop implements Desktop {
  /** Always `true`. */
  readonly isElectron: boolean = true;

  /** What the bridge reported at load time. */
  readonly versions: HostVersions | null;

  /** The host window's lifecycle events. */
  readonly onWindowEvent: SignalLike<HostWindowEvent>;

  /** The same signal, kept concretely so this class can emit on it. */
  readonly #windowEvents = new Signal<HostWindowEvent>();

  /** The bridge every call is forwarded over. */
  readonly #host: IgnifxHost;

  /** Removes the window-event subscription; `null` once removed. */
  #unsubscribe: (() => void) | null = null;

  /**
   * Builds a desktop service over a bridge.
   *
   * @param host - The validated `window.ignifxHost`.
   */
  constructor(host: IgnifxHost) {
    this.#host = host;
    this.versions = host.versions;
    this.onWindowEvent = this.#windowEvents;
  }

  /**
   * Subscribes to the host's window lifecycle events and re-emits them on
   * {@link HostDesktop.onWindowEvent}.
   *
   * @param listener - Called with each event name before the signal is emitted, so `electron()`
   * can map `focus` and `blur` onto `onApplicationFocus`.
   */
  watchWindowEvents(listener: (event: HostWindowEvent) => void): void {
    this.#unsubscribe?.();
    this.#unsubscribe = this.#host.window.onEvent((event: HostWindowEvent): void => {
      listener(event);
      this.#windowEvents.emit(event);
    });
  }

  /** Removes the window-event subscription and clears the signal. Safe to call twice. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#windowEvents.clear();
  }

  /**
   * Resolves the platform directories.
   *
   * @returns The directories the host reported.
   */
  async paths(): Promise<HostPaths> {
    try {
      return await this.#host.paths();
    } catch (error) {
      throw hostCallError("paths", error);
    }
  }

  /**
   * Enters or leaves full screen.
   *
   * @param fullscreen - `true` to enter, `false` to leave.
   * @returns A promise that settles once the host applied it.
   */
  async setFullscreen(fullscreen: boolean): Promise<void> {
    try {
      await this.#host.window.setFullscreen(fullscreen);
    } catch (error) {
      throw hostCallError("window.setFullscreen", error);
    }
  }

  /**
   * Reports whether the window is full screen.
   *
   * @returns `true` when it is.
   */
  async isFullscreen(): Promise<boolean> {
    try {
      return await this.#host.window.isFullscreen();
    } catch (error) {
      throw hostCallError("window.isFullscreen", error);
    }
  }

  /**
   * Sets the window title.
   *
   * @param title - The new title.
   * @returns A promise that settles once the host applied it.
   */
  async setWindowTitle(title: string): Promise<void> {
    try {
      await this.#host.window.setTitle(title);
    } catch (error) {
      throw hostCallError("window.setTitle", error);
    }
  }

  /**
   * Closes the window and quits the application.
   *
   * @returns A promise that settles once the quit has been requested.
   */
  async quit(): Promise<void> {
    try {
      await this.#host.window.quit();
    } catch (error) {
      throw hostCallError("window.quit", error);
    }
  }

  /**
   * Shows a modal open dialog over the game window.
   *
   * @param options - What the dialog offers.
   * @returns What the user chose.
   */
  async showOpenDialog(options?: HostOpenDialogOptions): Promise<HostOpenDialogResult> {
    try {
      return await this.#host.dialogs.showOpenDialog(options);
    } catch (error) {
      throw hostCallError("dialogs.showOpenDialog", error);
    }
  }

  /**
   * Opens a URL in the user's browser or mail client.
   *
   * @param url - The absolute URL to open.
   * @returns A promise that settles once the OS accepted it.
   */
  async openExternal(url: string): Promise<void> {
    try {
      await this.#host.shell.openExternal(url);
    } catch (error) {
      throw hostCallError("shell.openExternal", error);
    }
  }
}
