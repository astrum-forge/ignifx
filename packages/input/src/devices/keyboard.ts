import { ControlKind } from "./control.js";
import { DeviceKind, InputDevice } from "./device.js";
import type { ControlSpec } from "./control.js";

/**
 * The keyboard layout (`docs/architecture/08-input.md` §3, the Keyboard row). Controls are named
 * after the **physical** `KeyboardEvent.code`, so `<Keyboard>/w` is the key in the W position on
 * every layout — WASD keeps working on AZERTY.
 *
 * The control name is the code in camelCase with the `Key` and `Digit` prefixes dropped:
 * `KeyW` becomes `w`, `Digit1` becomes `1`, `ShiftLeft` becomes `shiftLeft`, `ArrowUp` becomes
 * `arrowUp`, `Space` becomes `space`. The table below is written out rather than derived so the
 * indices are stable across releases and so the set is a closed, documented list.
 */

/** The `KeyboardEvent.code` values this build knows, paired with the control name they map to. */
const KEY_CODES: readonly (readonly [string, string])[] = Object.freeze([
  ["KeyA", "a"],
  ["KeyB", "b"],
  ["KeyC", "c"],
  ["KeyD", "d"],
  ["KeyE", "e"],
  ["KeyF", "f"],
  ["KeyG", "g"],
  ["KeyH", "h"],
  ["KeyI", "i"],
  ["KeyJ", "j"],
  ["KeyK", "k"],
  ["KeyL", "l"],
  ["KeyM", "m"],
  ["KeyN", "n"],
  ["KeyO", "o"],
  ["KeyP", "p"],
  ["KeyQ", "q"],
  ["KeyR", "r"],
  ["KeyS", "s"],
  ["KeyT", "t"],
  ["KeyU", "u"],
  ["KeyV", "v"],
  ["KeyW", "w"],
  ["KeyX", "x"],
  ["KeyY", "y"],
  ["KeyZ", "z"],
  ["Digit0", "0"],
  ["Digit1", "1"],
  ["Digit2", "2"],
  ["Digit3", "3"],
  ["Digit4", "4"],
  ["Digit5", "5"],
  ["Digit6", "6"],
  ["Digit7", "7"],
  ["Digit8", "8"],
  ["Digit9", "9"],
  ["F1", "f1"],
  ["F2", "f2"],
  ["F3", "f3"],
  ["F4", "f4"],
  ["F5", "f5"],
  ["F6", "f6"],
  ["F7", "f7"],
  ["F8", "f8"],
  ["F9", "f9"],
  ["F10", "f10"],
  ["F11", "f11"],
  ["F12", "f12"],
  ["Escape", "escape"],
  ["Space", "space"],
  ["Enter", "enter"],
  ["Tab", "tab"],
  ["Backspace", "backspace"],
  ["Delete", "delete"],
  ["Insert", "insert"],
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "pageUp"],
  ["PageDown", "pageDown"],
  ["CapsLock", "capsLock"],
  ["ContextMenu", "contextMenu"],
  ["ArrowUp", "arrowUp"],
  ["ArrowDown", "arrowDown"],
  ["ArrowLeft", "arrowLeft"],
  ["ArrowRight", "arrowRight"],
  ["ShiftLeft", "shiftLeft"],
  ["ShiftRight", "shiftRight"],
  ["ControlLeft", "controlLeft"],
  ["ControlRight", "controlRight"],
  ["AltLeft", "altLeft"],
  ["AltRight", "altRight"],
  ["MetaLeft", "metaLeft"],
  ["MetaRight", "metaRight"],
  ["Minus", "minus"],
  ["Equal", "equal"],
  ["BracketLeft", "bracketLeft"],
  ["BracketRight", "bracketRight"],
  ["Backslash", "backslash"],
  ["Semicolon", "semicolon"],
  ["Quote", "quote"],
  ["Backquote", "backquote"],
  ["Comma", "comma"],
  ["Period", "period"],
  ["Slash", "slash"],
  ["IntlBackslash", "intlBackslash"],
  ["Numpad0", "numpad0"],
  ["Numpad1", "numpad1"],
  ["Numpad2", "numpad2"],
  ["Numpad3", "numpad3"],
  ["Numpad4", "numpad4"],
  ["Numpad5", "numpad5"],
  ["Numpad6", "numpad6"],
  ["Numpad7", "numpad7"],
  ["Numpad8", "numpad8"],
  ["Numpad9", "numpad9"],
  ["NumpadEnter", "numpadEnter"],
  ["NumpadAdd", "numpadAdd"],
  ["NumpadSubtract", "numpadSubtract"],
  ["NumpadMultiply", "numpadMultiply"],
  ["NumpadDivide", "numpadDivide"],
  ["NumpadDecimal", "numpadDecimal"],
  ["NumLock", "numLock"],
]);

/**
 * The control that is actuated while any other key is held
 * (`docs/architecture/08-input.md` §3, `<Keyboard>/anyKey`).
 *
 * @public
 */
export const ANY_KEY_CONTROL = "anyKey";

/**
 * The keyboard control names, in index order. `anyKey` is last.
 *
 * @returns The control names a `<Keyboard>/…` path may end in.
 *
 * @example
 * ```ts
 * keyboardControlNames().includes("shiftLeft"); // true
 * ```
 *
 * @public
 */
export function keyboardControlNames(): readonly string[] {
  const names: string[] = [];
  for (const entry of KEY_CODES) {
    names.push(entry[1]);
  }
  names.push(ANY_KEY_CONTROL);
  return names;
}

/**
 * The `KeyboardEvent.code` to control-name table, as a map the DOM adapter resolves through once
 * per event.
 *
 * @returns The lookup, built fresh so no module holds mutable state.
 *
 * @public
 */
export function keyCodeControlNames(): ReadonlyMap<string, string> {
  const table = new Map<string, string>();
  for (const entry of KEY_CODES) {
    table.set(entry[0], entry[1]);
  }
  return table;
}

/**
 * Builds the keyboard device.
 *
 * @returns A device whose controls are the physical keys plus `anyKey`.
 *
 * @public
 */
export function createKeyboardDevice(): InputDevice {
  const specs: ControlSpec[] = [];
  for (const name of keyboardControlNames()) {
    specs.push({ name, kind: ControlKind.button });
  }
  return new InputDevice(DeviceKind.keyboard, 0, specs);
}
