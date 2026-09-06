import { Phase } from "../app/types.js";
import { VERSION } from "../app/version.js";
import { assetsInternals } from "../assets/assets-service.js";
import { ASSET_DELIVERY_ORDER, AssetDeliverySystem } from "../assets/delivery-system.js";
import { GENERIC_ASSET_LOADERS } from "../assets/generic-loaders.js";
import { DEFAULT_ASSET_ROOT } from "../assets/manifest.js";
import { DEFAULT_ASSET_CONCURRENCY } from "../assets/request-queue.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Camera } from "../render/camera.js";
import { Environment } from "../render/environment.js";
import { Light } from "../render/light.js";
import { createEnvironmentLoader } from "../render/loaders/environment-loader.js";
import { createFontLoader } from "../render/loaders/font-loader.js";
import { createMaterialLoader } from "../render/loaders/material-loader.js";
import { createModelLoader } from "../render/loaders/model-loader.js";
import { createTextureLoader } from "../render/loaders/texture-loader.js";
import { MESH_ASSET_TYPE, MeshAsset } from "../render/mesh-asset.js";
import { MeshRenderer } from "../render/mesh-renderer.js";
import { Model } from "../render/model.js";
import { PostProcessStack } from "../render/post-process-stack.js";
import { RENDER_SYNC_ORDER, RenderSyncSystem } from "../render/render-sync-system.js";
import { RendererImpl, RendererService } from "../render/renderer.js";
import {
  defaultRenderingSettings,
  RENDERING_SETTINGS_SECTION,
  renderingSettingsSchema,
} from "../render/rendering-settings.js";
import { array, f64, str, u32 } from "../schema/field-kinds.js";
import { defineSchema } from "../schema/schema.js";
import { createSceneLoader } from "../serialization/scene-loader.js";
import { Transform } from "../transform/transform.js";
import { TWEEN_SYSTEM_ORDER, TweenSystem } from "../tween/tween-system.js";
import { tweensInternals } from "../tween/tweens.js";
import { defineExtension } from "./define-extension.js";
import type {
  App,
  Extension,
  ExtensionContext,
  LayersSettings,
  SortingLayersSettings,
  TimeSettings,
} from "../app/types.js";
import type { AssetsSettings } from "../assets/types.js";
import type { RenderingSettings } from "../render/rendering-settings.js";

/**
 * The implicit core extension (`docs/architecture/04-extensions.md` §7). `@ignifx/core` registers
 * itself through the same contract as everything else, so there is one code path and one set of
 * guarantees.
 *
 * @remarks
 * It registers what the kernel owns: `Transform`, `Camera`, `Light`, `MeshRenderer`, `Model`,
 * `Environment`, and `PostProcessStack`; the `layers`, `sortingLayers`, `time`, `assets`, and
 * `rendering` settings sections; the `json`/`text`/`binary`/`scene` loaders and the GPU ones
 * (`texture`, `model`, `material`, `environment`, `font`); the service behind `app.renderer`; the
 * `PreUpdate` system that delivers completed loads; and the `PreRender` system that reconciles the
 * render components with the Lite scene (`04-extensions.md` §7, `05-assets-and-loading.md` §5,
 * `07-rendering.md` §2, `01-lifecycle-and-time.md` §3 steps 2 and 6).
 *
 * The core diagnostic codes are **not** registered here: `createErrorCodeRegistry()` already
 * pre-loads `CORE_ERROR_MESSAGES`, and registering them a second time is `IGX-1501`.
 *
 * The schemas and defaults are built inside `register`, not at module scope: a schema field is a
 * function call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4). They are built once per app, which is where the
 * cost belongs.
 */

/**
 * The default project layer list (`docs/architecture/04-extensions.md` §5). It is the first five of
 * the eight engine-reserved names, which is why a default project consumes no user layer slot
 * (`02-scene-graph.md` §7).
 */
const DEFAULT_LAYERS: readonly string[] = Object.freeze(["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"]);

/** The default sorting-layer list, consumed by the 2D toolkit. */
const DEFAULT_SORTING_LAYERS: readonly string[] = Object.freeze(["Default"]);

/** The default fixed step, in seconds (`01-lifecycle-and-time.md` §2). */
const DEFAULT_FIXED_DELTA_TIME = 1 / 60;

/** The default frame-delta clamp, in seconds. */
const DEFAULT_MAXIMUM_DELTA_TIME = 0.1;

/** The default time scale. */
const DEFAULT_TIME_SCALE = 1;

/** No manifest groups are preloaded unless the project names some. */
const DEFAULT_PRELOAD: readonly string[] = Object.freeze([]);

/** How many seconds a zero-reference asset stays cached (`05-assets-and-loading.md` §4). */
const DEFAULT_GC_DELAY = 5;

/** How many times a failed asset fetch is retried (`05-assets-and-loading.md` §9). */
const DEFAULT_ASSET_RETRIES = 2;

/**
 * Registers the core settings sections and the core components.
 *
 * @param ctx - The registration surface.
 */
function registerCore(ctx: ExtensionContext): void {
  ctx.registerSettings<LayersSettings>("layers", defineSchema({ layers: array(str(), DEFAULT_LAYERS) }), {
    layers: DEFAULT_LAYERS,
  });
  ctx.registerSettings<SortingLayersSettings>(
    "sortingLayers",
    defineSchema({ sortingLayers: array(str(), DEFAULT_SORTING_LAYERS) }),
    { sortingLayers: DEFAULT_SORTING_LAYERS },
  );
  ctx.registerSettings<TimeSettings>(
    "time",
    defineSchema({
      fixedDeltaTime: f64(DEFAULT_FIXED_DELTA_TIME, { min: Number.EPSILON }),
      maximumDeltaTime: f64(DEFAULT_MAXIMUM_DELTA_TIME, { min: Number.EPSILON }),
      timeScale: f64(DEFAULT_TIME_SCALE, { min: 0 }),
    }),
    {
      fixedDeltaTime: DEFAULT_FIXED_DELTA_TIME,
      maximumDeltaTime: DEFAULT_MAXIMUM_DELTA_TIME,
      timeScale: DEFAULT_TIME_SCALE,
    },
  );
  ctx.registerSettings<AssetsSettings>(
    "assets",
    defineSchema({
      root: str(DEFAULT_ASSET_ROOT),
      preload: array(str(), DEFAULT_PRELOAD),
      concurrency: u32(DEFAULT_ASSET_CONCURRENCY, { min: 1 }),
      gcDelay: f64(DEFAULT_GC_DELAY, { min: 0 }),
      retries: u32(DEFAULT_ASSET_RETRIES, { min: 0 }),
    }),
    {
      root: DEFAULT_ASSET_ROOT,
      preload: DEFAULT_PRELOAD,
      concurrency: DEFAULT_ASSET_CONCURRENCY,
      gcDelay: DEFAULT_GC_DELAY,
      retries: DEFAULT_ASSET_RETRIES,
    },
  );
  ctx.registerComponent(Transform);
  // `app.tweens` is built by `createApp`, before any extension runs; the core extension only gives
  // it the `PostUpdate` slot it advances in (`docs/architecture/12-3d-toolkit.md` §4).
  ctx.registerSystem(new TweenSystem(tweensInternals(ctx.app.tweens)), {
    phase: Phase.PostUpdate,
    order: TWEEN_SYSTEM_ORDER,
  });
  registerAssets(ctx);
  registerRendering(ctx);
}

/**
 * Registers the rendering layer: the `rendering` settings section, the service behind
 * `app.renderer`, the five components `docs/architecture/04-extensions.md` §7 lists, the GPU asset
 * loaders, and the `PreRender` system that reconciles them with the Lite scene.
 *
 * @remarks
 * The order matters in one place: the section is registered *first*, because `ctx.registerSettings`
 * resolves it immediately and {@link RendererImpl} is constructed from the resolved value inside
 * this same `register` call. Everything after that only needs the service to exist.
 *
 * @param ctx - The registration surface.
 */
function registerRendering(ctx: ExtensionContext): void {
  ctx.registerSettings<RenderingSettings>(
    RENDERING_SETTINGS_SECTION,
    renderingSettingsSchema(),
    defaultRenderingSettings(),
  );
  const renderer = new RendererImpl(ctx.app, ctx.settings<RenderingSettings>(RENDERING_SETTINGS_SECTION));
  ctx.registerService(RendererService, renderer);
  ctx.registerComponents([Camera, Light, MeshRenderer, Model, Environment, PostProcessStack]);
  ctx.registerAssetLoader(createTextureLoader());
  ctx.registerAssetLoader(createModelLoader());
  ctx.registerAssetLoader(createMaterialLoader());
  ctx.registerAssetLoader(createEnvironmentLoader());
  ctx.registerAssetLoader(createFontLoader());
  // `MeshAsset.box(...)` and friends publish through `Assets.register`, which needs the type to
  // exist so a `memory:mesh/<n>` handle can be collected — and its `unload` is what frees the
  // template's GPU buffers.
  ctx.registerAssetLoader({
    type: MESH_ASSET_TYPE,
    extensions: [],
    load: (): Promise<never> => Promise.reject(noMeshFileFormat()),
    unload: (value: unknown): void => {
      if (value instanceof MeshAsset) {
        value.dispose();
      }
    },
  });
  const sync = new RenderSyncSystem(renderer);
  renderer.attachSyncSystem(sync);
  ctx.registerSystem(sync, { phase: Phase.PreRender, order: RENDER_SYNC_ORDER });
  ctx.onDispose((): void => {
    renderer.dispose();
  });
}

/**
 * Builds the failure a `mesh` **address** produces: there is no mesh file format, because geometry
 * arrives either as a primitive built in code or inside a `ModelAsset`.
 *
 * @returns The error to reject with.
 */
function noMeshFileFormat(): IgnifxError {
  return new IgnifxError(CoreErrorCode.assetNoLoader, "There is no mesh file format; build one in code.", {
    context: { type: MESH_ASSET_TYPE },
    hint: "Use MeshAsset.box/sphere/plane/ground/... for primitives, or load a .glb as a model.",
  });
}

/**
 * Registers the headless half of the asset service: the generic loaders, the `PreUpdate` delivery
 * system, and the disposer that cancels whatever is still in flight
 * (`docs/architecture/05-assets-and-loading.md` §5, §9).
 *
 * @param ctx - The registration surface.
 */
function registerAssets(ctx: ExtensionContext): void {
  const assets = assetsInternals(ctx.app.assets);
  for (const loader of GENERIC_ASSET_LOADERS) {
    ctx.registerAssetLoader(loader);
  }
  ctx.registerAssetLoader(createSceneLoader());
  ctx.registerSystem(new AssetDeliverySystem(assets), { phase: Phase.PreUpdate, order: ASSET_DELIVERY_ORDER });
  ctx.onDispose((): void => {
    assets.dispose();
  });
}

/**
 * Starts the manifest groups the `assets` settings section names
 * (`docs/architecture/04-extensions.md` §5: `assets: { root: "./assets", preload: ["boot"] }`).
 *
 * @remarks
 * The batches are deliberately **not** awaited. Delivery happens in `PreUpdate`, and `onStart` runs
 * before the first frame, so awaiting here would deadlock a headless app that has not been stepped
 * yet. A preloaded group is retained for the life of the app — that is what "preload" means — and a
 * failure is reported through `app.onError` rather than being swallowed (coding standards §5.5).
 *
 * @param app - The app being started.
 */
function startPreload(app: App): void {
  const assets = assetsInternals(app.assets);
  for (const group of assets.preloadGroups) {
    const batch = assets.preloadGroup(group);
    void batch.promise.catch((error: unknown): void => {
      app.onError.emit({ error, source: "asset", phase: null, entity: null, component: null });
    });
  }
}

/**
 * Builds the extension `createApp` always puts first (`docs/architecture/04-extensions.md` §2
 * rule 1).
 *
 * @returns The core extension descriptor.
 *
 * @example
 * ```ts
 * // createApp does this for you; the list is only ever built by the kernel.
 * const extensions = [coreExtension(), physics(), input()];
 * ```
 *
 * @public
 */
export const coreExtension: (options?: void) => Extension = defineExtension(() => ({
  name: "@ignifx/core",
  version: VERSION,
  register: registerCore,
  onStart: startPreload,
}));
