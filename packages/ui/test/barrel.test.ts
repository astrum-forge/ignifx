import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The public surface, locked (coding standards §4). The umbrella package re-exports this list by
 * name, so an accidental addition or removal shows up here first rather than in `packages/ignifx`.
 *
 * `VERSION` and `describeSchemas` are exported by this package but are **not** re-exported by the
 * umbrella: `@ignifx/core` owns both names there. `LiteFont` is the third: it is core's alias for
 * the same Babylon Lite `Font`, re-exported here so a game can name the type without importing
 * core, and it would collide in the umbrella.
 */

/** Every value the barrel exports at run time, sorted. */
const RUNTIME_EXPORTS: readonly string[] = [
  "Dialog",
  "HUD_ANCHORS",
  "HudText",
  "I18N_ASSET_TYPE",
  "I18N_FILE_EXTENSIONS",
  "I18N_FORMAT",
  "I18N_FORMAT_VERSION",
  "I18nService",
  "LoadingScreen",
  "LocaleAsset",
  "TEXT_ALIGNMENTS",
  "TextComponent",
  "TextRuntime",
  "Toast",
  "UI_CLASS_NAMES",
  "UI_CSS_VARIABLES",
  "UI_ERROR_MESSAGES",
  "UI_FOCUS_ATTRIBUTE",
  "UI_LAYER_Z_STEP",
  "UI_SCALING_MODES",
  "UI_SETTINGS_SECTION",
  "UI_STYLE_ELEMENT_ID",
  "UI_SYNC_ORDER",
  "UiErrorCode",
  "UiHost",
  "UiLayer",
  "UiSystem",
  "VERSION",
  "VirtualButton",
  "VirtualJoystick",
  "WorldAnchor",
  "WorldText",
  "WorldText2D",
  "asDomCanvas",
  "computeAnchorPlacement",
  "computeHudPlacement",
  "computePivotPlacement",
  "computeUiLayout",
  "createLocaleLoader",
  "createPluralSelector",
  "defaultUiSettings",
  "describeLocaleFileFormat",
  "describeSchemas",
  "findVirtualDevice",
  "isEditableElement",
  "localeFileSchema",
  "localeJsonSchema",
  "parseLocaleFile",
  "parseMessage",
  "pixelMapping",
  "progressFraction",
  "renderMessage",
  "resolveDomTarget",
  "stickAxis",
  "ui",
  "uiError",
  "uiSettingsSchema",
];

describe("@ignifx/ui barrel", () => {
  it("exports exactly the documented list, and nothing at import time", () => {
    expect(Object.keys(barrel).toSorted()).toEqual([...RUNTIME_EXPORTS]);
  });

  it("names the version the extension reports", () => {
    expect(barrel.VERSION).toBe("0.0.0");
  });

  it("keeps every error code inside the 13xx range this package owns", () => {
    for (const code of Object.values(barrel.UiErrorCode)) {
      expect(code, code).toMatch(/^IGX-13\d\d$/u);
    }
  });
});
