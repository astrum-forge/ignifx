import { defineExtension, Phase } from "@ignifx/core";
import { defineDevtoolsAppProperty } from "./augmentation.js";
import { devtoolsError, DEVTOOLS_ERROR_MESSAGES, DevtoolsErrorCode } from "./errors.js";
import { createDevtoolsLogSink } from "./log-sink.js";
import { DevtoolsService, DEVTOOLS_SAMPLE_ORDER } from "./service.js";
import { defaultDevtoolsSettings, DEVTOOLS_SETTINGS_SECTION, devtoolsSettingsSchema } from "./settings.js";
import { VERSION } from "./version.js";
import type { DevtoolsLogSink } from "./log-sink.js";
import type { DevtoolsPosition, DevtoolsSettings } from "./settings.js";
import type { Extension, ExtensionContext, System } from "@ignifx/core";

/**
 * Register devtools with core; optional extensions are inspected through shape checks.
 * The sampler is installed only when the overlay first opens. Without a DOM canvas, opening is a
 * no-op; settings, selection, and signals remain available to headless tests.
 */

/**
 * What `devtools()` accepts. Every field that names a settings value overrides the matching
 * `devtools` section value, which is the shape `04-extensions.md` §1 shows for `physics()`.
 *
 * @public
 */
export interface DevtoolsOptions {
  /** The `KeyboardEvent.code` that toggles the overlay. Defaults to `"Backquote"`. */
  readonly toggleKey?: string;
  /** Whether the overlay is open the moment the app starts. */
  readonly openOnStart?: boolean;
  /** Whether a changed scene file re-instantiates its live scene instances. */
  readonly reloadScenes?: boolean;
  /** The panels to show, in tab order. */
  readonly panels?: readonly string[];
  /** The canvas edge the overlay docks to. */
  readonly position?: DevtoolsPosition;
  /** The overlay's background opacity, `0`–`1`. */
  readonly opacity?: number;
  /**
   * The sink the Console panel reads its log lines from. By default the extension creates one and
   * adds it to `app.log` with `Logger.addSink`, so log lines appear without any wiring; pass your own
   * to share it with something else (a `tee` to the console, a file sink) or to size its buffer.
   */
  readonly logSink?: DevtoolsLogSink;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `devtools` section.
 * @param options - What the game passed to `devtools(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: DevtoolsSettings, options: DevtoolsOptions): DevtoolsSettings {
  return {
    toggleKey: options.toggleKey ?? settings.toggleKey,
    openOnStart: options.openOnStart ?? settings.openOnStart,
    reloadScenes: options.reloadScenes ?? settings.reloadScenes,
    panels: options.panels ?? settings.panels,
    position: options.position ?? settings.position,
    opacity: options.opacity ?? settings.opacity,
  };
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `devtools(...)`.
 * @returns The service, so `onStart` can install the toggle key.
 * @throws IgnifxError with code `IGX-1550` when a second `devtools()` is registered on one app.
 */
function registerDevtools(ctx: ExtensionContext, options: DevtoolsOptions): DevtoolsService {
  const app = ctx.app;
  // `Reflect.has` rather than `"devtools" in app`: the augmentation declares the property on `App`,
  // so an `in` check narrows the negative branch to `never`.
  if (Reflect.has(app, "devtools")) {
    throw devtoolsError(DevtoolsErrorCode.duplicateExtension, "The devtools() extension is already registered.", {
      hint: "Register devtools() once; pass its options to that one call.",
    });
  }
  ctx.registerErrorCodes(DEVTOOLS_ERROR_MESSAGES);
  ctx.registerSettings<DevtoolsSettings>(
    DEVTOOLS_SETTINGS_SECTION,
    devtoolsSettingsSchema(),
    defaultDevtoolsSettings(),
  );
  const settings = mergeSettings(ctx.settings<DevtoolsSettings>(DEVTOOLS_SETTINGS_SECTION), options);
  // The Console panel's sink is added to `app.log` here, so records from every logger in the tree
  // (`ctx.log` included) reach the panel without the game passing the sink to `createApp`.
  const logSink = options.logSink ?? createDevtoolsLogSink();
  ctx.onDispose(app.log.addSink(logSink));
  const service = new DevtoolsService({
    app,
    settings,
    logSink,
    // Deliberately deferred: registering the sampler here would put a system in every frame of a
    // game that never opens the overlay, which is the one thing the Phase 10 exit criterion
    // forbids. The first `open()` calls this instead.
    registerSystem: (system: System): void => {
      ctx.registerSystem(system, { phase: Phase.PreRender, order: DEVTOOLS_SAMPLE_ORDER });
    },
  });
  ctx.registerService(DevtoolsService, service);
  defineDevtoolsAppProperty(ctx, service);
  ctx.onDispose((): void => {
    service.dispose();
  });
  return service;
}

/**
 * The `@ignifx/devtools` extension factory.
 *
 * @param options - Overrides for the `devtools` settings section, plus the Console panel's sink.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, extensions: [devtools({ toggleKey: "F1" })] });
 * app.devtools.open();
 * ```
 *
 * @public
 */
export const devtools: (options?: DevtoolsOptions) => Extension = defineExtension<DevtoolsOptions | undefined>(
  (raw) => {
    // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
    // game wrote `devtools()`; the typed signature cannot express that, so the default lands here.
    const options: DevtoolsOptions = raw ?? {};
    let service: DevtoolsService | null = null;
    return {
      name: "@ignifx/devtools",
      version: VERSION,
      engine: ">=0.0.0 <1.0.0",
      requires: ["@ignifx/core"],
      optional: ["@ignifx/ui", "@ignifx/input", "@ignifx/audio", "@ignifx/physics", "@ignifx/physics-2d"],
      register(ctx: ExtensionContext): void {
        service = registerDevtools(ctx, options);
      },
      onStart(): void {
        service?.start();
      },
    };
  },
);
