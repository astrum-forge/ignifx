import { defineExtension, Phase } from "@ignifx/core";
import { defineI18nAppProperty, defineUiAppProperty } from "./augmentation.js";
import { resolveDomTarget } from "./dom/dom-target.js";
import { UiHost } from "./dom/host.js";
import { uiError, UI_ERROR_MESSAGES, UiErrorCode } from "./errors.js";
import { I18nService } from "./i18n/i18n-service.js";
import { createLocaleLoader } from "./i18n/loader.js";
import {
  attachTextLayer,
  createRegisteredTextRenderer,
  destroyTextRenderer,
  detachTextLayer,
  enableTextDeviceLostRecovery,
} from "./lite/gpu/text-renderer.js";
import { defaultUiSettings, UI_SETTINGS_SECTION, uiSettingsSchema } from "./settings.js";
import { HudText } from "./text/hud-text.js";
import { TextRuntime } from "./text/text-runtime.js";
import { WorldText2D } from "./text/world-text-2d.js";
import { WorldText } from "./text/world-text.js";
import { VERSION } from "./version.js";
import { UI_SYNC_ORDER, UiSystem } from "./world/ui-system.js";
import { WorldAnchor } from "./world/world-anchor.js";
import type { UiDomTarget } from "./dom/dom-target.js";
import type { LocaleAsset } from "./i18n/locale-file.js";
import type { LiteTextRenderer } from "./lite/text.js";
import type { UiScalingMode, UiSettings } from "./settings.js";
import type { App, AssetHandle, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/ui` extension (`docs/architecture/04-extensions.md` §1, `13-ui.md`).
 * Registering it is the whole installation: `ui()` gives a game `app.ui`, `app.i18n`, four
 * components, the `i18n` asset type, the `ui` settings section, and the one `PreRender` system that
 * projects anchors and re-shapes text.
 *
 * ## What it needs, and what it does not
 *
 * `@ignifx/input` is an **optional** peer. The overlay host, the text components, and the
 * localization service work without it; only `VirtualJoystick` and `VirtualButton` need it, and
 * they say so with `IGX-1305`. The extension never imports it — it reaches
 * `app.input.uiHasFocus` structurally, for the reason `src/widgets/virtual-device.ts` records.
 *
 * ## Headless
 *
 * Everything registers headlessly. With no DOM canvas the host is inert (`13-ui.md` §1's
 * "the host hides itself in headless mode"*, read through `07-rendering.md` §6's rule that a
 * headless member is a documented no-op rather than a throw), no text renderer is created, and the
 * `PreRender` system still runs — so `WorldText` keeps its state and a test asserts on it.
 */

/**
 * What `ui()` accepts. Every field that names a settings value overrides the matching `ui` section
 * value, which is the shape `04-extensions.md` §1 shows for `physics()`.
 *
 * @public
 */
export interface UiOptions {
  /** How the overlay's coordinate system relates to the canvas. */
  readonly scaling?: UiScalingMode;
  /** The `[width, height]` the `"fit"` mode scales to. */
  readonly referenceResolution?: readonly number[];
  /** The layers created up front, back to front. */
  readonly layers?: readonly string[];
  /** Whether the overlay starts shown. */
  readonly visible?: boolean;
  /**
   * The address of a `.i18n.json` document to load into `app.i18n` at start-up. Empty loads
   * nothing; a game that ships one file per locale calls `app.i18n.load` itself.
   */
  readonly strings?: string;
  /** The locale the app starts in, before any document is loaded. Defaults to `"en"`. */
  readonly locale?: string;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `ui` section.
 * @param options - What the game passed to `ui(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: UiSettings, options: UiOptions): UiSettings {
  return {
    scaling: options.scaling ?? settings.scaling,
    referenceResolution: options.referenceResolution ?? settings.referenceResolution,
    layers: options.layers ?? settings.layers,
    visible: options.visible ?? settings.visible,
  };
}

/**
 * Builds the setter that writes `app.input.uiHasFocus`, or a no-op when `@ignifx/input` is not
 * registered.
 *
 * @remarks
 * `InputService.uiHasFocus` is a plain settable property whose own documentation says
 * "`@ignifx/ui` assigns it"* (`packages/input/src/service/input-service.ts` 340-349). This is that
 * assignment. It is looked up once, at registration, because `app.input` cannot appear later:
 * extensions all register before the first frame.
 *
 * @param app - The app being built.
 * @returns The setter.
 */
function inputFocusSetter(app: App): (value: boolean) => void {
  return inputFlagSetter(app, "uiHasFocus");
}

/**
 * Builds the setter for one of `@ignifx/input`'s two UI flags, or a no-op when the extension is
 * absent or predates the flag.
 * @param app - The app being built.
 * @param flag - `uiHasFocus` (a text field owns the keyboard) or `uiHasPointer` (a pointer is
 * pressed on the overlay).
 * @returns The setter.
 */
function inputFlagSetter(app: App, flag: "uiHasFocus" | "uiHasPointer"): (value: boolean) => void {
  const input: unknown = Reflect.get(app, "input");
  if (input === null || typeof input !== "object" || !(flag in input)) {
    return (): void => {
      // No input extension, or one without this flag: nothing consumes it, so nothing is written.
    };
  }
  return (value: boolean): void => {
    Reflect.set(input, flag, value);
  };
}

/**
 * The components the extension registers, in the order the API report lists them.
 *
 * @returns The classes.
 */
function components(): readonly [typeof WorldAnchor, typeof HudText, typeof WorldText, typeof WorldText2D] {
  return [WorldAnchor, HudText, WorldText, WorldText2D];
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `ui(...)`.
 * @throws IgnifxError with code `IGX-1301` when a second `ui()` is registered on one app.
 */
function registerUi(ctx: ExtensionContext, options: UiOptions): void {
  const app = ctx.app;
  // `Reflect.has` rather than `"ui" in app`: the augmentation in `./augmentation.js` declares the
  // property on `App`, so an `in` check narrows the negative branch to `never` and every later use
  // of `app` in this function stops type-checking.
  if (Reflect.has(app, "ui")) {
    throw uiError(UiErrorCode.duplicateExtension, "The ui() extension is already registered on this app.", {
      hint: "Register ui() once; pass its options to that one call.",
    });
  }
  ctx.registerErrorCodes(UI_ERROR_MESSAGES);
  ctx.registerSettings<UiSettings>(UI_SETTINGS_SECTION, uiSettingsSchema(), defaultUiSettings());
  const settings = mergeSettings(ctx.settings<UiSettings>(UI_SETTINGS_SECTION), options);
  const host = new UiHost({
    // A thunk, not a value: `AppImpl.initialize` registers every extension before it creates the
    // Lite engine, so `app.renderer.surface` throws `IGX-0107` here. `UiSystem.onWorldCreated`
    // calls `mount()` once the engine exists, still inside this `createApp` call.
    resolveTarget: (): UiDomTarget | null => (app.isHeadless ? null : resolveDomTarget(app.renderer.surface)),
    settings,
    log: ctx.log,
    setInputFocus: inputFocusSetter(app),
    setInputPointer: inputFlagSetter(app, "uiHasPointer"),
  });
  const i18n = new I18nService({ log: ctx.log, locale: options.locale ?? "en" });
  const runtime = new TextRuntime({
    createRenderer: app.isHeadless ? null : (): LiteTextRenderer => createRegisteredTextRenderer(app.lite.engine),
    attachLayer: attachTextLayer,
    detachLayer: detachTextLayer,
    destroyRenderer: destroyTextRenderer,
  });
  ctx.registerService(UiHost, host);
  ctx.registerService(I18nService, i18n);
  defineUiAppProperty(ctx, host);
  defineI18nAppProperty(ctx, i18n);
  ctx.registerAssetLoader(createLocaleLoader());
  ctx.registerComponents(components());
  ctx.registerSystem(new UiSystem({ app, host, runtime, i18n }), {
    phase: Phase.PreRender,
    order: UI_SYNC_ORDER,
  });
  let strings: AssetHandle<LocaleAsset> | null = null;
  if (options.strings !== undefined && options.strings !== "") {
    strings = app.assets.load<LocaleAsset>(options.strings);
    // Not awaited: delivery needs a frame and `register` runs before the first one
    // (`05-assets-and-loading.md` §4). Text that names an `i18nKey` shows the key until then.
    const handle = strings;
    void i18n.load(handle).catch((error: unknown): void => {
      app.onError.emit({ error, source: "extension", phase: null, entity: null, component: null });
    });
  }
  ctx.onDispose((): void => {
    runtime.dispose();
    host.dispose();
    i18n.dispose();
    strings?.release();
  });
}

/**
 * Turns on device-lost recovery for the text renderer.
 *
 * @param app - The app being started.
 */
function startUi(app: App): void {
  if (app.isHeadless || !app.renderer.features.deviceLostRecovery) {
    return;
  }
  enableTextDeviceLostRecovery(
    app.lite.engine,
    (): void => {
      app.log.info("UI text resources recovered after device loss.");
    },
    (error: unknown): void => {
      app.onError.emit({ error, source: "extension", phase: null, entity: null, component: null });
    },
  );
}

/**
 * The `@ignifx/ui` extension factory.
 *
 * @param options - Overrides for the `ui` settings section, plus the start-up translation document.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   extensions: [ui({ scaling: "fit", referenceResolution: [640, 360] })],
 * });
 * ```
 *
 * @public
 */
export const ui: (options?: UiOptions) => Extension = defineExtension<UiOptions | undefined>((raw) => {
  // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
  // game wrote `ui()`; the typed signature cannot express that, so the default lands here.
  const options: UiOptions = raw ?? {};
  return {
    name: "@ignifx/ui",
    version: VERSION,
    engine: ">=0.0.0 <1.0.0",
    requires: ["@ignifx/core"],
    register(ctx: ExtensionContext): void {
      registerUi(ctx, options);
    },
    onStart(app: App): void {
      startUi(app);
    },
  };
});
