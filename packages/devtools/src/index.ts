/**
 * `@ignifx/devtools` public barrel: the overlay and its nine panels, the schema-driven inspector,
 * the Console panel's log sink, the `devtools` settings section, and the `IGX-155x` code space
 * (`docs/architecture/15-devtools-and-diagnostics.md` §4). Explicit named re-exports only — no
 * `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

// Type-only side effect: the module declares `app.devtools` on `@ignifx/core`'s `App`, and naming
// it here is what keeps the augmentation in the bundled declarations. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// dom — the overlay's DOM target and the one stylesheet it injects.
export { asDomCanvas, resolveDevtoolsTarget, type DevtoolsDomTarget } from "./dom/dom-target.js";
export { DEVTOOLS_CLASS_NAMES, DEVTOOLS_STYLE_ELEMENT_ID } from "./dom/styles.js";

// errors — the `IGX-155x` code space this package owns.
export { DEVTOOLS_ERROR_MESSAGES, devtoolsError, DevtoolsErrorCode, type DevtoolsErrorOptions } from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { devtools, type DevtoolsOptions } from "./extension.js";

// log-sink — the Console panel's sink, which the game installs on `createApp`.
export {
  createDevtoolsLogSink,
  DEFAULT_DEVTOOLS_LOG_LIMIT,
  DEVTOOLS_LOG_LEVELS,
  type DevtoolsLogSink,
  type DevtoolsLogSinkOptions,
} from "./log-sink.js";

// overlay — the mounting constants a game needs to style or stack the overlay itself.
export { DEVTOOLS_LAYER_Z_INDEX, DEVTOOLS_UI_LAYER, TEXT_REFRESH_HZ } from "./overlay/overlay.js";

// service — `app.devtools`.
export {
  DEVTOOLS_ERROR_LIMIT,
  DEVTOOLS_HOT_RELOAD_LIMIT,
  DEVTOOLS_SAMPLE_ORDER,
  DevtoolsService,
  type DevtoolsPanelHandle,
  type DevtoolsServiceOptions,
} from "./service.js";

// settings — the `devtools` project settings section.
export {
  defaultDevtoolsSettings,
  DEVTOOLS_PANEL_NAMES,
  DEVTOOLS_POSITIONS,
  DEVTOOLS_SETTINGS_SECTION,
  devtoolsSettingsSchema,
  type DevtoolsPanelName,
  type DevtoolsPosition,
  type DevtoolsSettings,
} from "./settings.js";
