import { createServiceKey } from "../app/types.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { toComponentHandle, toEntityHandle } from "../handles/handle.js";
import { setSceneClearColor } from "../lite/gpu/environment.js";
import { disposeScenePicker } from "../lite/gpu/picker.js";
import { setSurfaceSizePx } from "../lite/gpu/render-diagnostics-gpu.js";
import { captureFrame } from "../lite/gpu/screenshot-capture.js";
import { discardMaterialWarmUp } from "../lite/gpu/warm-up.js";
import { readPickedTag } from "../lite/picking.js";
import { disableGpuTiming, readDrawCallCount, readGpuFrameTimeMs } from "../lite/render-diagnostics.js";
import { assertRenderingFeatureAvailable } from "../lite/render-features.js";
import { sceneLightCount } from "../lite/scene.js";
import { Color } from "../math/color.js";
import { clamp } from "../math/math-utils.js";
import {
  applySurfaceScale,
  createPicker,
  pickPixel,
  readTargetSizePx,
  readTaskTimings,
  startGpuTiming,
  warmUpMaterialAssets,
} from "./gpu/renderer-gpu.js";
import {
  buildMaterialAsset,
  createDefaultMaterialAsset,
  MATERIAL_ASSET_TYPE,
  standardMaterialDefinition,
} from "./material-asset.js";
import { toRenderingFeatures } from "./rendering-settings.js";
import type { MaterialAsset } from "./material-asset.js";
import type { RenderingFeatureSettings, RenderingSettings } from "./rendering-settings.js";
import type { App, ServiceNameKey } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { Component } from "../component/component.js";
import type { DiagnosticsGroup } from "../diagnostics/diagnostics-group.js";
import type { Entity } from "../entity/entity.js";
import type { LiteGpuPicker } from "../lite/gpu/picker.js";
import type { ScenePresenter } from "../lite/gpu/render-path.js";
import type { MaterialWarmUp } from "../lite/gpu/warm-up.js";
import type { NodeTag } from "../lite/node.js";
import type { LitePickInfo } from "../lite/picking.js";
import type { RenderingFeatureName, RenderingFeatures } from "../lite/render-features.js";
import type { LiteEngine, LiteScene } from "../lite/scene.js";
import type { ColorLike } from "../math/types.js";
import type { World } from "../world/world.js";

/**
 * `app.renderer` (`docs/architecture/07-rendering.md` §1, §3, §5, ADR-0014): the service that owns
 * everything about rendering that is not attached to an entity — surface sizing, the feature gate,
 * material warm-up, picking, screenshots, and the render diagnostics counters.
 *
 * It is also where the render layer keeps its per-app state, which is why the components and the
 * `PreRender` system reach it through {@link rendererInternals} rather than through a second
 * service. One object, one lifetime, one place to look.
 *
 * ## Decisions the documents left open
 *
 * - **`requireFeature` before start turns the feature on.** §1.1 says extensions "declare the
 *   features they need through `ctx.requireRenderingFeature(name)` at registration" and that late
 *   toggles are `IGX-0704`. Registration happens before `app.start()` applies the opt-ins, so the
 *   call is a *declaration* then and a refusal afterwards. That is the only reading under which an
 *   extension can need a feature the project did not think to list.
 * - **A headless pick resolves to `null`, it does not throw.** The GPU picker needs a device and a
 *   rendered frame. §6 says headless components "keep their state" and skip GPU work, so a pick is
 *   a miss rather than an error; `world.raycastRender` is the CPU path that still answers.
 * - **A headless screenshot rejects.** `captureScreenshot` never settles without a running render
 *   loop (ADR-0002 Validation), so awaiting one under the null engine would hang forever. §5 asks
 *   for `IGX-0707`, and rejecting is the only way a caller finds out.
 */

/**
 * The render diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @public
 */
export const RENDER_DIAGNOSTICS_GROUP = "render";

/**
 * The key `app.renderer` is registered and looked up under.
 *
 * @remarks
 * The service is a *core* member of `App`, not an extension contribution, so it does not go through
 * `defineAppProperty`. It is still a service, because the core extension is what builds it — it
 * needs the resolved `rendering` settings section, which only exists once `register` has run — and
 * the service table is how a value built during registration reaches the app.
 *
 * @internal
 */
export const RendererService: ServiceNameKey<Renderer> = createServiceKey<Renderer>("ignifx/renderer");

/**
 * The counters the `render` diagnostics group publishes, in index order.
 *
 * @public
 */
export const RENDER_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "drawCalls",
  "gpuFrameTimeMs",
  "cameras",
  "lights",
  "meshes",
  "renderableRebuilds",
]);

/** The feature record while the service still owns it: `requireFeature` writes into it before start. */
type MutableRenderingFeatures = { -readonly [Name in RenderingFeatureName]: boolean };

/** The smallest resolution scale `docs/architecture/07-rendering.md` §1 allows. */
const MIN_RESOLUTION_SCALE = 0.25;

/** The largest resolution scale, i.e. no downscaling. */
const MAX_RESOLUTION_SCALE = 1;

/**
 * A rendering feature a project or an extension asks for
 * (`docs/architecture/07-rendering.md` §1.1).
 *
 * @public
 */
export type RenderingFeature = keyof RenderingFeatureSettings;

/**
 * What a GPU pick found (`docs/architecture/07-rendering.md` §3).
 *
 * @public
 */
export interface RenderPick {
  /** The entity that owns the mesh the ray hit. */
  readonly entity: Entity;
  /** The component that created the mesh, when it was not the entity's own transform. */
  readonly component: Component | null;
  /** The world-space hit point, or `null` unless detailed picking is on. */
  readonly point: readonly [number, number, number] | null;
  /** The world-space surface normal, or `null` unless detailed picking is on. */
  readonly normal: readonly [number, number, number] | null;
  /** How far along the ray the hit is, in metres. */
  readonly distance: number;
}

/**
 * How a GPU pick is restricted (`docs/architecture/07-rendering.md` §3).
 *
 * @public
 */
export interface RenderPickOptions {
  /**
   * Restricts the pick to the entities this accepts. A rejected entity neither occludes nor
   * returns, which is what makes a "pick only the pickups" query exact rather than approximate.
   *
   * @param entity - The candidate.
   * @returns `true` to consider the entity.
   */
  readonly filter?: (entity: Entity) => boolean;
}

/**
 * A captured frame (`docs/architecture/07-rendering.md` §5).
 *
 * @remarks
 * Tightly packed RGBA8, four bytes per pixel, row-major with the **top** row first — the layout
 * `ImageData` wants. Alpha is forced to 255 because the swapchain is presented opaque, and the
 * values are the final presented 8-bit colours, so comparing two captures compares what the player
 * saw.
 *
 * @public
 */
export interface RenderCapture {
  /** The capture width, in device pixels. */
  readonly width: number;
  /** The capture height, in device pixels. */
  readonly height: number;
  /** `width * height * 4` bytes of RGBA8. */
  readonly data: Uint8ClampedArray;
}

/**
 * One frame-graph task's measured GPU time (`docs/architecture/07-rendering.md` §5).
 *
 * @public
 */
export interface RenderTaskTiming {
  /** The task's name in the frame graph: `"shadow"`, `"scene"`, or a post-process task's own. */
  readonly name: string;
  /** How long the task took on the GPU, in milliseconds. */
  readonly durationMs: number;
}

/**
 * A per-task GPU timing snapshot (`docs/architecture/07-rendering.md` §5).
 *
 * @public
 */
export interface RenderTaskTimings {
  /**
   * Whether the numbers mean anything: `"unsupported"` on a device with no timestamp queries — the
   * CI software adapter is one — `"disabled"` until `profileTasks` is on, `"pending"` until the
   * first readback lands, `"error"` when it failed, `"ok"` otherwise.
   */
  readonly status: string;
  /** The tasks, in frame execution order. Empty unless `status` is `"ok"`. */
  readonly tasks: readonly RenderTaskTiming[];
}

/**
 * The rendering service, reached as `app.renderer`
 * (`docs/architecture/07-rendering.md` §1, §3, §5).
 *
 * @example
 * ```ts
 * app.renderer.resolutionScale = 0.75;
 * const hit = await app.renderer.pickAsync(event.offsetX, event.offsetY);
 * hit?.entity.name;
 * ```
 *
 * @public
 */
export interface Renderer {
  /**
   * The clamp on the device pixel ratio the swapchain is sized at; `0` does not clamp. Writing it
   * resizes the backing store before the next frame.
   */
  pixelRatio: number;
  /**
   * A live quality multiplier on the resolution, clamped to 0.25–1 and implemented by lowering the
   * effective device pixel ratio (`docs/architecture/07-rendering.md` §1).
   */
  resolutionScale: number;
  /** Whether per-task GPU timings are collected. Off by default; it costs timestamp queries. */
  profileTasks: boolean;
  /** Which rendering features are on. Read-only once `app.start()` has registered the scene. */
  readonly features: Readonly<RenderingFeatureSettings>;
  /** GPU draw calls in the last rendered frame. `0` under a headless app. */
  readonly drawCalls: number;
  /** How long the last measured frame took on the GPU, in milliseconds. `0` until timing is on. */
  readonly gpuFrameTimeMs: number;
  /**
   * Sets the swapchain's backing-store size explicitly, in device pixels — the `OffscreenCanvas`
   * path (`docs/architecture/07-rendering.md` §1).
   *
   * @remarks
   * On a laid-out DOM canvas the size survives exactly one frame: Lite's render loop re-reads the
   * layout size at the start of every frame. Use {@link Renderer.pixelRatio} there instead.
   *
   * @param width - The width, in device pixels.
   * @param height - The height, in device pixels.
   */
  setSize(width: number, height: number): void;
  /**
   * Compiles the material families of the given materials now, so a mesh that uses one of them
   * later draws on the next frame instead of several frames after that (ADR-0014).
   *
   * @remarks
   * `app.start()` already does this for every material in the `boot` preload group. Call it by hand
   * for a spawn-heavy game that loads a material mid-level and wants to pay the cost at a moment of
   * its choosing.
   *
   * @param materials - The materials whose families must be compiled.
   */
  warmUp(materials: readonly MaterialAsset[]): void;
  /**
   * Picks the object under one CSS pixel of the canvas, exactly, on the GPU
   * (`docs/architecture/07-rendering.md` §3).
   *
   * @remarks
   * Picks are serialised per app: Lite's picker owns one set of staging buffers and chains each
   * call onto the previous one's promise. A headless app has no picker and always misses.
   *
   * @param x - The CSS pixel x, from the canvas's left edge.
   * @param y - The CSS pixel y, from the canvas's top edge.
   * @param options - An entity filter.
   * @returns What was hit, or `null` for a miss.
   */
  pickAsync(x: number, y: number, options?: RenderPickOptions): Promise<RenderPick | null>;
  /**
   * Captures the next presented frame (`docs/architecture/07-rendering.md` §5).
   *
   * @returns The frame, as tightly packed RGBA8 with the top row first.
   * @throws IgnifxError with code `IGX-0707` when no render loop is running, because the capture
   * would never settle.
   */
  captureScreenshot(): Promise<RenderCapture>;
  /**
   * The latest per-task GPU timing snapshot. Check `status` before reading `tasks`.
   *
   * @returns The snapshot.
   */
  taskTimings(): RenderTaskTimings;
  /**
   * Declares that a rendering feature must be on — what an extension calls from `register`
   * (`docs/architecture/07-rendering.md` §1.1).
   *
   * @param feature - The feature the caller needs.
   * @throws IgnifxError with code `IGX-0704` when the render scene has already been registered, at
   * which point Lite has compiled what it is going to compile.
   */
  requireFeature(feature: RenderingFeature): void;
}

/**
 * The rendering service of one app, and the render layer's per-app state.
 *
 * @internal
 */
export class RendererImpl implements Renderer {
  /** The resolved `rendering` settings section. */
  readonly settings: RenderingSettings;

  /** `true` once a topology change needs one `rebuildSceneRenderables` this frame. */
  needsRenderableRebuild = false;

  /** `true` once a `castShadows` or caster-set change needs the caster lists rebuilt this frame. */
  needsCasterRebuild = false;

  /** `true` once a camera was added, removed, enabled, disabled, or re-prioritised. */
  needsCameraSelect = true;

  /** `true` once the world has been told it has no enabled camera, so `IGX-0706` is logged once. */
  hasLoggedNoCamera = false;

  /** How many times the sync system has rebuilt the scene's renderables; a diagnostics counter. */
  renderableRebuilds = 0;

  readonly #app: App;

  readonly #features: MutableRenderingFeatures;

  readonly #counters: DiagnosticsGroup;

  readonly #countersDrawCalls: number;

  readonly #countersGpuTime: number;

  readonly #countersCameras: number;

  readonly #countersLights: number;

  readonly #countersMeshes: number;

  readonly #countersRebuilds: number;

  #picker: LiteGpuPicker | null = null;

  #warmUp: MaterialWarmUp | null = null;

  #syncSystem: { sync(world: World): void } | null = null;

  #handles: { readonly engine: LiteEngine; readonly scene: LiteScene } | null = null;

  #presenter: ScenePresenter | null = null;

  #defaultMaterial: AssetHandle<MaterialAsset> | null = null;

  #resolutionScale = 1;

  #pixelRatio: number;

  #profileTasks = false;

  #isSceneRegistered = false;

  #isLoopRunning = false;

  /**
   * Creates the rendering service.
   *
   * @param app - The app it belongs to.
   * @param settings - The resolved `rendering` section.
   */
  constructor(app: App, settings: RenderingSettings) {
    this.#app = app;
    this.settings = settings;
    this.#features = toRenderingFeatures(settings);
    this.#pixelRatio = settings.maxDevicePixelRatio;
    const counters = app.diagnostics.registerGroup(RENDER_DIAGNOSTICS_GROUP, RENDER_DIAGNOSTICS_COUNTERS);
    this.#counters = counters;
    this.#countersDrawCalls = counters.index("drawCalls");
    this.#countersGpuTime = counters.index("gpuFrameTimeMs");
    this.#countersCameras = counters.index("cameras");
    this.#countersLights = counters.index("lights");
    this.#countersMeshes = counters.index("meshes");
    this.#countersRebuilds = counters.index("renderableRebuilds");
  }

  /**
   * The app the service belongs to.
   *
   * @returns The app.
   */
  get app(): App {
    return this.#app;
  }

  /**
   * The Lite scene the world renders into.
   *
   * @returns The scene.
   */
  get scene(): LiteScene {
    return this.#handles?.scene ?? this.#app.lite.scene;
  }

  /**
   * The Lite engine, which is also the app's primary surface.
   *
   * @returns The engine.
   */
  get engine(): LiteEngine {
    return this.#handles?.engine ?? this.#app.lite.engine;
  }

  /**
   * Whether the app runs on the null engine.
   *
   * @returns `true` when there is no device and no surface.
   */
  get isHeadless(): boolean {
    return this.#app.isHeadless;
  }

  /**
   * The offscreen render path, when the project declared `rendering.features.postProcessing`.
   *
   * @remarks
   * `null` under a headless app, and `null` when the feature is off — in which case a
   * `PostProcessStack` has nothing legal to sample and reports `IGX-0710`.
   *
   * @returns The presenter, or `null`.
   */
  get presenter(): ScenePresenter | null {
    return this.#presenter;
  }

  /**
   * Whether `app.start()` has registered the render scene, after which Lite has compiled what it is
   * going to compile.
   *
   * @returns `true` once the scene is registered.
   */
  get isSceneRegistered(): boolean {
    return this.#isSceneRegistered;
  }

  /**
   * The feature flags in their adapter form, for `applyRenderingFeatures`.
   *
   * @returns One boolean per adapter feature name.
   */
  get renderingFeatures(): RenderingFeatures {
    return this.#features;
  }

  /**
   * Which rendering features are on.
   *
   * @returns The flags. The object is the service's own; treat it as read-only.
   */
  get features(): Readonly<RenderingFeatureSettings> {
    return this.#features;
  }

  /**
   * The device pixel ratio clamp; `0` does not clamp.
   *
   * @returns The clamp.
   */
  get pixelRatio(): number {
    return this.#pixelRatio;
  }

  set pixelRatio(value: number) {
    this.#pixelRatio = Math.max(0, value);
    this.#applySurfaceScale();
  }

  /**
   * The live resolution multiplier, 0.25 to 1.
   *
   * @returns The multiplier.
   */
  get resolutionScale(): number {
    return this.#resolutionScale;
  }

  set resolutionScale(value: number) {
    this.#resolutionScale = clamp(value, MIN_RESOLUTION_SCALE, MAX_RESOLUTION_SCALE);
    this.#applySurfaceScale();
  }

  /**
   * Whether per-task GPU timings are collected.
   *
   * @returns `true` when timing is on.
   */
  get profileTasks(): boolean {
    return this.#profileTasks;
  }

  set profileTasks(value: boolean) {
    this.#profileTasks = value;
    if (this.isHeadless) {
      return;
    }
    if (value) {
      startGpuTiming(this.engine);
    } else {
      disableGpuTiming(this.engine);
    }
  }

  /**
   * GPU draw calls in the last rendered frame.
   *
   * @returns The count; `0` under a headless app.
   */
  get drawCalls(): number {
    return readDrawCallCount(this.engine);
  }

  /**
   * How long the last measured frame took on the GPU.
   *
   * @returns The time in milliseconds; `0` until timing is on and a frame has completed.
   */
  get gpuFrameTimeMs(): number {
    return readGpuFrameTimeMs(this.engine);
  }

  /**
   * Sets the swapchain's backing-store size explicitly, in device pixels.
   *
   * @param width - The width, in device pixels.
   * @param height - The height, in device pixels.
   */
  setSize(width: number, height: number): void {
    if (this.isHeadless) {
      return;
    }
    setSurfaceSizePx(this.engine, width, height);
  }

  /**
   * Compiles the material families the engine can produce, before the scene is registered
   * (ADR-0014).
   *
   * @remarks
   * ADR-0014 says `app.start()` "collects the materials of every asset in the `boot` preload group"
   * and warms those. It cannot: a preloaded asset's handle settles at the `PreUpdate` delivery
   * point of a frame (`05-assets-and-loading.md` §4), and `start()` runs before the first frame, so
   * awaiting the boot batch there would deadlock — which is exactly why the core extension does not
   * await it either.
   *
   * What the ADR actually measured makes the deadlock unnecessary. Lite stamps **every** PBR
   * material in the process with one `_buildGroup` singleton, and every Standard material with
   * another, so the unit that has to exist at `registerScene` is the *family*, not the asset: "there
   * are four families to worry about, not one per asset". This warms the two families a Phase 2
   * app can produce, plus any material already in the cache, which reaches the ADR's outcome — a
   * mesh added later takes the synchronous rebuild path — with two degenerate triangles and no
   * ordering problem.
   *
   * @internal
   */
  warmUpAtStart(): void {
    if (this.isHeadless || sceneLightCount(this.scene) === 0) {
      // A probe registered into a scene with **no** lights leaves every later mesh of that family
      // undrawn — the render pass presents nothing at all (measured on SwiftShader 2026-09-05, and
      // pinned by `test/render/warm-up.browser.test.ts`). A lightless scene draws nothing anyway
      // until a light arrives, and a mesh added then takes Lite's runtime build path, which is
      // correct; skipping the probes there costs a few frames on the first spawn and is the only
      // safe reading of ADR-0014 for a world that is still empty at `start()`.
      return;
    }
    const materials: MaterialAsset[] = [this.defaultMaterial(), buildMaterialAsset(standardProbe(), [])];
    for (const handle of this.#app.assets.manifest.entries) {
      const cached = this.#app.assets.get(handle.address);
      if (cached !== null && cached.state === "loaded" && cached.type === MATERIAL_ASSET_TYPE) {
        // Boundary assertion (coding standards §5.2): the cache is untyped, and the type name is
        // what says this entry holds a material.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        materials.push(cached.value as MaterialAsset);
      }
    }
    this.warmUp(materials);
  }

  /**
   * Compiles the material families of the given materials now (ADR-0014).
   *
   * @param materials - The materials whose families must be compiled.
   */
  warmUp(materials: readonly MaterialAsset[]): void {
    if (this.isHeadless || materials.length === 0) {
      return;
    }
    this.#warmUp = warmUpMaterialAssets(this.engine, this.scene, materials);
  }

  /**
   * Picks the object under one CSS pixel of the canvas.
   *
   * @param x - The CSS pixel x, from the canvas's left edge.
   * @param y - The CSS pixel y, from the canvas's top edge.
   * @param options - An entity filter.
   * @returns What was hit, or `null` for a miss.
   */
  async pickAsync(x: number, y: number, options?: RenderPickOptions): Promise<RenderPick | null> {
    if (this.isHeadless) {
      return null;
    }
    const picker = (this.#picker ??= createPicker(this.scene));
    const filter = options?.filter;
    const info: LitePickInfo = await pickPixel(
      picker,
      x,
      y,
      filter === undefined ? null : (tag: NodeTag | null): boolean => acceptsEntityTag(this.#app.world, tag, filter),
    );
    return this.resolvePick(info);
  }

  /**
   * Captures the next presented frame.
   *
   * @returns The frame.
   * @throws IgnifxError with code `IGX-0707` when no render loop is running.
   */
  async captureScreenshot(): Promise<RenderCapture> {
    if (this.isHeadless || !this.#isLoopRunning) {
      throw new IgnifxError(
        CoreErrorCode.screenshotNeedsRenderLoop,
        "captureScreenshot() needs a running render loop; a headless app never presents a frame.",
        {
          context: { member: "app.renderer.captureScreenshot()" },
          hint: "Call it after app.start() on a canvas-backed app; headless apps have no swapchain.",
        },
      );
    }
    return captureFrame(this.engine);
  }

  /**
   * The latest per-task GPU timing snapshot.
   *
   * @returns The snapshot.
   */
  taskTimings(): RenderTaskTimings {
    return this.isHeadless ? { status: "unsupported", tasks: [] } : readTaskTimings(this.engine);
  }

  /**
   * Declares that a rendering feature must be on.
   *
   * @param feature - The feature the caller needs.
   * @throws IgnifxError with code `IGX-0704` after the render scene has been registered.
   */
  requireFeature(feature: RenderingFeature): void {
    assertRenderingFeatureAvailable(feature, this.#isSceneRegistered);
    this.#features[feature] = true;
  }

  /**
   * The material a `MeshRenderer` draws with when it declares none
   * (`docs/architecture/07-rendering.md` §2.3): a neutral, fully rough dielectric.
   *
   * @remarks
   * Built on first use and shared by every renderer, so an app that always names its materials
   * never pays for it, and one that never does pays once. The service holds the only reference and
   * releases it on disposal.
   *
   * @returns The default material.
   *
   * @internal
   */
  defaultMaterial(): MaterialAsset {
    this.#defaultMaterial ??= createDefaultMaterialAsset(this.#app);
    return this.#defaultMaterial.value;
  }

  /**
   * Reads the render target's current size in device pixels, without allocating.
   *
   * @remarks
   * A headless app has no canvas to measure, so it reports a 1x1 target: every screen conversion
   * then degenerates predictably instead of dividing by zero (`07-rendering.md` §6).
   *
   * @param out - Receives the size.
   *
   * @param out.width - Receives the width, in device pixels.
   * @param out.height - Receives the height, in device pixels.
   * @internal
   */
  readTargetSize(out: { width: number; height: number }): void {
    if (this.isHeadless) {
      out.width = 1;
      out.height = 1;
      return;
    }
    readTargetSizePx(this.engine, out);
  }

  /**
   * Resolves a Lite pick result back to the entity and component that own the mesh.
   *
   * @param info - Lite's picking info, from the GPU picker or a CPU ray cast.
   * @returns What was hit, or `null` for a miss or a mesh ignifx did not create.
   *
   * @internal
   */
  resolvePick(info: LitePickInfo): RenderPick | null {
    if (!info.hit) {
      return null;
    }
    const tag = readPickedTag(info);
    if (tag === null) {
      return null;
    }
    const world = this.#app.world;
    const entity = world.getEntityByHandle(toEntityHandle(tag.entity));
    if (entity === null) {
      return null;
    }
    const component = tag.component;
    return {
      entity,
      component: component === undefined ? null : world.getComponentByHandle(toComponentHandle(component)),
      point: info.pickedPoint,
      normal: info.pickedNormalWorld ?? info.pickedNormal,
      distance: info.distance,
    };
  }

  /**
   * Records the Lite objects the app owns, so the service keeps working while the app is being
   * torn down.
   *
   * @remarks
   * `app.lite` refuses to answer once `dispose()` has started (`IGX-0106`), and the render layer's
   * own teardown — a component's `onDetach`, the service's disposer — runs inside that window.
   * Caching the pair the moment `createApp` builds it is what keeps a disposal from turning into a
   * cascade of `IGX-0106`s.
   *
   * @param engine - The app's engine.
   * @param scene - The app's render scene.
   * @param presenter - The offscreen render path, when `rendering.features.postProcessing` built
   * one; `null` otherwise, in which case a `PostProcessStack` reports `IGX-0710`.
   *
   * @internal
   */
  attachHandles(engine: LiteEngine, scene: LiteScene, presenter: ScenePresenter | null = null): void {
    this.#handles = { engine, scene };
    this.#presenter = presenter;
    // `rendering.clearColor` is applied here, the moment the scene exists, and never again: it is
    // the *floor* of the precedence order in {@link RendererImpl.applyClearColor}, so anything a
    // component writes later simply lands on top of it. Doing it per frame would fight the camera.
    this.applyClearColor(this.settings.clearColor);
  }

  /**
   * Writes an sRGB colour onto the render scene's clear colour, decoded to linear.
   *
   * @remarks
   * The one place `scene.clearColor` is written, so the precedence
   * `docs/architecture/07-rendering.md` §2.1 and §2.5 describe is decided by *who calls it and
   * when*, from strongest to weakest:
   *
   * 1. **`Camera.clearColor` on the main camera**, when it is not `null`. The `PreRender` system
   *    writes it every frame the camera renders, so it always wins.
   * 2. **`Environment.clearColor`** of the winning environment, written whenever the field changes.
   * 3. **The `rendering.clearColor` setting**, written once by {@link RendererImpl.attachHandles}
   *    as the scene is created — before a frame has run, and therefore before either component.
   * 4. Babylon Lite's own default, a mid grey, when the project declared no section at all. The
   *    ignifx default is opaque black (`src/render/rendering-settings.ts`), so Lite's grey is only
   *    ever seen by code that bypasses `createApp`.
   *
   * Colours are stored in sRGB in every settings section and every component field, and Lite's
   * `scene.clearColor` is linear, so each component is decoded on the way through.
   *
   * @param value - The sRGB colour, `0` to `1` per channel.
   *
   * @internal
   */
  applyClearColor(value: ColorLike): void {
    setSceneClearColor(
      this.scene,
      Color.srgbToLinear(value.r),
      Color.srgbToLinear(value.g),
      Color.srgbToLinear(value.b),
      value.a,
    );
  }

  /**
   * Reconciles the world with the Lite scene once, before the scene is registered.
   *
   * @remarks
   * `app.start()` calls it so that a world built before the app started — the documented flow, in
   * which `world.loadScene(...)` precedes `start()` — registers with its cameras, lights, and
   * meshes already in place. Everything added afterwards goes through Lite's runtime material-swap
   * path instead (`docs/architecture/07-rendering.md` §1.1).
   *
   * @param world - The world to reconcile.
   *
   * @internal
   */
  syncBeforeRegister(world: World): void {
    this.#syncSystem?.sync(world);
  }

  /**
   * Records the `PreRender` system, so `app.start()` can run one reconciliation before the scene is
   * registered without knowing what that system is.
   *
   * @param system - The render-sync system the core extension registered.
   *
   * @param system.sync - Reconciles one world against the scene, exactly as a `PreRender` tick would.
   * @internal
   */
  attachSyncSystem(system: { sync(world: World): void }): void {
    this.#syncSystem = system;
  }

  /**
   * Records that the render scene has been registered, which closes the feature gate.
   *
   * @internal
   */
  markSceneRegistered(): void {
    this.#isSceneRegistered = true;
  }

  /**
   * Records whether Babylon Lite's render loop is driving frames, which is what decides whether a
   * screenshot can ever settle.
   *
   * @param isRunning - `true` between `startRenderLoop` and `stopRenderLoop`.
   *
   * @internal
   */
  setLoopRunning(isRunning: boolean): void {
    this.#isLoopRunning = isRunning;
  }

  /**
   * Publishes the render diagnostics counters. The `PreRender` system calls it once per frame.
   *
   * @param cameras - How many `Camera` components exist.
   * @param lights - How many `Light` components exist.
   * @param meshes - How many `MeshRenderer` components exist.
   *
   * @internal
   */
  publishCounters(cameras: number, lights: number, meshes: number): void {
    const counters = this.#counters;
    counters.set(this.#countersDrawCalls, this.drawCalls);
    counters.set(this.#countersGpuTime, this.gpuFrameTimeMs);
    counters.set(this.#countersCameras, cameras);
    counters.set(this.#countersLights, lights);
    counters.set(this.#countersMeshes, meshes);
    counters.set(this.#countersRebuilds, this.renderableRebuilds);
  }

  /**
   * Releases the picker and the warm-up probes. The core extension registers it as a disposer.
   *
   * @internal
   */
  dispose(): void {
    const picker = this.#picker;
    this.#picker = null;
    if (picker !== null) {
      disposeScenePicker(picker);
    }
    const warmUp = this.#warmUp;
    this.#warmUp = null;
    if (warmUp !== null && !this.isHeadless) {
      discardMaterialWarmUp(this.scene, warmUp);
    }
    const material = this.#defaultMaterial;
    this.#defaultMaterial = null;
    material?.release();
  }

  /** Writes the effective device pixel ratio clamp onto the surface and resizes it. */
  #applySurfaceScale(): void {
    if (this.isHeadless) {
      return;
    }
    const base = this.#pixelRatio > 0 ? this.#pixelRatio : hostDevicePixelRatio();
    applySurfaceScale(this.engine, base * this.#resolutionScale);
  }
}

/**
 * Asks whether a tagged Lite node belongs to an entity a caller's filter accepts — the shared half
 * of `renderer.pickAsync`'s and `world.raycastRender`'s entity predicates.
 *
 * @param world - The world being picked in.
 * @param tag - The ignifx tag the candidate node carries, or `null` when it has none.
 * @param filter - The caller's entity predicate.
 * @returns `true` when the node may be picked.
 *
 * @internal
 */
export function acceptsEntityTag(world: World, tag: NodeTag | null, filter: (entity: Entity) => boolean): boolean {
  if (tag === null) {
    return false;
  }
  const entity = world.getEntityByHandle(toEntityHandle(tag.entity));
  return entity !== null && filter(entity);
}

/**
 * The declaration of the Standard-family probe material the start-up warm-up installs.
 *
 * @returns A neutral Standard declaration.
 */
function standardProbe(): ReturnType<typeof standardMaterialDefinition> {
  return standardMaterialDefinition({ name: "ignifx:warm-up-standard" });
}

/**
 * The host's device pixel ratio, or `1` on a host that has no `window`.
 *
 * @returns The ratio.
 */
function hostDevicePixelRatio(): number {
  return "devicePixelRatio" in globalThis ? globalThis.devicePixelRatio : 1;
}

/**
 * Reaches the engine-owned half of `app.renderer` from the render components, the `PreRender`
 * system, and the kernel, all of which only ever see the public {@link Renderer} interface.
 *
 * @param renderer - The service, normally `app.renderer`.
 * @returns The same object, typed as its implementation.
 * @throws IgnifxError with code `IGX-0702` when the object was not created by ignifx.
 *
 * @internal
 */
export function rendererInternals(renderer: Renderer): RendererImpl {
  if (renderer instanceof RendererImpl) {
    return renderer;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.renderer was not created by this copy of @ignifx/core.", {
    context: { member: "app.renderer" },
    hint: "Reach the service through the app that created it.",
  });
}
