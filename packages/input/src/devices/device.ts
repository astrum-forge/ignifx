import { buildControls, ControlKind, controlSlotCount } from "./control.js";
import type { ControlDescriptor, ControlSpec } from "./control.js";

/**
 * The device base (`docs/architecture/08-input.md` §4). A device is a control table plus a
 * `Float32Array` of values; every device in the engine is either this class or a subclass that adds
 * hardware-specific behaviour (`GamepadDevice`, `VirtualDevice`).
 *
 * Devices never read the DOM: the adapters under `src/dom/` translate browser events into calls on
 * these writers, and the writes are applied when the `PreUpdate` system drains the queue.
 */

/**
 * The device families a binding path can name.
 *
 * @public
 */
export const DeviceKind = {
  /** Physical keys, addressed by `KeyboardEvent.code`. */
  keyboard: "Keyboard",
  /** The mouse: three buttons, position, delta, and the wheel. */
  mouse: "Mouse",
  /** The unified primary pointer: mouse, pen, or the first touch. */
  pointer: "Pointer",
  /** Up to ten simultaneous touches. */
  touch: "Touch",
  /** A game controller in the W3C standard mapping. */
  gamepad: "Gamepad",
  /** A synthetic device fed by on-screen controls. */
  virtual: "Virtual",
} as const;

/**
 * The union of the device families.
 *
 * @public
 */
export type DeviceKind = (typeof DeviceKind)[keyof typeof DeviceKind];

/**
 * Every device family, in the order `app.input.devices.all` reports them.
 *
 * @public
 */
export const DEVICE_KINDS: readonly DeviceKind[] = Object.freeze([
  DeviceKind.keyboard,
  DeviceKind.mouse,
  DeviceKind.pointer,
  DeviceKind.touch,
  DeviceKind.gamepad,
  DeviceKind.virtual,
]);

/**
 * Called when a control's value changed, with the action indices bound to that control. The service
 * installs it so that the frame's resolution can visit actions in the arrival order of the events
 * that actuated them.
 *
 * @public
 */
export type ControlTouchHandler = (actions: readonly number[]) => void;

/**
 * One input device: a named control table and the values behind it
 * (`docs/architecture/08-input.md` §4).
 *
 * @remarks
 * Values live in a `Float32Array`. Reads take the descriptor's `offset`, never the control's name,
 * so nothing on the per-frame path allocates or hashes a string (coding standards §7).
 *
 * @example
 * ```ts
 * const space = app.input.devices.keyboard.control("space");
 * if (space !== null && app.input.devices.keyboard.valueAt(space.offset) > 0) {
 *   jump();
 * }
 * ```
 *
 * @public
 */
export class InputDevice {
  /** The device family this device belongs to. */
  readonly kind: DeviceKind;

  /** Which device of its family this is; `0` for every family that has only one. */
  readonly deviceIndex: number;

  #controls: readonly ControlDescriptor[];

  #byName: Map<string, ControlDescriptor>;

  #values: Float32Array;

  #subscribers: (number[] | null)[];

  #onTouch: ControlTouchHandler | null = null;

  #isConnected: boolean;

  /**
   * Builds a device from its control declarations.
   *
   * @param kind - The device family.
   * @param deviceIndex - Which device of the family this is.
   * @param specs - The control declarations, in index order.
   * @param isConnected - Whether the device starts connected. Gamepads start disconnected.
   */
  constructor(kind: DeviceKind, deviceIndex: number, specs: readonly ControlSpec[], isConnected: boolean = true) {
    this.kind = kind;
    this.deviceIndex = deviceIndex;
    const controls = buildControls(specs);
    this.#controls = controls;
    this.#byName = indexByName(controls);
    this.#values = new Float32Array(controlSlotCount(controls));
    this.#subscribers = Array.from<number[] | null>({ length: controls.length }).fill(null);
    this.#isConnected = isConnected;
  }

  /**
   * The device's controls, in index order.
   *
   * @returns The control table.
   */
  get controls(): readonly ControlDescriptor[] {
    return this.#controls;
  }

  /**
   * Whether the device is present. Only gamepads ever report `false`.
   *
   * @returns `true` when bindings to this device can produce input.
   */
  get isConnected(): boolean {
    return this.#isConnected;
  }

  /**
   * Looks a control up by name. Call it at binding time, never per frame.
   *
   * @param name - The control name, for example `dpad/up`.
   * @returns The descriptor, or `null` when the device has no such control.
   */
  control(name: string): ControlDescriptor | null {
    return this.#byName.get(name) ?? null;
  }

  /**
   * Reads one component of the device's value array.
   *
   * @param offset - The slot, from a {@link ControlDescriptor}.
   * @returns The value, or `0` when the slot is out of range.
   */
  valueAt(offset: number): number {
    return this.#values[offset] ?? 0;
  }

  /**
   * Marks the device present or absent.
   *
   * @param connected - The new state. Disconnecting releases every control.
   *
   * @internal
   */
  setConnected(connected: boolean): void {
    if (this.#isConnected === connected) {
      return;
    }
    this.#isConnected = connected;
    if (!connected) {
      this.releaseAll();
    }
  }

  /**
   * Installs the handler that records which actions a control change touched.
   *
   * @param handler - The handler, or `null` to detach it.
   *
   * @internal
   */
  setTouchHandler(handler: ControlTouchHandler | null): void {
    this.#onTouch = handler;
  }

  /**
   * Replaces the action indices bound to one control.
   *
   * @param controlIndex - The control's index.
   * @param actions - The action indices, or `null` when nothing binds the control.
   *
   * @internal
   */
  setSubscribers(controlIndex: number, actions: number[] | null): void {
    if (controlIndex >= 0 && controlIndex < this.#subscribers.length) {
      this.#subscribers[controlIndex] = actions;
    }
  }

  /**
   * Forgets every binding subscription. The service rebuilds them whenever maps change.
   *
   * @internal
   */
  clearSubscribers(): void {
    this.#subscribers.fill(null);
  }

  /**
   * Writes one scalar control and reports the change.
   *
   * @param control - The descriptor to write.
   * @param value - The new value.
   *
   * @internal
   */
  write(control: ControlDescriptor, value: number): void {
    if (this.#values[control.offset] === value) {
      return;
    }
    this.#values[control.offset] = value;
    this.#touch(control.index);
  }

  /**
   * Writes one vector control and reports the change.
   *
   * @param control - The descriptor to write.
   * @param x - The new x component.
   * @param y - The new y component.
   *
   * @internal
   */
  writeVector(control: ControlDescriptor, x: number, y: number): void {
    const offset = control.offset;
    if (this.#values[offset] === x && this.#values[offset + 1] === y) {
      return;
    }
    this.#values[offset] = x;
    this.#values[offset + 1] = y;
    this.#touch(control.index);
  }

  /**
   * Writes a control by index, treating a vector's second component as `0` for scalar controls.
   *
   * @param controlIndex - The control's index.
   * @param x - The new value, or the x component.
   * @param y - The y component; ignored for scalar controls.
   *
   * @internal
   */
  writeIndex(controlIndex: number, x: number, y: number): void {
    const control = this.#controls[controlIndex];
    if (control === undefined) {
      return;
    }
    if (control.kind === ControlKind.vector2) {
      this.writeVector(control, x, y);
      return;
    }
    this.write(control, x);
  }

  /**
   * Returns every control to rest. Queued by `blur` and `visibilitychange` so a key held while the
   * page loses focus does not stay stuck (`docs/architecture/08-input.md` §4).
   *
   * @internal
   */
  releaseAll(): void {
    const values = this.#values;
    for (let index = 0; index < this.#controls.length; index += 1) {
      const control = this.#controls[index];
      if (control === undefined) {
        continue;
      }
      let changed = false;
      for (let component = 0; component < control.components; component += 1) {
        if (values[control.offset + component] !== 0) {
          values[control.offset + component] = 0;
          changed = true;
        }
      }
      if (changed) {
        this.#touch(index);
      }
    }
  }

  /**
   * Zeroes one control without reporting a change; used for the per-frame deltas that reset before
   * the queue is drained.
   *
   * @param control - The descriptor to clear.
   *
   * @internal
   */
  clearQuietly(control: ControlDescriptor): void {
    for (let component = 0; component < control.components; component += 1) {
      this.#values[control.offset + component] = 0;
    }
  }

  /**
   * Appends controls to a device whose table grows at run time. Only {@link VirtualDevice} uses it.
   *
   * @param specs - The controls to append.
   * @returns The descriptors of the appended controls.
   *
   * @internal
   */
  protected appendControls(specs: readonly ControlSpec[]): readonly ControlDescriptor[] {
    const merged: ControlSpec[] = this.#controls.map((control) => ({ name: control.name, kind: control.kind }));
    for (const spec of specs) {
      merged.push(spec);
    }
    const previousValues = this.#values;
    const controls = buildControls(merged);
    this.#controls = controls;
    this.#byName = indexByName(controls);
    const values = new Float32Array(controlSlotCount(controls));
    values.set(previousValues.subarray(0, Math.min(previousValues.length, values.length)));
    this.#values = values;
    const subscribers = Array.from<number[] | null>({ length: controls.length }).fill(null);
    for (let index = 0; index < this.#subscribers.length; index += 1) {
      subscribers[index] = this.#subscribers[index] ?? null;
    }
    this.#subscribers = subscribers;
    return controls.slice(merged.length - specs.length);
  }

  /**
   * Reports a control change to the resolution pass.
   *
   * @param controlIndex - The control that changed.
   */
  #touch(controlIndex: number): void {
    const handler = this.#onTouch;
    if (handler === null) {
      return;
    }
    const actions = this.#subscribers[controlIndex];
    if (actions !== null && actions !== undefined) {
      handler(actions);
    }
  }
}

/**
 * Builds the name lookup a device answers `control(name)` from.
 *
 * @param controls - The control table.
 * @returns The map from control name to descriptor.
 */
function indexByName(controls: readonly ControlDescriptor[]): Map<string, ControlDescriptor> {
  const byName = new Map<string, ControlDescriptor>();
  for (const control of controls) {
    byName.set(control.name, control);
  }
  return byName;
}
