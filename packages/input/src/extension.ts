import { defineExtension, Phase } from "@ignifx/core";
import { createInputActionsLoader } from "./asset/loader.js";
import { defineInputAppProperty } from "./augmentation.js";
import { PlayerInput } from "./components/player-input.js";
import { INPUT_ERROR_MESSAGES } from "./errors.js";
import { INPUT_DIAGNOSTICS_COUNTERS, INPUT_DIAGNOSTICS_GROUP, InputService } from "./service/input-service.js";
import { INPUT_RESOLVE_ORDER, InputSystem } from "./service/input-system.js";
import { defaultInputSettings, INPUT_SETTINGS_SECTION, inputSettingsSchema } from "./settings.js";
import { VERSION } from "./version.js";
import type { InputActionsAsset } from "./asset/input-actions-asset.js";
import type { GamepadReader } from "./dom/gamepad-source.js";
import type { InputSettings, PointerLockSettings } from "./settings.js";
import type { App, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/input` extension (`docs/architecture/04-extensions.md` §1). Registering it is the
 * whole installation: `createApp({ canvas, extensions: [input()] })` gives a game `app.input`, the
 * `inputactions` asset type, the `PlayerInput` component, the `input` settings section, the
 * `input` diagnostics group, and the `PreUpdate` system that resolves a frame's input before any
 * script callback runs.
 */

/**
 * What `input()` accepts. Every field overrides the matching `input` settings section value, which
 * is the shape `04-extensions.md` §1 shows for `physics()`.
 *
 * @public
 */
export interface InputOptions {
  /** The address of the `.input.json` document loaded at startup. */
  readonly actions?: string;
  /** The magnitude at which an analog value counts as pressed. */
  readonly pressPoint?: number;
  /** Whether gamepads are polled each frame. */
  readonly gamepadPolling?: boolean;
  /** Pointer-lock policy. */
  readonly pointerLock?: PointerLockSettings;
  /** The control scheme the app starts in. */
  readonly defaultScheme?: string;
  /** Whether a scheme tag filters resolution as well as device pairing. */
  readonly strictSchemes?: boolean;
  /**
   * How gamepads are read. Defaults to `navigator.getGamepads()`, or to no polling at all under
   * Node. Tests pass their own reader.
   */
  readonly gamepadReader?: GamepadReader | null;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `input` section.
 * @param options - What the game passed to `input(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: InputSettings, options: InputOptions): InputSettings {
  return {
    actions: options.actions ?? settings.actions,
    pressPoint: options.pressPoint ?? settings.pressPoint,
    gamepadPolling: options.gamepadPolling ?? settings.gamepadPolling,
    pointerLock: options.pointerLock ?? settings.pointerLock,
    defaultScheme: options.defaultScheme ?? settings.defaultScheme,
    strictSchemes: options.strictSchemes ?? settings.strictSchemes,
  };
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `input(...)`.
 * @returns The service, so `onStart` can reach it without a second lookup.
 */
function registerInput(ctx: ExtensionContext, options: InputOptions): InputService {
  ctx.registerErrorCodes(INPUT_ERROR_MESSAGES);
  ctx.registerSettings<InputSettings>(INPUT_SETTINGS_SECTION, inputSettingsSchema(), defaultInputSettings());
  const settings = mergeSettings(ctx.settings<InputSettings>(INPUT_SETTINGS_SECTION), options);
  const service = new InputService({
    app: ctx.app,
    settings,
    ...(options.gamepadReader === undefined ? {} : { gamepadReader: options.gamepadReader }),
  });
  ctx.registerService(InputService, service);
  defineInputAppProperty(ctx, service);
  ctx.registerSystem(new InputSystem(service), { phase: Phase.PreUpdate, order: INPUT_RESOLVE_ORDER });
  ctx.registerAssetLoader(createInputActionsLoader());
  ctx.registerComponent(PlayerInput);
  service.setDiagnostics(ctx.app.diagnostics.registerGroup(INPUT_DIAGNOSTICS_GROUP, INPUT_DIAGNOSTICS_COUNTERS));
  ctx.onDispose((): void => {
    service.dispose();
  });
  return service;
}

/**
 * Attaches the DOM adapters and starts the document the `input.actions` setting names.
 *
 * @remarks
 * The document is **not** awaited. Asset delivery happens in the `PreUpdate` of a stepped frame and
 * `onStart` runs before the loop starts, so awaiting here would deadlock — the same reason the core
 * extension does not await its preload groups. The maps are installed at delivery, and game code
 * that must wait awaits `app.input.actionsHandle?.promise`.
 *
 * @param app - The app being started.
 * @param service - The app's input service.
 * @param address - The document address, or `""` for none.
 */
function startInput(app: App, service: InputService, address: string): void {
  if (!app.isHeadless) {
    service.attachDom(app.lite.engine.canvas);
  }
  if (address === "") {
    return;
  }
  const handle = app.assets.load<InputActionsAsset>(address);
  service.setActionsHandle(handle);
  void handle.promise.then(
    (value: InputActionsAsset): void => {
      service.loadActions(value);
    },
    (error: unknown): void => {
      app.onError.emit({ error, source: "asset", phase: null, entity: null, component: null });
    },
  );
}

/**
 * The `@ignifx/input` extension factory.
 *
 * @param options - Overrides for the `input` settings section, and the gamepad reader.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   extensions: [input({ actions: "input/default.input.json" })],
 * });
 * ```
 *
 * @public
 */
export const input: (options?: InputOptions) => Extension = defineExtension<InputOptions | undefined>((raw) => {
  // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
  // game wrote `input()`; the typed signature cannot express that, so the default lands here.
  const options: InputOptions = raw ?? {};
  let service: InputService | null = null;
  return {
    name: "@ignifx/input",
    version: VERSION,
    engine: ">=0.0.0 <1.0.0",
    requires: ["@ignifx/core"],
    register(ctx: ExtensionContext): void {
      service = registerInput(ctx, options);
    },
    onStart(app: App): void {
      if (service !== null) {
        startInput(
          app,
          service,
          options.actions ?? app.settings.section<InputSettings>(INPUT_SETTINGS_SECTION).actions,
        );
      }
    },
  };
});
