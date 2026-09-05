import { DeviceKind } from "../devices/device.js";
import { inputError, InputErrorCode } from "../errors.js";

/**
 * The binding path grammar (`docs/architecture/08-input.md` §3). A path names one control of one
 * device:
 *
 * ```text
 * <Device>/control
 * <Device>/group/control        sub-controls: <Gamepad>/dpad/up, <Touch>/touch0/position
 * <Device>{index}/control       a specific device of a family: <Gamepad>{1}/leftStick
 * ```
 *
 * The device index is written **after** the closing angle bracket and is **zero-based**, so
 * `<Gamepad>{0}` and `<Gamepad>` name the same pad — the one `app.input.gamepads[0]` reports and
 * the one a `PlayerInput` with `deviceSlot: 0` is paired with. Unity writes a one-based *player*
 * number in the same position; ignifx uses the slot index instead so that one number means one
 * thing everywhere in the engine.
 */

/**
 * A parsed binding path.
 *
 * @public
 */
export interface ParsedControlPath {
  /** The device family the path names. */
  readonly device: DeviceKind;
  /** Which device of the family, zero-based. `0` when the path carries no `{index}`. */
  readonly deviceIndex: number;
  /** The control name, sub-control segments included, for example `dpad/up`. */
  readonly control: string;
}

/** Every device family keyed by the token a path spells it with. */
const DEVICE_TOKENS: readonly DeviceKind[] = Object.freeze([
  DeviceKind.keyboard,
  DeviceKind.mouse,
  DeviceKind.pointer,
  DeviceKind.touch,
  DeviceKind.gamepad,
  DeviceKind.virtual,
]);

/**
 * Turns a device token into the family it names.
 *
 * @param token - The text between the angle brackets.
 * @returns The device family, or `null` when no family spells itself that way.
 */
function deviceFor(token: string): DeviceKind | null {
  for (const kind of DEVICE_TOKENS) {
    if (kind === token) {
      return kind;
    }
  }
  return null;
}

/**
 * Parses a binding path.
 *
 * @param path - The path, for example `<Gamepad>{1}/dpad/up`.
 * @returns The device family, the device index, and the control name.
 * @throws IgnifxError with code `IGX-0803` when the path is malformed or names an unknown device.
 *
 * @example
 * ```ts
 * parseControlPath("<Keyboard>/space"); // { device: "Keyboard", deviceIndex: 0, control: "space" }
 * ```
 *
 * @public
 */
export function parseControlPath(path: string): ParsedControlPath {
  if (!path.startsWith("<")) {
    throw badPath(path, "A binding path starts with a device in angle brackets, such as <Keyboard>/space.");
  }
  const close = path.indexOf(">");
  if (close < 0) {
    throw badPath(path, "The device token is missing its closing angle bracket.");
  }
  const device = deviceFor(path.slice(1, close));
  if (device === null) {
    throw badPath(path, `Known devices are ${DEVICE_TOKENS.join(", ")}.`);
  }
  let cursor = close + 1;
  let deviceIndex = 0;
  if (path[cursor] === "{") {
    const closeBrace = path.indexOf("}", cursor);
    if (closeBrace < 0) {
      throw badPath(path, "The device index is missing its closing brace, as in <Gamepad>{1}/leftStick.");
    }
    deviceIndex = parseDeviceIndex(path, path.slice(cursor + 1, closeBrace));
    cursor = closeBrace + 1;
  }
  if (path[cursor] !== "/") {
    throw badPath(path, "The device is followed by a slash and the control name, as in <Mouse>/delta.");
  }
  const control = path.slice(cursor + 1);
  if (control === "") {
    throw badPath(path, "The path names no control.");
  }
  return { device, deviceIndex, control };
}

/**
 * Reads the `{index}` of a path.
 *
 * @param path - The whole path, for the error message.
 * @param text - The text between the braces.
 * @returns The zero-based device index.
 * @throws IgnifxError with code `IGX-0803` when the text is not a non-negative integer.
 */
function parseDeviceIndex(path: string, text: string): number {
  const value = Number(text);
  if (text === "" || !Number.isInteger(value) || value < 0) {
    throw badPath(path, "The device index is a zero-based whole number, as in <Gamepad>{1}/leftStick.");
  }
  return value;
}

/**
 * Builds the `IGX-0803` failure.
 *
 * @param path - The offending path.
 * @param hint - What to write instead.
 * @returns The error to throw.
 */
function badPath(path: string, hint: string): Error {
  return inputError(InputErrorCode.invalidBindingPath, `${path} is not a valid binding path.`, {
    context: { path },
    hint,
  });
}
