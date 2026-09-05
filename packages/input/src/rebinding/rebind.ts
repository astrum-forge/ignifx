import { ControlKind } from "../devices/control.js";
import type { InputAction } from "../actions/action.js";
import type { ControlDescriptor } from "../devices/control.js";
import type { InputDevice } from "../devices/device.js";
import type { InputDevices } from "../devices/devices.js";

/**
 * Interactive rebinding (`docs/architecture/08-input.md` §6). A rebind listens for the next control
 * the player actuates and writes its path into one of an action's bindings as an override.
 *
 * Unity's disambiguation rule applies: within one frame the **highest-magnitude** actuation wins, so
 * a stick pushed diagonally rebinds to the stick rather than to whichever axis crossed the
 * threshold first.
 */

/** Control names that can never be rebound to, because they are never at rest. */
const NEVER_REBINDABLE: readonly string[] = Object.freeze(["anyKey", "touchCount"]);

/** Name fragments that mark a continuous control a rebind must ignore. */
const CONTINUOUS_SUFFIXES: readonly string[] = Object.freeze(["position", "delta", "scroll"]);

/**
 * Options accepted by `app.input.performInteractiveRebind`.
 *
 * @public
 */
export interface InteractiveRebindOptions {
  /** Which of the action's bindings to override. Defaults to `0`. */
  readonly bindingIndex?: number;
  /** Paths the rebind refuses to bind to, for example the movement keys. */
  readonly excludePaths?: readonly string[];
  /** A path that cancels the rebind when actuated, usually `<Keyboard>/escape`. */
  readonly cancelPath?: string;
  /** How long to listen before giving up, in unscaled seconds. `0` waits forever. */
  readonly timeoutSeconds?: number;
  /** The magnitude a control must reach to count as actuated. Defaults to `0.5`. */
  readonly magnitudeThreshold?: number;
}

/**
 * What `app.input.performInteractiveRebind` resolves with.
 *
 * @public
 */
export interface InteractiveRebindResult {
  /** The action that was being rebound. */
  readonly action: InputAction;
  /** The binding index that was being rebound. */
  readonly bindingIndex: number;
  /** The path the player chose, or `null` when the rebind was cancelled or timed out. */
  readonly path: string | null;
  /** Whether the cancel control ended the rebind. */
  readonly canceled: boolean;
  /** Whether the timeout ended the rebind. */
  readonly timedOut: boolean;
}

/**
 * One rebind in flight. The `PreUpdate` resolution drives it once per frame.
 *
 * @internal
 */
export class RebindOperation {
  /** The action being rebound. */
  readonly action: InputAction;

  /** The binding index being rebound. */
  readonly bindingIndex: number;

  readonly #excluded: readonly string[];

  readonly #cancelPath: string;

  readonly #timeoutSeconds: number;

  readonly #threshold: number;

  #elapsed = 0;

  /**
   * Starts a rebind.
   *
   * @param action - The action being rebound.
   * @param options - Binding index, exclusions, cancel path, timeout, and threshold.
   */
  constructor(action: InputAction, options: InteractiveRebindOptions) {
    this.action = action;
    this.bindingIndex = options.bindingIndex ?? 0;
    this.#excluded = options.excludePaths ?? [];
    this.#cancelPath = options.cancelPath ?? "";
    this.#timeoutSeconds = options.timeoutSeconds ?? 0;
    this.#threshold = options.magnitudeThreshold ?? 0.5;
  }

  /**
   * Advances the rebind by one frame.
   *
   * @param devices - The device table to scan.
   * @param unscaledDeltaTime - Seconds since the previous frame, unaffected by `timeScale`.
   * @returns The result once the rebind is finished, or `null` while it is still listening.
   */
  update(devices: InputDevices, unscaledDeltaTime: number): InteractiveRebindResult | null {
    this.#elapsed += unscaledDeltaTime;
    let bestPath: string | null = null;
    let best = this.#threshold;
    for (const device of devices.all) {
      if (!device.isConnected) {
        continue;
      }
      for (const control of device.controls) {
        if (!isRebindable(control)) {
          continue;
        }
        const magnitude = magnitudeOf(device, control);
        if (magnitude < best) {
          continue;
        }
        const path = controlPath(device, control);
        if (path === this.#cancelPath) {
          return { action: this.action, bindingIndex: this.bindingIndex, path: null, canceled: true, timedOut: false };
        }
        if (this.#excluded.includes(path)) {
          continue;
        }
        best = magnitude;
        bestPath = path;
      }
    }
    if (bestPath !== null) {
      return {
        action: this.action,
        bindingIndex: this.bindingIndex,
        path: bestPath,
        canceled: false,
        timedOut: false,
      };
    }
    if (this.#timeoutSeconds > 0 && this.#elapsed >= this.#timeoutSeconds) {
      return { action: this.action, bindingIndex: this.bindingIndex, path: null, canceled: false, timedOut: true };
    }
    return null;
  }

  /**
   * Builds the result for a rebind the service cancelled itself.
   *
   * @returns A cancelled result.
   */
  cancel(): InteractiveRebindResult {
    return { action: this.action, bindingIndex: this.bindingIndex, path: null, canceled: true, timedOut: false };
  }
}

/**
 * Whether a control is something a player can deliberately actuate once.
 *
 * @param control - The control to test.
 * @returns `false` for positions, deltas, wheels, and the aggregate controls.
 */
function isRebindable(control: ControlDescriptor): boolean {
  if (NEVER_REBINDABLE.includes(control.name)) {
    return false;
  }
  for (const suffix of CONTINUOUS_SUFFIXES) {
    if (control.name.endsWith(suffix)) {
      return false;
    }
  }
  return true;
}

/**
 * How far a control is actuated.
 *
 * @param device - The control's device.
 * @param control - The control.
 * @returns The magnitude: the absolute value, or the vector's length.
 */
function magnitudeOf(device: InputDevice, control: ControlDescriptor): number {
  if (control.kind === ControlKind.vector2) {
    return Math.hypot(device.valueAt(control.offset), device.valueAt(control.offset + 1));
  }
  return Math.abs(device.valueAt(control.offset));
}

/**
 * Builds the binding path of one control.
 *
 * @param device - The control's device.
 * @param control - The control.
 * @returns The path, with the `{index}` segment only when the device index is not `0`.
 *
 * @public
 */
export function controlPath(device: InputDevice, control: ControlDescriptor): string {
  const index = device.deviceIndex === 0 ? "" : `{${String(device.deviceIndex)}}`;
  return `<${device.kind}>${index}/${control.name}`;
}
