import { parseControlPath } from "../bindings/path.js";
import { inputError, InputErrorCode } from "../errors.js";
import { DeviceKind } from "./device.js";
import { GAMEPAD_SLOTS, GamepadDevice } from "./gamepad.js";
import { createKeyboardDevice } from "./keyboard.js";
import { createMouseDevice, createPointerDevice, createTouchDevice } from "./pointing.js";
import { VirtualDevice } from "./virtual.js";
import type { ControlDescriptor, ControlKind } from "./control.js";
import type { ControlTouchHandler, InputDevice } from "./device.js";

/**
 * The device table (`docs/architecture/08-input.md` §1). It owns one instance of every device
 * family, resolves binding paths to `(device, control)` pairs once at binding time, and is what
 * `app.input.devices` exposes.
 */

/**
 * One control of one device, as a binding holds it after resolution.
 *
 * @public
 */
export interface ControlRef {
  /** The path the reference was resolved from. */
  readonly path: string;
  /** The device the control belongs to. */
  readonly device: InputDevice;
  /** The control itself. */
  readonly control: ControlDescriptor;
}

/**
 * Every input device an app has (`docs/architecture/08-input.md` §1).
 *
 * @example
 * ```ts
 * app.input.devices.keyboard.control("space");
 * app.input.devices.gamepads[0].isConnected;
 * ```
 *
 * @public
 */
export class InputDevices {
  /** The physical keyboard. */
  readonly keyboard: InputDevice;

  /** The mouse. */
  readonly mouse: InputDevice;

  /** The unified primary pointer: mouse, pen, or first touch. */
  readonly pointer: InputDevice;

  /** The touch screen and its ten slots. */
  readonly touch: InputDevice;

  /** The four gamepad slots, connected or not. */
  readonly gamepads: readonly GamepadDevice[];

  /** The synthetic device on-screen controls feed. */
  readonly virtual: VirtualDevice;

  /** Every device, in a stable order. */
  readonly all: readonly InputDevice[];

  /** Builds one device of every family plus the four gamepad slots. */
  constructor() {
    this.keyboard = createKeyboardDevice();
    this.mouse = createMouseDevice();
    this.pointer = createPointerDevice();
    this.touch = createTouchDevice();
    const gamepads: GamepadDevice[] = [];
    for (let slot = 0; slot < GAMEPAD_SLOTS; slot += 1) {
      gamepads.push(new GamepadDevice(slot));
    }
    this.gamepads = gamepads;
    this.virtual = new VirtualDevice();
    this.all = [this.keyboard, this.mouse, this.pointer, this.touch, ...gamepads, this.virtual];
  }

  /**
   * Looks a device up by family and index.
   *
   * @param kind - The device family.
   * @param deviceIndex - Which device of the family; only gamepads have more than one.
   * @returns The device, or `null` when the family has no such index.
   */
  device(kind: DeviceKind, deviceIndex: number): InputDevice | null {
    switch (kind) {
      case DeviceKind.keyboard: {
        return deviceIndex === 0 ? this.keyboard : null;
      }
      case DeviceKind.mouse: {
        return deviceIndex === 0 ? this.mouse : null;
      }
      case DeviceKind.pointer: {
        return deviceIndex === 0 ? this.pointer : null;
      }
      case DeviceKind.touch: {
        return deviceIndex === 0 ? this.touch : null;
      }
      case DeviceKind.gamepad: {
        return this.gamepads[deviceIndex] ?? null;
      }
      case DeviceKind.virtual: {
        return deviceIndex === 0 ? this.virtual : null;
      }
      default: {
        return null;
      }
    }
  }

  /**
   * Resolves a binding path to the control it names, creating the control when the path names the
   * virtual device (`docs/architecture/08-input.md` §8).
   *
   * @param path - The binding path, for example `<Gamepad>{1}/leftStick`.
   * @param virtualKind - The kind a virtual control is created with when it does not exist yet.
   * @returns The device and control the path names.
   * @throws IgnifxError with code `IGX-0803` when the path is malformed, names an unknown device
   * index, or names a control the device does not have.
   *
   * @example
   * ```ts
   * const ref = app.input.devices.resolve("<Mouse>/delta");
   * ref.device.valueAt(ref.control.offset);
   * ```
   */
  resolve(path: string, virtualKind?: ControlKind): ControlRef {
    const parsed = parseControlPath(path);
    const device = this.device(parsed.device, parsed.deviceIndex);
    if (device === null) {
      throw inputError(InputErrorCode.invalidBindingPath, `${path} names a device index that does not exist.`, {
        context: { path, device: parsed.device, deviceIndex: parsed.deviceIndex },
        hint: "Only <Gamepad> has more than one device; its indices are 0 to 3.",
      });
    }
    if (device instanceof VirtualDevice) {
      return { path, device, control: device.declare(parsed.control, virtualKind) };
    }
    const control = device.control(parsed.control);
    if (control === null) {
      throw inputError(InputErrorCode.invalidBindingPath, `${path} names a control ${parsed.device} does not have.`, {
        context: { path, device: parsed.device, control: parsed.control },
        hint: "Check the control tables in the @ignifx/input skill; keyboard controls use physical key names.",
      });
    }
    return { path, device, control };
  }

  /**
   * Installs the control-change handler on every device.
   *
   * @param handler - The handler, or `null` to detach it.
   *
   * @internal
   */
  setTouchHandler(handler: ControlTouchHandler | null): void {
    for (const device of this.all) {
      device.setTouchHandler(handler);
    }
  }

  /**
   * Forgets every binding subscription on every device.
   *
   * @internal
   */
  clearSubscribers(): void {
    for (const device of this.all) {
      device.clearSubscribers();
    }
  }

  /**
   * Returns every control of every device to rest.
   *
   * @internal
   */
  releaseAll(): void {
    for (const device of this.all) {
      device.releaseAll();
    }
  }
}
