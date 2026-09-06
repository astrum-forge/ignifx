import { clamp01, Signal } from "@ignifx/core";
import { UI_CLASS_NAMES } from "../dom/styles.js";
import type { UiHost } from "../dom/host.js";
import type { AssetProgress, Assets, Disconnect, SignalLike } from "@ignifx/core";

/**
 * `LoadingScreen` (`docs/architecture/13-ui.md` §3): a full-overlay panel with a label and a
 * progress bar, bound to `app.assets`.
 *
 * ## Where the number comes from
 *
 * `app.assets.onProgress` carries `{ loaded, total, bytesLoaded, bytesTotal }`
 * (`packages/core/src/assets/types.ts`). {@link progressFraction} prefers the byte counts, because
 * a 40 MB level and a 2 KB config are not half the work each, and falls back to the handle counts
 * when the build recorded no sizes. A `BatchHandle` from `app.assets.preloadGroup("boot")` reports
 * its own mean in `progress`, which {@link LoadingScreen.progress} also accepts.
 *
 * ## Pairing with the asset-delivery rule
 *
 * A completed load settles as soon as it finishes before `app.start()` and after `app.stop()`;
 * once the loop runs, delivery waits for `PreUpdate`. So a boot screen that awaits
 * `preloadGroup("boot").promise` **before** `start()` needs no frames, and one that loads a level
 * mid-game is driven by the frames the loop is already running. Neither case needs this class to
 * poll.
 */

/**
 * What `new LoadingScreen(app.ui, options)` accepts.
 *
 * @public
 */
export interface LoadingScreenOptions {
  /** The layer to mount into. Defaults to `"overlay"`. */
  readonly layer?: string;
  /** The initial label. Defaults to `"Loading…"`. */
  readonly label?: string;
  /** Whether the screen starts shown. Defaults to `true` — a boot screen is up before anything else. */
  readonly visible?: boolean;
}

/**
 * The fraction of an asset batch that is done.
 *
 * @remarks
 * Bytes when the build recorded sizes, handles otherwise, and `1` for an empty batch — a loading
 * screen that never reaches 100% because nothing was queued is worse than one that closes at once.
 *
 * @param progress - The payload of `app.assets.onProgress`.
 * @returns The fraction, in `[0, 1]`.
 *
 * @example
 * ```ts
 * progressFraction({ loaded: 1, total: 4, bytesLoaded: 0, bytesTotal: 0 }); // 0.25
 * ```
 *
 * @public
 */
export function progressFraction(progress: AssetProgress): number {
  if (progress.bytesTotal > 0) {
    return clamp01(progress.bytesLoaded / progress.bytesTotal);
  }
  if (progress.total > 0) {
    return clamp01(progress.loaded / progress.total);
  }
  return 1;
}

/**
 * A full-overlay loading panel.
 *
 * @example
 * ```ts
 * const screen = new LoadingScreen(app.ui, { label: "Loading…" });
 * screen.bindTo(app.assets);
 * await app.assets.preloadGroup("boot").promise;
 * screen.hide();
 * ```
 *
 * @public
 */
export class LoadingScreen {
  readonly #root: HTMLDivElement | null;

  readonly #label: HTMLDivElement | null = null;

  readonly #bar: HTMLDivElement | null = null;

  readonly #dismissed = new Signal();

  #disconnect: Disconnect | null = null;

  #progress = 0;

  #visible: boolean;

  #disposed = false;

  /**
   * Builds the screen and mounts it.
   *
   * @param host - The overlay host, normally `app.ui`.
   * @param options - The layer, the label, and the initial visibility.
   */
  constructor(host: UiHost, options: LoadingScreenOptions = {}) {
    this.#visible = options.visible ?? true;
    const layerElement = host.layer(options.layer ?? "overlay").element;
    if (layerElement === null) {
      this.#root = null;
      return;
    }
    const document = layerElement.ownerDocument;
    const root = document.createElement("div");
    root.className = UI_CLASS_NAMES.loading;
    root.setAttribute("role", "progressbar");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "1");
    root.setAttribute("aria-valuenow", "0");
    const label = document.createElement("div");
    label.className = UI_CLASS_NAMES.loadingLabel;
    label.textContent = options.label ?? "Loading…";
    const track = document.createElement("div");
    track.className = UI_CLASS_NAMES.loadingTrack;
    const bar = document.createElement("div");
    bar.className = UI_CLASS_NAMES.loadingBar;
    track.append(bar);
    root.append(label, track);
    root.style.setProperty("display", this.#visible ? "flex" : "none");
    layerElement.append(root);
    this.#root = root;
    this.#label = label;
    this.#bar = bar;
  }

  /**
   * The screen's outermost element, so a template can restyle it or add a logo.
   *
   * @returns The element, or `null` when the app has no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#root;
  }

  /**
   * Whether the screen is shown.
   *
   * @returns `true` while it is on screen.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * How far along the bar is, in `[0, 1]`. Writing it moves the bar; values outside the range are
   * clamped.
   *
   * @returns The fraction.
   */
  get progress(): number {
    return this.#progress;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set progress(value: number) {
    const fraction = clamp01(value);
    if (this.#progress === fraction) {
      return;
    }
    this.#progress = fraction;
    this.#bar?.style.setProperty("width", `${String(fraction * 100)}%`);
    this.#root?.setAttribute("aria-valuenow", String(fraction));
  }

  /**
   * Emitted after {@link LoadingScreen.hide}, whatever caused it.
   *
   * @returns The signal.
   */
  get onDismissed(): SignalLike {
    return this.#dismissed;
  }

  /**
   * Follows an asset service's aggregate progress until {@link LoadingScreen.dispose} or a second
   * call to this method.
   *
   * @param assets - The asset service, normally `app.assets`.
   * @returns A function that stops following.
   */
  bindTo(assets: Assets): Disconnect {
    this.#disconnect?.();
    const disconnect = assets.onProgress.connect((progress: AssetProgress): void => {
      this.progress = progressFraction(progress);
    });
    this.#disconnect = disconnect;
    return disconnect;
  }

  /**
   * Replaces the label.
   *
   * @param text - The new label.
   */
  setLabel(text: string): void {
    if (this.#label !== null) {
      this.#label.textContent = text;
    }
  }

  /** Shows the screen. */
  show(): void {
    if (this.#visible || this.#disposed) {
      return;
    }
    this.#visible = true;
    this.#root?.style.setProperty("display", "flex");
  }

  /** Hides the screen and emits {@link LoadingScreen.onDismissed}. */
  hide(): void {
    if (!this.#visible || this.#disposed) {
      return;
    }
    this.#visible = false;
    this.#root?.style.setProperty("display", "none");
    this.#dismissed.emit();
  }

  /** Removes the screen and stops following the asset service. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#disconnect?.();
    this.#disconnect = null;
    this.#root?.remove();
    this.#dismissed.clear();
  }
}
