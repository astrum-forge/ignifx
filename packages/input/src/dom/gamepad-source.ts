import type { GamepadDevice, GamepadSnapshot, VibrationActuatorLike } from "../devices/gamepad.js";

/**
 * The gamepad adapter (`docs/architecture/08-input.md` §4). The Gamepad API has no events for stick
 * motion, so pads are **polled** once per frame from inside the `PreUpdate` system, alongside the
 * queue drain.
 *
 * Connection is discovered by the same poll rather than by `gamepadconnected`: browsers hide a pad
 * from `navigator.getGamepads()` until the player presses a button on it, so the poll is the
 * authority either way and one code path is easier to reason about than two.
 */

/**
 * The subset of the DOM `Gamepad` object this package reads.
 *
 * @public
 */
export interface GamepadLike {
  /** The pad's identifier string. */
  readonly id: string;
  /** The pad's mapping: `"standard"`, `"xr-standard"`, or `""`. */
  readonly mapping: string;
  /** Whether the pad is still present. */
  readonly connected: boolean;
  /** The pad's buttons, in its raw order. */
  readonly buttons: readonly { readonly value: number }[];
  /** The pad's axes, in its raw order. */
  readonly axes: readonly number[];
  /** The haptic actuator, when the pad has one. */
  readonly vibrationActuator?: VibrationActuatorLike | null;
}

/**
 * How one frame's pads are read. Injecting it is what makes the mapping testable in Node.
 *
 * @public
 */
export type GamepadReader = () => readonly (GamepadLike | null)[];

/** The mutable snapshot the poller reuses so a poll allocates nothing. */
interface MutableSnapshot {
  id: string;
  mapping: string;
  buttons: number[];
  axes: number[];
}

/**
 * The per-frame gamepad poll.
 *
 * @internal
 */
export class GamepadPoller {
  readonly #snapshot: MutableSnapshot = { id: "", mapping: "", buttons: [], axes: [] };

  #reader: GamepadReader | null = null;

  /**
   * Installs the reader the poll goes through.
   *
   * @param reader - The reader, or `null` to poll nothing.
   */
  setReader(reader: GamepadReader | null): void {
    this.#reader = reader;
  }

  /**
   * Whether polling is wired up at all.
   *
   * @returns `true` when a reader is installed.
   */
  get isEnabled(): boolean {
    return this.#reader !== null;
  }

  /**
   * Reads every slot and writes the values into the devices.
   *
   * @param devices - The gamepad slots, in slot order.
   * @param onConnected - Called with a slot that has just become occupied.
   * @param onDisconnected - Called with a slot that has just become empty.
   * @returns How many slots are occupied.
   */
  poll(
    devices: readonly GamepadDevice[],
    onConnected: (device: GamepadDevice) => void,
    onDisconnected: (device: GamepadDevice) => void,
  ): number {
    const reader = this.#reader;
    let connected = 0;
    const pads = reader === null ? EMPTY_PADS : reader();
    for (let slot = 0; slot < devices.length; slot += 1) {
      const device = devices[slot];
      if (device === undefined) {
        continue;
      }
      const pad = pads[slot] ?? null;
      const present = pad !== null && pad.connected;
      const was = device.isConnected;
      if (!present) {
        device.applySnapshot(null);
        if (was) {
          onDisconnected(device);
        }
        continue;
      }
      device.applySnapshot(this.#fill(pad));
      device.setActuator(pad.vibrationActuator ?? null);
      connected += 1;
      if (!was) {
        onConnected(device);
      }
    }
    return connected;
  }

  /**
   * Copies one pad's reading into the reused snapshot.
   *
   * @param pad - The pad the browser handed out.
   * @returns The snapshot, valid until the next call.
   */
  #fill(pad: GamepadLike): GamepadSnapshot {
    const snapshot = this.#snapshot;
    snapshot.id = pad.id;
    snapshot.mapping = pad.mapping;
    snapshot.buttons.length = pad.buttons.length;
    for (let index = 0; index < pad.buttons.length; index += 1) {
      snapshot.buttons[index] = pad.buttons[index]?.value ?? 0;
    }
    snapshot.axes.length = pad.axes.length;
    for (let index = 0; index < pad.axes.length; index += 1) {
      snapshot.axes[index] = pad.axes[index] ?? 0;
    }
    return snapshot;
  }
}

/** Returned when no reader is installed; shared so the poll allocates nothing. */
const EMPTY_PADS: readonly (GamepadLike | null)[] = Object.freeze([]);

/**
 * The reader that goes through `navigator.getGamepads()`, or `null` when the host has no Gamepad
 * API (Node, and browsers with the feature switched off).
 *
 * @returns The reader, or `null`.
 *
 * @public
 */
export function createNavigatorGamepadReader(): GamepadReader | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return null;
  }
  return (): readonly (GamepadLike | null)[] => navigator.getGamepads();
}
