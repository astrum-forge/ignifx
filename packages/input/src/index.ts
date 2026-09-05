/**
 * `@ignifx/input` public barrel: devices, action maps, bindings, composites and processors, control
 * schemes, the `.input.json` asset, pointer lock, the cursor, rebinding, and `PlayerInput`
 * (`docs/architecture/08-input.md`). Explicit named re-exports only — no `export *`
 * (coding standards §4).
 *
 * @packageDocumentation
 */

// Type-only side effect: the module declares `app.input` on `@ignifx/core`'s `App`, and naming it
// here is what keeps the augmentation in the bundled declarations. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// actions — what game code binds to, and the maps that group them.
export { ActionMap } from "./actions/action-map.js";
export { ActionVector, InputAction, type InputActionEvent, type InputActionSignal } from "./actions/action.js";
export { InputActionsView } from "./actions/actions-view.js";
export { pinToDeviceSlot } from "./actions/device-slot.js";
export { ControlSchemes } from "./actions/schemes.js";

// asset — the `ignifx.inputactions` document, its loader, and its schemas.
export {
  defineInputActions,
  INPUT_ACTIONS_ASSET_TYPE,
  INPUT_ACTIONS_FILE_EXTENSIONS,
  INPUT_ACTIONS_FORMAT,
  INPUT_ACTIONS_FORMAT_VERSION,
  type ActionDefinition,
  type ActionMapDefinition,
  type BindingDefinition,
  type ControlSchemeDefinition,
  type InputActionsDefinition,
  type InputActionsInput,
  type InputActionType,
} from "./asset/definition.js";
export { InputActionsAsset } from "./asset/input-actions-asset.js";
export { createInputActionsLoader } from "./asset/loader.js";
export { describeInputActionsFormat, inputActionsJsonSchema } from "./asset/schemas.js";
export { validateInputActions } from "./asset/validate.js";

// bindings — the path grammar, the composites, and the processor chain.
export { Binding, type BindingContext, type BindingResolver } from "./bindings/binding.js";
export { CompositeKind, compositeIsVector, compositeParts, parseComposite } from "./bindings/composites.js";
export { parseControlPath, type ParsedControlPath } from "./bindings/path.js";
export {
  applyProcessors,
  parseProcessor,
  parseProcessors,
  ProcessorKind,
  type ControlValue,
  type Processor,
} from "./bindings/processors.js";

// components — the optional per-player component.
export { PlayerInput } from "./components/player-input.js";

// devices — the control tables and the values behind them.
export {
  buildControls,
  ControlKind,
  controlSlotCount,
  type ControlDescriptor,
  type ControlSpec,
} from "./devices/control.js";
export { DEVICE_KINDS, DeviceKind, InputDevice, type ControlTouchHandler } from "./devices/device.js";
export { InputDevices, type ControlRef } from "./devices/devices.js";
export {
  GAMEPAD_REMAPS,
  GAMEPAD_SLOTS,
  GamepadDevice,
  gamepadControlNames,
  resolveGamepadRemap,
  type GamepadRemap,
  type GamepadSnapshot,
  type VibrationActuatorLike,
  type VibrationEffectParameters,
} from "./devices/gamepad.js";
export {
  ANY_KEY_CONTROL,
  createKeyboardDevice,
  keyboardControlNames,
  keyCodeControlNames,
} from "./devices/keyboard.js";
export {
  createMouseDevice,
  createPointerDevice,
  createTouchDevice,
  mouseControlNames,
  TOUCH_SLOTS,
  touchControlNames,
} from "./devices/pointing.js";
export { VirtualDevice } from "./devices/virtual.js";

// dom — the browser wiring, pointer lock, and the cursor.
export { Cursor } from "./dom/cursor.js";
export type { DomSource, DomTarget } from "./dom/dom-target.js";
export type { InputEventRecord, InputEventType } from "./dom/event-queue.js";
export { createNavigatorGamepadReader, type GamepadLike, type GamepadReader } from "./dom/gamepad-source.js";
export { PointerLock } from "./dom/pointer-lock.js";

// errors — the `IGX-08##` code space this package owns.
export { INPUT_ERROR_MESSAGES, inputError, InputErrorCode, type InputErrorOptions } from "./errors.js";

// extension — the factory a game registers.
export { input, type InputOptions } from "./extension.js";

// rebinding — interactive rebinding and override persistence.
export {
  applyOverrides,
  clearOverrides,
  collectOverrides,
  INPUT_OVERRIDES_FORMAT,
  INPUT_OVERRIDES_FORMAT_VERSION,
  type InputOverrideEntry,
  type InputOverridesJson,
} from "./rebinding/overrides.js";
export { controlPath, type InteractiveRebindOptions, type InteractiveRebindResult } from "./rebinding/rebind.js";

// schemas — what `pnpm docs:schemas` reads.
export { describeInputSchemas, describeSchemas } from "./schemas.js";

// service — `app.input` itself.
export {
  INPUT_DIAGNOSTICS_COUNTERS,
  INPUT_DIAGNOSTICS_GROUP,
  InputActionSet,
  InputService,
  type ActionSetOptions,
  type InputServiceOptions,
  type SimulatedEvent,
  type SimulatedValue,
} from "./service/input-service.js";
export { INPUT_RESOLVE_ORDER } from "./service/input-system.js";

// settings — the `input` project settings section.
export {
  defaultInputSettings,
  INPUT_SETTINGS_SECTION,
  inputSettingsSchema,
  type InputSettings,
  type PointerLockSettings,
} from "./settings.js";

// version — the package's own release line.
export { VERSION } from "./version.js";
