import { decodeProps, defineExtension, Phase } from "@ignifx/core";
import { TWO_D_ANIMATION_ORDER, TwoDAnimationSystem } from "./animation/animation-system.js";
import { createSpriteAnimationLoader } from "./animation/loader.js";
import { SpriteAnimator } from "./animation/sprite-animator.js";
import { createSpriteAtlasLoader } from "./atlas/loader.js";
import { defineTwoDAppProperty } from "./augmentation.js";
import { Camera2DFollow } from "./camera/camera-2d-follow.js";
import { Camera2D } from "./camera/camera-2d.js";
import { TWO_D_ERROR_MESSAGES } from "./errors.js";
import {
  attachLayer,
  createRegisteredSpriteRenderer,
  destroySpriteRenderer,
  detachLayer,
  enableSpriteDeviceLostRecovery,
} from "./lite/gpu/sprite-renderer.js";
import { TwoDRuntime } from "./service/runtime.js";
import { selectCamera, TWO_D_SYNC_ORDER, TwoDSyncSystem } from "./service/sync-system.js";
import { TwoDService } from "./service/two-d-service.js";
import { defaultTwoDSettings, spriteClearColor, TWO_D_SETTINGS_SECTION, twoDSettingsSchema } from "./settings.js";
import { ParallaxLayer } from "./sprite/parallax-layer.js";
import { SpriteLayerEffect } from "./sprite/sprite-layer-effect.js";
import { SpriteRenderer } from "./sprite/sprite-renderer.js";
import { spawnTileObjects } from "./tilemap/spawn-objects.js";
import { createTilemapLoader } from "./tilemap/tilemap-asset.js";
import { TilemapRenderer } from "./tilemap/tilemap-renderer.js";
import { Tilemap } from "./tilemap/tilemap.js";
import { VERSION } from "./version.js";
import type { LiteSpriteRenderer } from "./lite/types.js";
import type { TwoDMode, TwoDSettings } from "./settings.js";
import type {
  App,
  Extension,
  ExtensionContext,
  JsonObject,
  JsonValue,
  SceneInstance,
  SortingLayersSettings,
  World,
} from "@ignifx/core";

/**
 * The `@ignifx/2d` extension (`docs/architecture/04-extensions.md` §1,
 * `11-2d-toolkit.md` §1). Registering it is the whole installation: `twoD()` gives a game
 * `app.twoD`, seven components, the `Camera2DFollow` script, three asset types, the `twoD` settings
 * section, and the two systems that drive sprites — the `PreRender` sync and the `PostUpdate`
 * animation clock.
 */

/**
 * What `twoD()` accepts. Every field overrides the matching `twoD` settings section value.
 *
 * @public
 */
export interface TwoDOptions {
  /** Whether sprites are the whole frame (`"sprite"`) or composite over the 3D scene (`"mixed"`). */
  readonly mode?: TwoDMode;
  /** How many pixels one world metre spans. */
  readonly pixelsPerUnit?: number;
  /** Which sorting layers draw back-to-front by world Y. */
  readonly ySort?: Readonly<Record<string, boolean>>;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `twoD` section.
 * @param options - What the game passed to `twoD(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: TwoDSettings, options: TwoDOptions): TwoDSettings {
  return {
    mode: options.mode ?? settings.mode,
    pixelsPerUnit: options.pixelsPerUnit ?? settings.pixelsPerUnit,
    ySort: options.ySort ?? settings.ySort,
  };
}

/**
 * The components the extension registers, in the order the API report lists them.
 *
 * @returns The classes.
 */
function components(): readonly [
  typeof Camera2D,
  typeof SpriteRenderer,
  typeof SpriteAnimator,
  typeof Tilemap,
  typeof TilemapRenderer,
  typeof ParallaxLayer,
  typeof SpriteLayerEffect,
  typeof Camera2DFollow,
] {
  return [
    Camera2D,
    SpriteRenderer,
    SpriteAnimator,
    Tilemap,
    TilemapRenderer,
    ParallaxLayer,
    SpriteLayerEffect,
    Camera2DFollow,
  ];
}

/**
 * Whether a JSON value is an object rather than an array, a primitive, or absent.
 *
 * @param value - The value read out of the scene file.
 * @returns `true` when the value can be decoded as a settings block.
 */
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a scene file's `settings.twoD` block over the project's own settings.
 *
 * @remarks
 * `docs/architecture/11-2d-toolkit.md` §7 asks that a scene be able to override the mode, the PPU,
 * and the Y-sort table. `@ignifx/core` carries the block through to `SceneInstance.settings` as raw
 * JSON and fires `world.onSceneLoaded` once it is populated (`world.ts` 590 and 597) — but there is
 * no *validated* per-scene settings mechanism, no schema hook and no `IGX-0408` path, so the
 * extension validates its own block with `decodeProps` against the same schema
 * `registerSettings` uses. An invalid block is reported to `app.onError` and ignored rather than
 * taking the scene load down with it.
 *
 * @param app - The app.
 * @param runtime - The runtime whose settings the block replaces.
 * @param base - The settings the project resolved, which the block is applied over.
 * @param scene - The scene that just loaded.
 */
function applySceneSettings(app: App, runtime: TwoDRuntime, base: TwoDSettings, scene: SceneInstance): void {
  const block = scene.settings?.[TWO_D_SETTINGS_SECTION];
  if (!isJsonObject(block)) {
    return;
  }
  const decoded = decodeProps(twoDSettingsSchema(), block, {
    entity: (): null => null,
    component: (): null => null,
    asset: (): null => null,
  });
  if (decoded.issues.length > 0) {
    app.onError.emit({
      error: new Error(`settings.twoD in ${scene.name} has ${String(decoded.issues.length)} invalid field(s)`),
      source: "extension",
      phase: null,
      entity: null,
      component: null,
    });
    return;
  }
  // `decodeProps` fills every absent field with its schema default, so an omitted key would
  // otherwise silently reset the project's value to 100 rather than leaving it alone. Only the
  // keys the block actually wrote may override.
  const value = decoded.value as Partial<TwoDSettings>;
  runtime.applySettings({
    mode: Object.hasOwn(block, "mode") && value.mode !== undefined ? value.mode : base.mode,
    pixelsPerUnit:
      Object.hasOwn(block, "pixelsPerUnit") && value.pixelsPerUnit !== undefined
        ? value.pixelsPerUnit
        : base.pixelsPerUnit,
    ySort: Object.hasOwn(block, "ySort") && value.ySort !== undefined ? value.ySort : base.ySort,
  });
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `twoD(...)`.
 */
function registerTwoD(ctx: ExtensionContext, options: TwoDOptions): void {
  ctx.registerErrorCodes(TWO_D_ERROR_MESSAGES);
  ctx.registerSettings<TwoDSettings>(TWO_D_SETTINGS_SECTION, twoDSettingsSchema(), defaultTwoDSettings());
  const settings = mergeSettings(ctx.settings<TwoDSettings>(TWO_D_SETTINGS_SECTION), options);
  const app = ctx.app;
  const sorting = app.settings.section<SortingLayersSettings>("sortingLayers").sortingLayers;
  const isHeadless = app.isHeadless;
  const runtime = new TwoDRuntime({
    app,
    settings,
    sortingLayers: sorting,
    createRenderer: isHeadless
      ? null
      : (): LiteSpriteRenderer =>
          // `clear: false` in "mixed" mode so the render scene's colour survives underneath
          // (`index.d.ts` 12222); in "sprite" mode the sprite pass owns the frame and clears it to
          // the project's `rendering.clearColor`, which nothing else in a 2D scene would apply.
          createRegisteredSpriteRenderer(app.lite.engine, settings.mode === "sprite", spriteClearColor(app)),
    attachLayer,
    detachLayer,
    destroyRenderer: destroySpriteRenderer,
  });
  const service = new TwoDService(runtime);
  ctx.registerService(TwoDService, service);
  defineTwoDAppProperty(ctx, service);
  ctx.registerSystem(new TwoDSyncSystem(runtime), { phase: Phase.PreRender, order: TWO_D_SYNC_ORDER });
  ctx.registerSystem(new TwoDAnimationSystem(runtime), { phase: Phase.PostUpdate, order: TWO_D_ANIMATION_ORDER });
  ctx.registerAssetLoader(createSpriteAtlasLoader());
  ctx.registerAssetLoader(createSpriteAnimationLoader());
  ctx.registerAssetLoader(createTilemapLoader());
  ctx.registerComponents(components());
  runtime.setSceneHandler((scene: SceneInstance): void => {
    applySceneSettings(app, runtime, settings, scene);
    spawnTileObjects(app, service, scene);
  });
  // A `Camera2D` is a camera as far as the frame is concerned, so a 2D-only world is not the
  // "nothing is drawn" case `IGX-0706` warns about. The world is re-examined on each ask rather
  // than the runtime's last-frame camera being reported, because core's render sync also runs once
  // inside `app.start()` — before the 2D sync system has picked a camera for the first time.
  const removeCameraSource = app.renderer.addCameraSource((world: World): boolean => selectCamera(world) !== null);
  ctx.onDispose((): void => {
    removeCameraSource();
    runtime.dispose();
  });
}

/**
 * Turns on device-lost recovery.
 *
 * @remarks
 * Recovery is enabled here, in `onStart`, and **before any atlas or layer exists**, because Lite
 * requires it: *"Enable this before creating or loading sprite textures so their recovery sources
 * are retained"* (`index.d.ts` 4372). `onStart` runs after every extension registered and after
 * the engine exists, but before the first frame — the only window where both conditions hold.
 *
 * @param app - The app being started.
 */
function startTwoD(app: App): void {
  if (!app.isHeadless && app.renderer.features.deviceLostRecovery) {
    enableSpriteDeviceLostRecovery(
      app.lite.engine,
      (): void => {
        app.log.info("2D sprite resources recovered after device loss.");
      },
      (error: unknown): void => {
        app.onError.emit({ error, source: "extension", phase: null, entity: null, component: null });
      },
    );
  }
}

/**
 * The `@ignifx/2d` extension factory.
 *
 * @param options - Overrides for the `twoD` settings section.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   extensions: [twoD({ pixelsPerUnit: 16, ySort: { Default: true } })],
 * });
 * ```
 *
 * @public
 */
export const twoD: (options?: TwoDOptions) => Extension = defineExtension<TwoDOptions | undefined>((raw) => {
  // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
  // game wrote `twoD()`; the typed signature cannot express that, so the default lands here.
  const options: TwoDOptions = raw ?? {};
  return {
    name: "@ignifx/2d",
    version: VERSION,
    engine: ">=0.0.0 <1.0.0",
    requires: ["@ignifx/core"],
    register(ctx: ExtensionContext): void {
      registerTwoD(ctx, options);
    },
    onStart(app: App): void {
      startTwoD(app);
    },
  };
});
