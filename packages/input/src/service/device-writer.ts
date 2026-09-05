import { ANY_KEY_CONTROL } from "../devices/keyboard.js";
import { TOUCH_SLOTS } from "../devices/pointing.js";
import type { ControlDescriptor } from "../devices/control.js";
import type { InputDevice } from "../devices/device.js";
import type { InputDevices } from "../devices/devices.js";
import type { MutableInputEvent } from "../dom/event-queue.js";

/**
 * Turning queued events into device state (`docs/architecture/08-input.md` §1). This is the only
 * place device values change from browser input, and it runs inside the `PreUpdate` drain — never
 * inside a DOM callback — so the whole frame sees one consistent snapshot.
 *
 * Every control the writer touches is resolved to a descriptor once, in the constructor; the drain
 * itself does one `Map` lookup per key event and no other string work (coding standards §7).
 */

/** How many DOM pointer buttons map onto `<Mouse>` controls: left, middle, right. */
const MOUSE_BUTTON_CONTROLS = 3;

/** `PointerEvent.button` values in the order `<Mouse>` declares its buttons. */
const MOUSE_BUTTON_ORDER: readonly number[] = Object.freeze([0, 1, 2]);

/**
 * Applies queued events to the device table.
 *
 * @internal
 */
export class DeviceWriter {
  readonly #devices: InputDevices;

  readonly #keys: ReadonlyMap<string, ControlDescriptor>;

  readonly #anyKey: ControlDescriptor;

  readonly #mouseButtons: readonly ControlDescriptor[];

  readonly #mousePosition: ControlDescriptor;

  readonly #mouseDelta: ControlDescriptor;

  readonly #mouseScroll: ControlDescriptor;

  readonly #pointerPress: ControlDescriptor;

  readonly #pointerPosition: ControlDescriptor;

  readonly #pointerDelta: ControlDescriptor;

  readonly #touchPress: readonly ControlDescriptor[];

  readonly #touchPosition: readonly ControlDescriptor[];

  readonly #touchDelta: readonly ControlDescriptor[];

  readonly #primaryPress: ControlDescriptor;

  readonly #primaryPosition: ControlDescriptor;

  readonly #primaryDelta: ControlDescriptor;

  readonly #touchCount: ControlDescriptor;

  /** `pointerId` occupying each touch slot, or `-1` when the slot is free. */
  readonly #slotIds: Int32Array = new Int32Array(TOUCH_SLOTS).fill(-1);

  /** The last position seen in each touch slot, so a delta can be derived. */
  readonly #slotLast: Float32Array = new Float32Array(TOUCH_SLOTS * 2);

  #heldKeys = 0;

  #activePointers = 0;

  #lastPointerX = 0;

  #lastPointerY = 0;

  #hasLastPointer = false;

  /**
   * Resolves every control the writer needs.
   *
   * @param devices - The app's device table.
   */
  constructor(devices: InputDevices) {
    this.#devices = devices;
    const keys = new Map<string, ControlDescriptor>();
    for (const control of devices.keyboard.controls) {
      keys.set(control.name, control);
    }
    this.#keys = keys;
    this.#anyKey = required(devices.keyboard, ANY_KEY_CONTROL);
    const mouseButtons: ControlDescriptor[] = [];
    const names = ["leftButton", "middleButton", "rightButton"];
    for (let index = 0; index < MOUSE_BUTTON_CONTROLS; index += 1) {
      mouseButtons.push(required(devices.mouse, names[index] ?? ""));
    }
    this.#mouseButtons = mouseButtons;
    this.#mousePosition = required(devices.mouse, "position");
    this.#mouseDelta = required(devices.mouse, "delta");
    this.#mouseScroll = required(devices.mouse, "scroll");
    this.#pointerPress = required(devices.pointer, "press");
    this.#pointerPosition = required(devices.pointer, "position");
    this.#pointerDelta = required(devices.pointer, "delta");
    const press: ControlDescriptor[] = [];
    const position: ControlDescriptor[] = [];
    const delta: ControlDescriptor[] = [];
    for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
      press.push(required(devices.touch, `touch${String(slot)}/press`));
      position.push(required(devices.touch, `touch${String(slot)}/position`));
      delta.push(required(devices.touch, `touch${String(slot)}/delta`));
    }
    this.#touchPress = press;
    this.#touchPosition = position;
    this.#touchDelta = delta;
    this.#primaryPress = required(devices.touch, "primaryTouch/press");
    this.#primaryPosition = required(devices.touch, "primaryTouch/position");
    this.#primaryDelta = required(devices.touch, "primaryTouch/delta");
    this.#touchCount = required(devices.touch, "touchCount");
  }

  /**
   * Zeroes the per-frame deltas before the queue is drained, so a frame with no motion reports no
   * motion (`docs/architecture/08-input.md` §1).
   */
  beginFrame(): void {
    const devices = this.#devices;
    devices.mouse.writeVector(this.#mouseDelta, 0, 0);
    devices.mouse.writeVector(this.#mouseScroll, 0, 0);
    devices.pointer.writeVector(this.#pointerDelta, 0, 0);
    devices.touch.writeVector(this.#primaryDelta, 0, 0);
    for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
      const control = this.#touchDelta[slot];
      if (control !== undefined) {
        devices.touch.writeVector(control, 0, 0);
      }
    }
  }

  /**
   * Applies one queued entry.
   *
   * @param entry - The entry, already in arrival order.
   */
  apply(entry: MutableInputEvent): void {
    switch (entry.kind) {
      case "keydown": {
        this.#writeKey(entry.code, 1, entry.repeat);
        return;
      }
      case "keyup": {
        this.#writeKey(entry.code, 0, false);
        return;
      }
      case "pointerdown":
      case "pointermove":
      case "pointerup": {
        this.#writePointer(entry);
        return;
      }
      case "wheel": {
        this.#devices.mouse.writeVector(
          this.#mouseScroll,
          this.#devices.mouse.valueAt(this.#mouseScroll.offset) + entry.deltaX,
          this.#devices.mouse.valueAt(this.#mouseScroll.offset + 1) + entry.deltaY,
        );
        return;
      }
      case "releaseAll": {
        this.releaseAll();
        return;
      }
      case "control": {
        entry.device?.writeIndex(entry.controlIndex, entry.valueX, entry.valueY);
        return;
      }
      case "textinput": {
        // Text entry is published on `app.input.events` for the UI layer and changes no control.
        return;
      }
    }
  }

  /** Returns every device to rest and forgets the held-key and touch bookkeeping. */
  releaseAll(): void {
    this.#devices.releaseAll();
    this.#heldKeys = 0;
    this.#activePointers = 0;
    this.#hasLastPointer = false;
    this.#slotIds.fill(-1);
    this.#slotLast.fill(0);
  }

  /**
   * Writes one key and keeps `anyKey` in step.
   *
   * @param control - The control name the adapter resolved the `code` to; `""` for unknown keys.
   * @param value - `1` for a press, `0` for a release.
   * @param repeat - Whether the event is an auto-repeat, which must not count twice.
   */
  #writeKey(control: string, value: number, repeat: boolean): void {
    if (control === "") {
      return;
    }
    const descriptor = this.#keys.get(control);
    if (descriptor === undefined) {
      return;
    }
    const previous = this.#devices.keyboard.valueAt(descriptor.offset);
    this.#devices.keyboard.write(descriptor, value);
    if (repeat) {
      return;
    }
    if (value > 0 && previous === 0) {
      this.#heldKeys += 1;
    } else if (value === 0 && previous > 0) {
      this.#heldKeys = Math.max(0, this.#heldKeys - 1);
    }
    this.#devices.keyboard.write(this.#anyKey, this.#heldKeys > 0 ? 1 : 0);
  }

  /**
   * Applies one pointer event to `<Pointer>` and, depending on `pointerType`, to `<Mouse>` or
   * `<Touch>`.
   *
   * @param entry - The queued pointer entry.
   */
  #writePointer(entry: MutableInputEvent): void {
    const down = entry.kind === "pointerdown";
    const up = entry.kind === "pointerup";
    const devices = this.#devices;
    const deltaX =
      entry.deltaX !== 0 || entry.deltaY !== 0 || !this.#hasLastPointer ? entry.deltaX : entry.x - this.#lastPointerX;
    const deltaY =
      entry.deltaX !== 0 || entry.deltaY !== 0 || !this.#hasLastPointer ? entry.deltaY : entry.y - this.#lastPointerY;
    this.#lastPointerX = entry.x;
    this.#lastPointerY = entry.y;
    this.#hasLastPointer = true;
    if (down) {
      this.#activePointers += 1;
    } else if (up) {
      this.#activePointers = Math.max(0, this.#activePointers - 1);
    }
    devices.pointer.writeVector(this.#pointerPosition, entry.x, entry.y);
    devices.pointer.writeVector(
      this.#pointerDelta,
      devices.pointer.valueAt(this.#pointerDelta.offset) + deltaX,
      devices.pointer.valueAt(this.#pointerDelta.offset + 1) + deltaY,
    );
    devices.pointer.write(this.#pointerPress, this.#activePointers > 0 ? 1 : 0);
    if (entry.pointerType === "touch") {
      this.#writeTouch(entry, down, up, deltaX, deltaY);
      return;
    }
    devices.mouse.writeVector(this.#mousePosition, entry.x, entry.y);
    devices.mouse.writeVector(
      this.#mouseDelta,
      devices.mouse.valueAt(this.#mouseDelta.offset) + deltaX,
      devices.mouse.valueAt(this.#mouseDelta.offset + 1) + deltaY,
    );
    if (!down && !up) {
      return;
    }
    for (let index = 0; index < MOUSE_BUTTON_CONTROLS; index += 1) {
      if (MOUSE_BUTTON_ORDER[index] !== entry.button) {
        continue;
      }
      const control = this.#mouseButtons[index];
      if (control !== undefined) {
        devices.mouse.write(control, down ? 1 : 0);
      }
    }
  }

  /**
   * Applies one touch pointer to its slot, to `primaryTouch`, and to `touchCount`.
   *
   * @param entry - The queued pointer entry.
   * @param down - Whether the touch began.
   * @param up - Whether the touch ended.
   * @param deltaX - The movement this event carried.
   * @param deltaY - The movement this event carried.
   */
  #writeTouch(entry: MutableInputEvent, down: boolean, up: boolean, deltaX: number, deltaY: number): void {
    const slot = this.#slotFor(entry.pointerId, down);
    if (slot < 0) {
      return;
    }
    const devices = this.#devices;
    const press = this.#touchPress[slot];
    const position = this.#touchPosition[slot];
    const delta = this.#touchDelta[slot];
    const derivedX = down ? 0 : entry.x - (this.#slotLast[slot * 2] ?? 0);
    const derivedY = down ? 0 : entry.y - (this.#slotLast[slot * 2 + 1] ?? 0);
    const moveX = deltaX !== 0 || deltaY !== 0 ? deltaX : derivedX;
    const moveY = deltaX !== 0 || deltaY !== 0 ? deltaY : derivedY;
    this.#slotLast[slot * 2] = entry.x;
    this.#slotLast[slot * 2 + 1] = entry.y;
    if (position !== undefined) {
      devices.touch.writeVector(position, entry.x, entry.y);
    }
    if (delta !== undefined) {
      devices.touch.writeVector(
        delta,
        devices.touch.valueAt(delta.offset) + moveX,
        devices.touch.valueAt(delta.offset + 1) + moveY,
      );
    }
    if (press !== undefined) {
      devices.touch.write(press, up ? 0 : 1);
    }
    if (slot === 0) {
      devices.touch.writeVector(this.#primaryPosition, entry.x, entry.y);
      devices.touch.writeVector(
        this.#primaryDelta,
        devices.touch.valueAt(this.#primaryDelta.offset) + moveX,
        devices.touch.valueAt(this.#primaryDelta.offset + 1) + moveY,
      );
      devices.touch.write(this.#primaryPress, up ? 0 : 1);
    }
    if (up) {
      this.#slotIds[slot] = -1;
    }
    devices.touch.write(this.#touchCount, this.#countTouches());
  }

  /**
   * Finds the slot a `pointerId` occupies, claiming a free one for a new touch.
   *
   * @param pointerId - The DOM pointer id.
   * @param claim - Whether an unknown id may claim a free slot.
   * @returns The slot index, or `-1` when the id is unknown and no slot is free.
   */
  #slotFor(pointerId: number, claim: boolean): number {
    for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
      if (this.#slotIds[slot] === pointerId) {
        return slot;
      }
    }
    if (!claim) {
      return -1;
    }
    for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
      if (this.#slotIds[slot] === -1) {
        this.#slotIds[slot] = pointerId;
        return slot;
      }
    }
    return -1;
  }

  /**
   * Counts the occupied touch slots.
   *
   * @returns How many touches are down.
   */
  #countTouches(): number {
    let count = 0;
    for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
      if (this.#slotIds[slot] !== -1) {
        count += 1;
      }
    }
    return count;
  }
}

/**
 * Resolves a control that the device layouts guarantee exists.
 *
 * @param device - The device to look in.
 * @param name - The control name.
 * @returns The descriptor, or a harmless out-of-range stand-in when the layout changed.
 */
function required(device: InputDevice, name: string): ControlDescriptor {
  return device.control(name) ?? { name, index: -1, offset: -1, kind: "button", components: 1 };
}
