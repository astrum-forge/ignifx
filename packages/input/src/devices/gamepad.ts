import { ControlKind } from "./control.js";
import { DeviceKind, InputDevice } from "./device.js";
import type { ControlDescriptor, ControlSpec } from "./control.js";

/**
 * Gamepads (`docs/architecture/08-input.md` §4). The W3C **standard mapping** is assumed: buttons
 * 0–15 and axes 0–3 have fixed meanings, and a pad that reports `mapping: "standard"` is read
 * straight through. Pads that report anything else are matched against {@link GAMEPAD_REMAPS} by a
 * substring of their `id`, and fall back to the standard order when no entry matches.
 *
 * Two normalisations happen here so that bindings mean the same thing everywhere:
 *
 * - **Stick Y is flipped.** The Gamepad API reports `+1` when a stick is pushed *down*; ignifx
 *   reports `+1` for *up*, so `<Gamepad>/leftStick` agrees with the `2DVector` composite and with
 *   screen-independent movement code.
 * - **`dpad` is synthesised** as a `vector2` from the four d-pad buttons, so a d-pad and a stick
 *   can bind to the same `vector2` action.
 */

/** Standard-mapping button index of each named gamepad button control. */
const STANDARD_BUTTONS: readonly (readonly [string, number])[] = Object.freeze([
  ["buttonSouth", 0],
  ["buttonEast", 1],
  ["buttonWest", 2],
  ["buttonNorth", 3],
  ["leftShoulder", 4],
  ["rightShoulder", 5],
  ["leftTrigger", 6],
  ["rightTrigger", 7],
  ["select", 8],
  ["start", 9],
  ["leftStickPress", 10],
  ["rightStickPress", 11],
  ["dpad/up", 12],
  ["dpad/down", 13],
  ["dpad/left", 14],
  ["dpad/right", 15],
]);

/** The two controls that are axes rather than buttons even though the API reports them as buttons. */
const TRIGGER_CONTROLS: readonly string[] = Object.freeze(["leftTrigger", "rightTrigger"]);

/**
 * How one non-standard pad's raw indices map onto the standard ones
 * (`docs/architecture/08-input.md` §4, "a small remap table for common non-standard pads").
 *
 * @public
 */
export interface GamepadRemap {
  /** A substring of `Gamepad.id` that selects this remap, matched case-insensitively. */
  readonly id: string;
  /** Standard button index to raw button index; `-1` means the pad has no such button. */
  readonly buttons: readonly number[];
  /** Standard axis index (`0` lx, `1` ly, `2` rx, `3` ry) to raw axis index. */
  readonly axes: readonly number[];
}

/**
 * The remaps this build ships. Both entries are pads that report an empty `mapping` string in at
 * least one browser and lay their buttons out differently from the standard order.
 *
 * @public
 */
export const GAMEPAD_REMAPS: readonly GamepadRemap[] = Object.freeze([
  // Nintendo-style pads report the physical positions, so the "south" *position* carries the B
  // label. Bindings name positions, so the two pairs are swapped back into standard order.
  Object.freeze({
    id: "nintendo",
    buttons: Object.freeze([1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    axes: Object.freeze([0, 1, 2, 3]),
  }),
  // The DualShock 4 in Firefox's non-standard mapping puts the right stick on axes 3 and 4 and
  // moves the triggers onto the axis list, which this build reads as buttons only.
  Object.freeze({
    id: "054c",
    buttons: Object.freeze([1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17]),
    axes: Object.freeze([0, 1, 3, 4]),
  }),
]);

/**
 * One frame's reading of a physical gamepad, in the shape `navigator.getGamepads()` reports.
 * Declared as its own type so the mapping is testable without a browser.
 *
 * @public
 */
export interface GamepadSnapshot {
  /** The pad's `id` string. */
  readonly id: string;
  /** The pad's `mapping`: `"standard"`, `"xr-standard"`, or `""`. */
  readonly mapping: string;
  /** Button values in `[0, 1]`, in the pad's raw order. */
  readonly buttons: readonly number[];
  /** Axis values in `[-1, 1]`, in the pad's raw order. */
  readonly axes: readonly number[];
}

/**
 * The shape of one `dual-rumble` haptic effect.
 *
 * @public
 */
export interface VibrationEffectParameters {
  /** How long the effect lasts, in milliseconds. */
  readonly duration: number;
  /** The low-frequency motor magnitude, in `[0, 1]`. */
  readonly strongMagnitude: number;
  /** The high-frequency motor magnitude, in `[0, 1]`. */
  readonly weakMagnitude: number;
}

/**
 * The subset of the DOM `GamepadHapticActuator` this package uses.
 *
 * @public
 */
export interface VibrationActuatorLike {
  /**
   * Plays one haptic effect.
   *
   * @param type - The effect type; `"dual-rumble"` is the only one every pad supports.
   * @param parameters - How long the effect lasts and how hard the motors run.
   * @returns Whatever the host resolves the effect with.
   */
  playEffect(type: string, parameters: VibrationEffectParameters): Promise<unknown>;
}

/**
 * How many gamepad slots the service tracks (`docs/architecture/08-input.md` §1).
 *
 * @public
 */
export const GAMEPAD_SLOTS = 4;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The gamepad control names, in index order.
 *
 * @returns Every control a `<Gamepad>/…` path may end in.
 *
 * @public
 */
export function gamepadControlNames(): readonly string[] {
  const names: string[] = ["leftStick", "rightStick", "dpad"];
  for (const entry of STANDARD_BUTTONS) {
    names.push(entry[0]);
  }
  return names;
}

/**
 * Picks the remap for a pad, or `null` when the standard order applies.
 *
 * @param snapshot - The pad reading.
 * @returns The remap, or `null` for a standard pad.
 *
 * @example
 * ```ts
 * resolveGamepadRemap({ id: "Pro Controller (Nintendo)", mapping: "", buttons: [], axes: [] });
 * ```
 *
 * @public
 */
export function resolveGamepadRemap(snapshot: GamepadSnapshot): GamepadRemap | null {
  if (snapshot.mapping === "standard") {
    return null;
  }
  const id = snapshot.id.toLowerCase();
  for (const remap of GAMEPAD_REMAPS) {
    if (id.includes(remap.id)) {
      return remap;
    }
  }
  return null;
}

/**
 * A game controller (`docs/architecture/08-input.md` §4). Values are refreshed once per frame from
 * `navigator.getGamepads()`; the Gamepad API has no events for axis motion, so polling is the only
 * option and it happens in `PreUpdate` with everything else.
 *
 * @example
 * ```ts
 * const pad = app.input.gamepads[0];
 * if (pad.isConnected) {
 *   pad.rumble(0.6, 0.2);
 * }
 * ```
 *
 * @public
 */
export class GamepadDevice extends InputDevice {
  #id = "";

  #actuator: VibrationActuatorLike | null = null;

  readonly #leftStick: ControlDescriptor;

  readonly #rightStick: ControlDescriptor;

  readonly #dpad: ControlDescriptor;

  readonly #buttons: readonly ControlDescriptor[];

  readonly #dpadButtons: readonly ControlDescriptor[];

  /**
   * Builds one gamepad slot. Slots exist from app start and report `isConnected === false` until a
   * pad appears in them.
   *
   * @param slot - The slot index, `0` through `3`.
   */
  constructor(slot: number) {
    const specs: ControlSpec[] = [
      { name: "leftStick", kind: ControlKind.vector2 },
      { name: "rightStick", kind: ControlKind.vector2 },
      { name: "dpad", kind: ControlKind.vector2 },
    ];
    for (const entry of STANDARD_BUTTONS) {
      const isTrigger = TRIGGER_CONTROLS.includes(entry[0]);
      specs.push({ name: entry[0], kind: isTrigger ? ControlKind.axis : ControlKind.button });
    }
    super(DeviceKind.gamepad, slot, specs, false);
    // The three vector controls are declared first, so their descriptors are the first three
    // entries of the table; the sixteen buttons follow in `STANDARD_BUTTONS` order. Resolving them
    // positionally keeps the constructor free of name lookups and of an unreachable failure path.
    const controls = this.controls;
    this.#leftStick = controlAt(controls, 0);
    this.#rightStick = controlAt(controls, 1);
    this.#dpad = controlAt(controls, 2);
    const buttons: ControlDescriptor[] = [];
    for (let index = 0; index < STANDARD_BUTTONS.length; index += 1) {
      buttons.push(controlAt(controls, 3 + index));
    }
    this.#buttons = buttons;
    const dpadFirst = 3 + STANDARD_BUTTONS.length - 4;
    this.#dpadButtons = [
      controlAt(controls, dpadFirst),
      controlAt(controls, dpadFirst + 1),
      controlAt(controls, dpadFirst + 2),
      controlAt(controls, dpadFirst + 3),
    ];
  }

  /**
   * The pad's `id` string, or `""` when the slot is empty.
   *
   * @returns The identifier the browser reports.
   */
  get id(): string {
    return this.#id;
  }

  /**
   * Writes one frame's reading into the device's controls.
   *
   * @param snapshot - The pad reading, or `null` when the slot is empty.
   *
   * @internal
   */
  applySnapshot(snapshot: GamepadSnapshot | null): void {
    if (snapshot === null) {
      this.#id = "";
      this.#actuator = null;
      this.setConnected(false);
      return;
    }
    this.#id = snapshot.id;
    this.setConnected(true);
    const remap = resolveGamepadRemap(snapshot);
    const buttons = snapshot.buttons;
    const axes = snapshot.axes;
    for (let index = 0; index < this.#buttons.length; index += 1) {
      const control = this.#buttons[index];
      if (control === undefined) {
        continue;
      }
      const raw = remap === null ? index : (remap.buttons[index] ?? -1);
      this.write(control, raw < 0 ? 0 : (buttons[raw] ?? 0));
    }
    const axisIndex = (standard: number): number => (remap === null ? standard : (remap.axes[standard] ?? standard));
    this.writeVector(this.#leftStick, axes[axisIndex(0)] ?? 0, -(axes[axisIndex(1)] ?? 0));
    this.writeVector(this.#rightStick, axes[axisIndex(2)] ?? 0, -(axes[axisIndex(3)] ?? 0));
    this.#syncDpad();
  }

  /**
   * Stores the haptic actuator the browser handed out with the pad.
   *
   * @param actuator - The actuator, or `null` when the pad has none.
   *
   * @internal
   */
  setActuator(actuator: VibrationActuatorLike | null): void {
    this.#actuator = actuator;
  }

  /**
   * Plays a dual-rumble effect, when the pad exposes a haptic actuator
   * (`docs/architecture/08-input.md` §4).
   *
   * @param intensity - Motor magnitude in `[0, 1]`; values outside are clamped.
   * @param seconds - How long the effect lasts.
   * @returns `true` when an effect was started, `false` when the pad has no actuator.
   *
   * @example
   * ```ts
   * app.input.gamepads[0].rumble(1, 0.15);
   * ```
   */
  rumble(intensity: number, seconds: number): boolean {
    const actuator = this.#actuator;
    if (actuator === null) {
      return false;
    }
    const magnitude = Math.min(1, Math.max(0, intensity));
    const effect = actuator.playEffect("dual-rumble", {
      duration: Math.max(0, seconds) * MILLISECONDS_PER_SECOND,
      strongMagnitude: magnitude,
      weakMagnitude: magnitude,
    });
    // A pad that disconnects mid-effect rejects; there is nothing to report and nothing to retry,
    // so the rejection is swallowed deliberately rather than reaching an unhandled-rejection
    // handler (coding standards §8).
    void effect.catch((): void => undefined);
    return true;
  }

  /** Recomputes the synthesised `dpad` vector from the four d-pad buttons. */
  #syncDpad(): void {
    const up = this.valueAt(this.#dpadButtons[0]?.offset ?? 0);
    const down = this.valueAt(this.#dpadButtons[1]?.offset ?? 0);
    const left = this.valueAt(this.#dpadButtons[2]?.offset ?? 0);
    const right = this.valueAt(this.#dpadButtons[3]?.offset ?? 0);
    this.writeVector(this.#dpad, right - left, up - down);
  }
}

/**
 * Reads one entry of a control table, with the empty descriptor as the out-of-range answer.
 *
 * @param controls - The device's control table.
 * @param index - The entry to read.
 * @returns The descriptor, or a harmless zero-slot stand-in when the index is out of range.
 */
function controlAt(controls: readonly ControlDescriptor[], index: number): ControlDescriptor {
  return controls[index] ?? { name: "", index: -1, offset: -1, kind: ControlKind.button, components: 1 };
}
