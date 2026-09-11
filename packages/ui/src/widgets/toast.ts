import { Signal } from "@ignifx/core";
import { UI_CLASS_NAMES } from "../dom/styles.js";
import type { UiHost } from "../dom/host.js";
import type { SignalLike } from "@ignifx/core";

/**
 * The caller advances toast lifetime; no browser timer can outlive the app.
 * For messages that expire while paused, call `advance(app.time.unscaledDeltaTime)` from a script
 * with `updateWhenPaused = true`. The UI system does not advance toasts automatically.
 */

/**
 * What `new Toast(app.ui, options)` accepts.
 *
 * @public
 */
export interface ToastOptions {
  /** The layer to mount the stack into. Defaults to `"overlay"`. */
  readonly layer?: string;
  /** How long a message stays up, in seconds, unless {@link Toast.show} overrides it. */
  readonly duration?: number;
  /** How many messages are stacked before the oldest is dropped. Defaults to `4`. */
  readonly maxVisible?: number;
}

/** One message on screen, and how much of its life is left. */
interface LiveToast {
  /** The element, or `null` under a headless app. */
  readonly element: HTMLDivElement | null;
  /** The text, so a headless test can assert on it. */
  readonly text: string;
  /** Seconds left before it is removed. */
  remaining: number;
}

/**
 * A stack of transient messages.
 *
 * @example
 * ```ts
 * const toasts = new Toast(app.ui);
 * toasts.show("Checkpoint reached");
 * // in the update of a script that declares `static updateWhenPaused = true`:
 * toasts.advance(app.time.unscaledDeltaTime);
 * ```
 *
 * @public
 */
export class Toast {
  readonly #stack: HTMLDivElement | null;

  readonly #live: LiveToast[] = [];

  readonly #duration: number;

  readonly #maxVisible: number;

  readonly #expired = new Signal<string>();

  #disposed = false;

  /**
   * Builds the stack and mounts it.
   *
   * @param host - The overlay host, normally `app.ui`.
   * @param options - The layer, the default duration, and the stack depth.
   */
  constructor(host: UiHost, options: ToastOptions = {}) {
    this.#duration = options.duration ?? 3;
    this.#maxVisible = Math.max(1, options.maxVisible ?? 4);
    const layerElement = host.layer(options.layer ?? "overlay").element;
    if (layerElement === null) {
      this.#stack = null;
      return;
    }
    const stack = layerElement.ownerDocument.createElement("div");
    stack.className = UI_CLASS_NAMES.toastStack;
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    layerElement.append(stack);
    this.#stack = stack;
  }

  /**
   * The stack element, so a template can reposition it.
   *
   * @returns The element, or `null` when the app has no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#stack;
  }

  /**
   * The messages currently on screen, oldest first.
   *
   * @returns The texts.
   */
  get messages(): readonly string[] {
    return this.#live.map((entry: LiveToast): string => entry.text);
  }

  /**
   * Emitted with a message's text when it times out or is pushed off the stack.
   *
   * @returns The signal.
   */
  get onDismissed(): SignalLike<string> {
    return this.#expired;
  }

  /**
   * Shows a message.
   *
   * @param text - The message.
   * @param duration - How long it stays up, in seconds; defaults to the stack's own duration.
   */
  show(text: string, duration?: number): void {
    if (this.#disposed) {
      return;
    }
    const stack = this.#stack;
    let element: HTMLDivElement | null = null;
    if (stack !== null) {
      element = stack.ownerDocument.createElement("div");
      element.className = UI_CLASS_NAMES.toast;
      element.textContent = text;
      stack.append(element);
    }
    this.#live.push({ element, text, remaining: duration ?? this.#duration });
    while (this.#live.length > this.#maxVisible) {
      this.#remove(0);
    }
  }

  /**
   * Advances every message's timer.
   *
   * @remarks
   * Nothing calls this for you. The script that does must declare `static updateWhenPaused = true`
   * if toasts are to expire while the game is paused — a menu's "Saved" message is shown from a
   * paused game, and an ordinary script gets no `update` there.
   *
   * @param deltaSeconds - Seconds elapsed since the previous call; `dt` from a script's `update`, or
   * `app.time.unscaledDeltaTime` when the toast has to expire while the game is paused.
   */
  advance(deltaSeconds: number): void {
    for (let index = this.#live.length - 1; index >= 0; index -= 1) {
      const entry = this.#live[index];
      if (entry === undefined) {
        continue;
      }
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        this.#remove(index);
      }
    }
  }

  /** Removes every message at once. */
  clear(): void {
    while (this.#live.length > 0) {
      this.#remove(this.#live.length - 1);
    }
  }

  /** Removes the stack and unsubscribes. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#live.length = 0;
    this.#stack?.remove();
    this.#expired.clear();
  }

  /**
   * Removes one message and reports it.
   *
   * @param index - Its position in the stack.
   */
  #remove(index: number): void {
    const entry = this.#live[index];
    if (entry === undefined) {
      return;
    }
    this.#live.splice(index, 1);
    entry.element?.remove();
    this.#expired.emit(entry.text);
  }
}
