import { UI_CLASS_NAMES } from "../dom/styles.js";
import { capturePointer, requireVirtualDevice } from "./virtual-device.js";
import type { VirtualDeviceLike } from "./virtual-device.js";
import type { App } from "@ignifx/core";

/**
 * `VirtualButton` (`docs/architecture/13-ui.md` §3): an on-screen button that writes a
 * `<Virtual>/…` button control, so `jump` is one action bound to a key, a gamepad face button, and
 * this widget at the same time.
 *
 * A real `<button>` element rather than a `<div>`, so it is focusable, announced by a screen
 * reader, and reachable by keyboard. That has one consequence worth knowing: pressing it with the
 * keyboard fires a `click`, not a `pointerdown`, so the button also releases on `blur` — otherwise a
 * `Tab` away mid-press would stick.
 */

/**
 * What `new VirtualButton(app, options)` accepts.
 *
 * @public
 */
export interface VirtualButtonOptions {
  /** The `<Virtual>/…` control to write. */
  readonly control: string;
  /** The glyph or word drawn on the button. Defaults to the control name. */
  readonly label?: string;
  /** The layer to mount into. Defaults to `"hud"`. */
  readonly layer?: string;
  /** Inline styles applied to the button, for placement. */
  readonly style?: Readonly<Record<string, string>>;
  /** An accessible label. Defaults to the control name. */
  readonly ariaLabel?: string;
}

/**
 * An on-screen button.
 *
 * @example
 * ```ts
 * const jump = new VirtualButton(app, { control: "jump", label: "A" });
 * ```
 *
 * @public
 */
export class VirtualButton {
  readonly #device: VirtualDeviceLike;

  readonly #control: string;

  readonly #element: HTMLButtonElement | null;

  #pressed = false;

  #disposed = false;

  readonly #onPress = (event: PointerEvent): void => {
    this.#set(true);
    const element = this.#element;
    if (element !== null) {
      capturePointer(element, event.pointerId);
    }
    event.preventDefault();
  };

  readonly #onRelease = (event: PointerEvent): void => {
    this.#set(false);
    event.preventDefault();
  };

  readonly #onBlur = (): void => {
    this.#set(false);
  };

  /**
   * Builds the widget and mounts it.
   *
   * @param app - The running app; `app.ui` and `app.input.devices.virtual` are the parts used.
   * @param options - The control name, the label, the layer, and the placement styles.
   * @throws IgnifxError with code `IGX-1305` when `@ignifx/input` is not registered.
   */
  constructor(app: App, options: VirtualButtonOptions) {
    this.#control = options.control;
    this.#device = requireVirtualDevice(app, "VirtualButton");
    const host = app.ui.layer(options.layer ?? "hud").element;
    if (host === null) {
      this.#element = null;
      return;
    }
    const element = host.ownerDocument.createElement("button");
    element.type = "button";
    element.className = UI_CLASS_NAMES.button;
    element.textContent = options.label ?? options.control;
    element.setAttribute("aria-label", options.ariaLabel ?? options.control);
    // The button takes DOM focus when tapped, and a focused `<button>` is not a text field, so
    // `isEditableElement` leaves `app.input.uiHasFocus` alone and the keyboard keeps driving the
    // game while a thumb is on the screen.
    for (const [name, value] of Object.entries(options.style ?? {})) {
      element.style.setProperty(name, value);
    }
    host.append(element);
    this.#element = element;
    element.addEventListener("pointerdown", this.#onPress);
    element.addEventListener("pointerup", this.#onRelease);
    element.addEventListener("pointercancel", this.#onRelease);
    element.addEventListener("blur", this.#onBlur);
    this.#device.set(this.#control, 0);
  }

  /**
   * The button element, so a template can restyle or reposition it.
   *
   * @returns The element, or `null` when the app has no DOM overlay.
   */
  get element(): HTMLButtonElement | null {
    return this.#element;
  }

  /**
   * The control this button writes.
   *
   * @returns The name, as it appears after `<Virtual>/`.
   */
  get control(): string {
    return this.#control;
  }

  /**
   * Whether the button is currently held.
   *
   * @returns `true` while it is pressed.
   */
  get isPressed(): boolean {
    return this.#pressed;
  }

  /** Removes the widget, unsubscribes, and releases the control. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const element = this.#element;
    if (element !== null) {
      element.removeEventListener("pointerdown", this.#onPress);
      element.removeEventListener("pointerup", this.#onRelease);
      element.removeEventListener("pointercancel", this.#onRelease);
      element.removeEventListener("blur", this.#onBlur);
      element.remove();
    }
    this.#device.set(this.#control, 0);
  }

  /**
   * Writes the control, if the state changed.
   *
   * @param pressed - Whether the button is held.
   */
  #set(pressed: boolean): void {
    if (this.#pressed === pressed) {
      return;
    }
    this.#pressed = pressed;
    this.#device.set(this.#control, pressed ? 1 : 0);
  }
}
