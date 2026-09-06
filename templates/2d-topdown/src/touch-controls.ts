import type { App } from "@ignifx/core";

/**
 * An on-screen thumbstick and one button, drawn in the DOM and wired into `<Virtual>`.
 *
 * ## Why this lives in the template
 *
 * `@ignifx/ui` will ship a `VirtualJoystick` in Phase 8 of the engineering plan, and this file is
 * meant to be **deleted** when it does — the bindings in `game.input.json` (`<Virtual>/joystick`,
 * `<Virtual>/interact`) do not change, because the widget's whole job is to write those two
 * controls. Until then a template that claims to be playable on a phone has to bring its own.
 *
 * ## How it talks to the input system
 *
 * `app.input.devices.virtual` is a device whose controls are created on demand, and a binding path
 * of `<Virtual>/name` reads whatever the widget last wrote. Nothing polls: `setVector` and `set`
 * are called from pointer events, and the value stands until the next event changes it. That is
 * also why `pointercancel` and `pointerup` both have to release the stick — a value written on
 * `pointerdown` and never cleared would leave the character walking for ever.
 */

/** How far, in CSS pixels, the knob travels before the stick reads as fully deflected. */
const STICK_RADIUS = 44;

/** One on-screen button: the `<Virtual>` control it writes, and what it says. */
export interface TouchButton {
  /** The control name after `<Virtual>/`. */
  readonly control: string;
  /** The glyph or word drawn on the button. */
  readonly label: string;
}

/** What {@link createTouchControls} returns. */
export interface TouchControls {
  /** Removes the overlay and its listeners. */
  dispose(): void;
}

/**
 * Reports whether this device is likely to want on-screen controls at all.
 *
 * @returns `true` when the browser reports at least one touch point.
 */
export function hasTouch(): boolean {
  return navigator.maxTouchPoints > 0;
}

/**
 * Builds the overlay and wires it to the virtual device.
 *
 * @param app - The running app; `app.input.devices.virtual` is the only part used.
 * @param buttons - The buttons to draw to the right of the stick.
 * @param host - The element to append the overlay to.
 * @returns A handle that removes the overlay again.
 */
export function createTouchControls(app: App, buttons: readonly TouchButton[], host: HTMLElement): TouchControls {
  const virtual = app.input.devices.virtual;
  virtual.declare("joystick", "vector2");
  for (const button of buttons) {
    virtual.declare(button.control, "button");
  }

  const root = document.createElement("div");
  root.className = "touch-controls";

  const stick = document.createElement("div");
  stick.className = "touch-stick";
  const knob = document.createElement("div");
  knob.className = "touch-knob";
  stick.append(knob);
  root.append(stick);

  const pad = document.createElement("div");
  pad.className = "touch-buttons";
  root.append(pad);
  host.append(root);

  const cleanups: (() => void)[] = [];

  /** The pointer that currently owns the stick, or `null`. */
  let stickPointer: number | null = null;
  let originX = 0;
  let originY = 0;

  const releaseStick = (): void => {
    stickPointer = null;
    knob.style.transform = "translate(0px, 0px)";
    virtual.setVector("joystick", 0, 0);
  };

  const moveStick = (event: PointerEvent): void => {
    const dx = event.clientX - originX;
    // The screen's +Y points down and the world's points up, so the vertical axis is negated here
    // and nowhere else.
    const dy = originY - event.clientY;
    const length = Math.hypot(dx, dy);
    const scale = length > STICK_RADIUS ? STICK_RADIUS / length : 1;
    knob.style.transform = `translate(${String(dx * scale)}px, ${String(-dy * scale)}px)`;
    virtual.setVector("joystick", (dx * scale) / STICK_RADIUS, (dy * scale) / STICK_RADIUS);
  };

  const onStickDown = (event: PointerEvent): void => {
    if (stickPointer !== null) {
      return;
    }
    stickPointer = event.pointerId;
    const box = stick.getBoundingClientRect();
    originX = box.left + box.width / 2;
    originY = box.top + box.height / 2;
    stick.setPointerCapture(event.pointerId);
    moveStick(event);
    event.preventDefault();
  };

  const onStickMove = (event: PointerEvent): void => {
    if (event.pointerId === stickPointer) {
      moveStick(event);
      event.preventDefault();
    }
  };

  const onStickUp = (event: PointerEvent): void => {
    if (event.pointerId === stickPointer) {
      releaseStick();
      event.preventDefault();
    }
  };

  stick.addEventListener("pointerdown", onStickDown);
  stick.addEventListener("pointermove", onStickMove);
  stick.addEventListener("pointerup", onStickUp);
  stick.addEventListener("pointercancel", onStickUp);
  cleanups.push(() => {
    stick.removeEventListener("pointerdown", onStickDown);
    stick.removeEventListener("pointermove", onStickMove);
    stick.removeEventListener("pointerup", onStickUp);
    stick.removeEventListener("pointercancel", onStickUp);
  });

  for (const button of buttons) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "touch-button";
    element.textContent = button.label;
    element.setAttribute("aria-label", button.control);
    pad.append(element);

    const press = (event: PointerEvent): void => {
      virtual.set(button.control, 1);
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const release = (event: PointerEvent): void => {
      virtual.set(button.control, 0);
      event.preventDefault();
    };
    element.addEventListener("pointerdown", press);
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    cleanups.push(() => {
      element.removeEventListener("pointerdown", press);
      element.removeEventListener("pointerup", release);
      element.removeEventListener("pointercancel", release);
    });
  }

  return {
    dispose(): void {
      for (const cleanup of cleanups) {
        cleanup();
      }
      root.remove();
    },
  };
}
