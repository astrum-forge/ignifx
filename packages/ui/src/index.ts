/**
 * `@ignifx/ui` public barrel: the DOM overlay host and its layers, the three scaling modes, input
 * focus routing, `WorldAnchor`, the three text components on Babylon Lite's text renderer, the
 * touch, menu and dialog helpers, and `app.i18n` (`docs/architecture/13-ui.md`). Explicit named
 * re-exports only — no `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

// Type-only side effect: the module declares `app.ui` and `app.i18n` on `@ignifx/core`'s `App`, and
// naming it here is what keeps the augmentation in the bundled declarations. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// dom — the overlay host, its layers, the scaling arithmetic, the stylesheet, and focus routing.
export type { UiDomTarget } from "./dom/dom-target.js";
export { isEditableElement, UI_FOCUS_ATTRIBUTE } from "./dom/focus.js";
export { UiHost } from "./dom/host.js";
export { UiLayer, type UiLayerOptions } from "./dom/layer.js";
export {
  computeUiLayout,
  pixelMapping,
  type UiLayout,
  type UiPixelMapping,
  type UiSurfaceMetrics,
} from "./dom/scaling.js";
export { UI_CLASS_NAMES, UI_CSS_VARIABLES, UI_DIALOG_Z_INDEX, UI_STYLE_ELEMENT_ID } from "./dom/styles.js";

// errors — the `IGX-13xx` code space this package owns.
export { UI_ERROR_MESSAGES, uiError, UiErrorCode, type UiErrorOptions } from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { ui, type UiOptions } from "./extension.js";

// i18n — the localization service, the `ignifx.i18n` document, and its message grammar.
export { I18nService } from "./i18n/i18n-service.js";
export { createLocaleLoader } from "./i18n/loader.js";
export {
  describeLocaleFileFormat,
  I18N_ASSET_TYPE,
  I18N_FILE_EXTENSIONS,
  I18N_FORMAT,
  I18N_FORMAT_VERSION,
  LocaleAsset,
  localeFileSchema,
  localeJsonSchema,
  parseLocaleFile,
  type LocaleDocument,
} from "./i18n/locale-file.js";
export {
  createPluralSelector,
  parseMessage,
  renderMessage,
  type ArgumentNode,
  type MessageNode,
  type MessageParams,
  type MessagePattern,
  type PluralNode,
  type PluralSelector,
  type TextNode,
} from "./i18n/message.js";

// lite — the type aliases the `.lite` escape hatches name in their signatures.
export type {
  LiteFont,
  LiteTextData,
  LiteTextLayer,
  LiteTextRenderable,
  LiteTextRenderer,
  TextMetrics,
} from "./lite/text.js";

// schemas — what `pnpm docs:schemas` reads.
export { describeSchemas } from "./schemas.js";

// settings — the `ui` project settings section.
export {
  defaultUiSettings,
  UI_LAYER_Z_STEP,
  UI_SCALING_MODES,
  UI_SETTINGS_SECTION,
  uiSettingsSchema,
  type UiScalingMode,
  type UiSettings,
} from "./settings.js";

// text — the three text components and the arithmetic that places them.
export {
  computeHudPlacement,
  computePivotPlacement,
  HUD_ANCHORS,
  type HudAnchor,
  type HudPlacement,
  type HudPlacementInput,
} from "./text/hud-layout.js";
export { HudText } from "./text/hud-text.js";
export { TEXT_ALIGNMENTS, TextComponent, type TextAlignment } from "./text/text-component.js";
export { WorldText } from "./text/world-text.js";
export { WorldText2D } from "./text/world-text-2d.js";

// version — what `Extension.version` reports.
export { VERSION } from "./version.js";

// widgets — the DOM helpers templates build their menus and touch controls out of.
export { Dialog, type DialogButton, type DialogOptions } from "./widgets/dialog.js";
export { LoadingScreen, progressFraction, type LoadingScreenOptions } from "./widgets/loading-screen.js";
export { Menu, type MenuOptions } from "./widgets/menu.js";
export {
  formatBindingPath,
  resolveMenuChoices,
  resolveMenuLabel,
  snapToStep,
  type MenuActionRow,
  type MenuBindingRow,
  type MenuChoiceRow,
  type MenuChoiceValues,
  type MenuHeadingRow,
  type MenuLabel,
  type MenuRow,
  type MenuRowBase,
  type MenuSeparatorRow,
  type MenuSliderRow,
  type MenuText,
  type MenuToggleRow,
} from "./widgets/menu-row.js";
export {
  MenuStack,
  type MenuButtonSource,
  type MenuNavigation,
  type MenuStackOptions,
  type MenuVectorSource,
} from "./widgets/menu-stack.js";
export { Toast, type ToastOptions } from "./widgets/toast.js";
export { VirtualButton, type VirtualButtonOptions } from "./widgets/virtual-button.js";
export { findVirtualDevice, type VirtualDeviceLike } from "./widgets/virtual-device.js";
export { stickAxis, VirtualJoystick, type VirtualJoystickOptions } from "./widgets/virtual-joystick.js";

// world — the entity-to-element anchor and the `PreRender` system that drives everything.
export { computeAnchorPlacement, type AnchorInput, type AnchorPlacement } from "./world/anchor-math.js";
export { UI_SYNC_ORDER, UiSystem } from "./world/ui-system.js";
export { WorldAnchor } from "./world/world-anchor.js";
