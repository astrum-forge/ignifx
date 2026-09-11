import { clamp } from "@ignifx/core";
import { UI_CLASS_NAMES } from "../dom/styles.js";
import { capturePointer, requireVirtualDevice } from "./virtual-device.js";
import type { VirtualDeviceLike } from "./virtual-device.js";
import type { UiLayer } from "../dom/layer.js";
import type { App } from "@ignifx/core";

/**
 * Write a virtual vector control with Y up, converting screen Y-down motion here.
 * Claim one pointer at a time so the stick and buttons support separate touches.
 * Clear the control on both release and cancellation to prevent stuck movement.
 */

/**
 * What `new VirtualJoystick(app, options)` accepts.
 *
 * @public
 */
export interface VirtualJoystickOptions {
  /** The `<Virtual>/…` control to write. Defaults to `"joystick"`. */
  readonly control?: string;
  /** The layer to mount into. Defaults to `"hud"`. */
  readonly layer?: string;
  /** How far the knob travels, in UI units, before the stick reads as fully deflected. */
  readonly radius?: number;
  /** Deflections shorter than this fraction of the radius read as zero. Defaults to `0.15`. */
  readonly deadZone?: number;
  /** Inline styles applied to the pad, for placement. */
  readonly style?: Readonly<Record<string, string>>;
  /** An accessible label for the pad. Defaults to the control name. */
  readonly ariaLabel?: string;
}

/**
 * Converts a raw deflection into the value written to the control.
 *
 * @param delta - The deflection along one axis, in UI units.
 * @param length - The deflection's length, in UI units.
 * @param radius - The radius at which the stick is fully deflected.
 * @param deadZone - The fraction of the radius below which the stick reads as centred.
 * @returns The axis value, in `-1` to `1`.
 *
 * @example
 * ```ts
 * stickAxis(0, 0, 44, 0.15); // 0
 * stickAxis(44, 44, 44, 0.15); // 1
 * ```
 *
 * @public
 */
export function stickAxis(delta: number, length: number, radius: number, deadZone: number): number {
  if (radius <= 0 || length <= 0) {
    return 0;
  }
  const magnitude = Math.min(length, radius) / radius;
  if (magnitude <= deadZone) {
    return 0;
  }
  // Rescaled so the value leaves the dead zone at 0 rather than jumping to `deadZone`, which is
  // what makes a slow walk possible on a touch screen.
  const scaled = (magnitude - deadZone) / (1 - deadZone);
  return clamp((delta / length) * scaled, -1, 1);
}

/**
 * An on-screen thumbstick.
 *
 * @example
 * ```ts
 * const stick = new VirtualJoystick(app, { control: "joystick" });
 * // later
 * stick.dispose();
 * ```
 *
 * @public
 */
export class VirtualJoystick {
  readonly #device: VirtualDeviceLike;

  readonly #control: string;

  readonly #radius: number;

  readonly #deadZone: number;

  readonly #pad: HTMLDivElement | null;

  readonly #knob: HTMLDivElement | null;

  #pointerId: number | null = null;

  #originX = 0;

  #originY = 0;

  #disposed = false;

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#pointerId !== null || this.#pad === null) {
      return;
    }
    this.#pointerId = event.pointerId;
    const box = this.#pad.getBoundingClientRect();
    this.#originX = box.left + box.width / 2;
    this.#originY = box.top + box.height / 2;
    capturePointer(this.#pad, event.pointerId);
    this.#move(event);
    event.preventDefault();
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      this.#move(event);
      event.preventDefault();
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      this.#release();
      event.preventDefault();
    }
  };

  /**
   * Builds the widget and mounts it.
   *
   * @param app - The running app; `app.ui` and `app.input.devices.virtual` are the parts used.
   * @param options - The control name, the layer, the geometry, and the placement styles.
   * @throws IgnifxError with code `IGX-1305` when `@ignifx/input` is not registered.
   */
  constructor(app: App, options: VirtualJoystickOptions = {}) {
    this.#control = options.control ?? "joystick";
    this.#device = requireVirtualDevice(app, "VirtualJoystick");
    this.#radius = options.radius ?? 44;
    this.#deadZone = clamp(options.deadZone ?? 0.15, 0, 0.9);
    const layer: UiLayer = app.ui.layer(options.layer ?? "hud");
    const host = layer.element;
    if (host === null) {
      this.#pad = null;
      this.#knob = null;
      return;
    }
    const document = host.ownerDocument;
    const pad = document.createElement("div");
    pad.className = UI_CLASS_NAMES.joystick;
    pad.setAttribute("role", "application");
    pad.setAttribute("aria-label", options.ariaLabel ?? this.#control);
    for (const [name, value] of Object.entries(options.style ?? {})) {
      pad.style.setProperty(name, value);
    }
    const knob = document.createElement("div");
    knob.className = UI_CLASS_NAMES.joystickKnob;
    pad.append(knob);
    host.append(pad);
    this.#pad = pad;
    this.#knob = knob;
    pad.addEventListener("pointerdown", this.#onPointerDown);
    pad.addEventListener("pointermove", this.#onPointerMove);
    pad.addEventListener("pointerup", this.#onPointerUp);
    pad.addEventListener("pointercancel", this.#onPointerUp);
    this.#device.setVector(this.#control, 0, 0);
  }

  /**
   * The pad element, so a template can restyle or reposition it.
   *
   * @returns The element, or `null` when the app has no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#pad;
  }

  /**
   * The control this stick writes.
   *
   * @returns The name, as it appears after `<Virtual>/`.
   */
  get control(): string {
    return this.#control;
  }

  /**
   * Whether a pointer currently holds the stick.
   *
   * @returns `true` while the stick is being dragged.
   */
  get isActive(): boolean {
    return this.#pointerId !== null;
  }

  /** Removes the widget, unsubscribes, and centres the control. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const pad = this.#pad;
    if (pad !== null) {
      pad.removeEventListener("pointerdown", this.#onPointerDown);
      pad.removeEventListener("pointermove", this.#onPointerMove);
      pad.removeEventListener("pointerup", this.#onPointerUp);
      pad.removeEventListener("pointercancel", this.#onPointerUp);
      pad.remove();
    }
    this.#device.setVector(this.#control, 0, 0);
  }

  /**
   * Reads one pointer position and writes the control.
   *
   * @param event - The pointer event.
   */
  #move(event: PointerEvent): void {
    const dx = event.clientX - this.#originX;
    // Screen `+Y` points down and the world's points up, so the vertical axis is negated here and
    // nowhere else — the same convention the templates' own widget used.
    const dy = this.#originY - event.clientY;
    const length = Math.hypot(dx, dy);
    const scale = length > this.#radius ? this.#radius / length : 1;
    this.#knob?.style.setProperty("transform", `translate(${String(dx * scale)}px, ${String(-dy * scale)}px)`);
    this.#device.setVector(
      this.#control,
      stickAxis(dx, length, this.#radius, this.#deadZone),
      stickAxis(dy, length, this.#radius, this.#deadZone),
    );
  }

  /** Centres the knob and the control. */
  #release(): void {
    this.#pointerId = null;
    this.#knob?.style.setProperty("transform", "translate(0px, 0px)");
    this.#device.setVector(this.#control, 0, 0);
  }
}
