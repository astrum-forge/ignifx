import { compileLayerShader, visibleBounds } from "../lite/sprite-layer.js";
import { ParallaxLayer } from "../sprite/parallax-layer.js";
import { SpriteLayerEffect } from "../sprite/sprite-layer-effect.js";
import { TilemapRenderer } from "../tilemap/tilemap-renderer.js";
import { SpriteLayerRegistry } from "./layer-registry.js";
import { SortingLayerTable } from "./sorting-layers.js";
import type { Camera2D } from "../camera/camera-2d.js";
import type { LiteBounds2D, LiteSprite2DLayer, LiteSpriteCustomShader, LiteSpriteRenderer } from "../lite/types.js";
import type { TwoDSettings } from "../settings.js";
import type { App, Disconnect, SceneInstance, World } from "@ignifx/core";

/**
 * State shared by the 2D service and systems, owned by one app.
 * Create the sprite renderer on the first `PreRender`: core registers its render scene during
 * `app.start()`, and the sprite renderer must be registered afterwards to draw on top.
 */

/**
 * The Babylon Lite objects `app.twoD` owns.
 *
 * @public
 */
export interface TwoDLiteHandles {
  /** The sprite rendering context, or `null` under a headless app or before the first frame. */
  readonly renderer: LiteSpriteRenderer | null;
}

/**
 * What {@link TwoDRuntime} needs to build itself.
 *
 * @internal
 */
export interface TwoDRuntimeOptions {
  /** The app the runtime belongs to. */
  readonly app: App;
  /** The resolved `twoD` settings, options merged over the section. */
  readonly settings: TwoDSettings;
  /** The project's sorting layers, back to front. */
  readonly sortingLayers: readonly string[];
  /** Creates and registers the Lite sprite renderer; `null` under a headless app. */
  readonly createRenderer: (() => LiteSpriteRenderer) | null;
  /** Adds a layer to the renderer's draw list. */
  readonly attachLayer: (renderer: LiteSpriteRenderer, layer: LiteSprite2DLayer) => void;
  /** Removes a layer from the renderer's draw list. */
  readonly detachLayer: (renderer: LiteSpriteRenderer, layer: LiteSprite2DLayer) => void;
  /** Tears the renderer down. */
  readonly destroyRenderer: (renderer: LiteSpriteRenderer) => void;
}

/**
 * One app's 2D runtime state.
 *
 * @internal
 */
export class TwoDRuntime {
  readonly #app: App;

  #settings: TwoDSettings;

  readonly #sortingLayers: SortingLayerTable;

  readonly #registry: SpriteLayerRegistry;

  readonly #options: TwoDRuntimeOptions;

  #renderer: LiteSpriteRenderer | null = null;

  #hasTriedRenderer = false;

  #camera: Camera2D | null = null;

  #parallax: readonly ParallaxLayer[] = [];

  #syncedThisFrame = 0;

  #spriteCount = 0;

  /** Reused by {@link TwoDRuntime.cameraBounds}. */
  readonly #bounds: LiteBounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** Reused when collecting layers for a bounds read. */
  readonly #boundsLayers: LiteSprite2DLayer[] = [];

  /** The effects seen this frame, by sorting layer. */
  readonly #effects = new Map<string, SpriteLayerEffect>();

  /** Compiled shaders, cached by WGSL body so one source compiles once. */
  readonly #shaders = new Map<string, LiteSpriteCustomShader>();

  /** Reused by {@link TwoDRuntime.writeEffectParams}. */
  readonly #params = new Float32Array(4);

  /** Applies a scene file's `settings.twoD` block and spawns its tile objects. */
  #onSceneLoaded: ((scene: SceneInstance) => void) | null = null;

  /** Detaches the scene hook when the world goes away. */
  #disconnectScene: Disconnect | null = null;

  /**
   * Builds the runtime.
   *
   * @param options - The app, the settings, the sorting layers, and the Lite hooks.
   */
  constructor(options: TwoDRuntimeOptions) {
    this.#app = options.app;
    this.#settings = options.settings;
    this.#options = options;
    this.#sortingLayers = new SortingLayerTable(options.sortingLayers);
    this.#registry = new SpriteLayerRegistry(
      this.#sortingLayers,
      options.settings.ySort,
      (layer: LiteSprite2DLayer): void => {
        const renderer = this.#renderer;
        if (renderer !== null) {
          options.attachLayer(renderer, layer);
        }
      },
      (layer: LiteSprite2DLayer): void => {
        const renderer = this.#renderer;
        if (renderer !== null) {
          options.detachLayer(renderer, layer);
        }
      },
    );
    this.#registry.setShaderProvider((sortingLayer: string): LiteSpriteCustomShader | null =>
      this.#shaderFor(sortingLayer),
    );
  }

  /**
   * The resolved settings.
   *
   * @returns The `twoD` settings, after any scene-file override.
   */
  get settings(): TwoDSettings {
    return this.#settings;
  }

  /**
   * How many pixels one world metre spans.
   *
   * @returns The conversion factor.
   */
  get pixelsPerUnit(): number {
    return this.#settings.pixelsPerUnit;
  }

  /**
   * The sorting-layer resolver.
   *
   * @returns The table.
   */
  get sortingLayers(): SortingLayerTable {
    return this.#sortingLayers;
  }

  /**
   * The layer pool.
   *
   * @returns The registry.
   */
  get layers(): SpriteLayerRegistry {
    return this.#registry;
  }

  /**
   * The Lite sprite renderer, or `null`.
   *
   * @returns The renderer, or `null` under a headless app or before the first frame.
   */
  get renderer(): LiteSpriteRenderer | null {
    return this.#renderer;
  }

  /**
   * The camera the last frame drew through, or `null`.
   *
   * @returns The camera.
   */
  get mainCamera(): Camera2D | null {
    return this.#camera;
  }

  /**
   * How many sprites the last frame actually wrote to Lite.
   *
   * @returns The count.
   */
  get syncedLastFrame(): number {
    return this.#syncedThisFrame;
  }

  /**
   * How many `SpriteRenderer` components the last frame walked.
   *
   * @returns The count.
   */
  get spriteCount(): number {
    return this.#spriteCount;
  }

  /**
   * The surface width the views are sized against, in pixels.
   *
   * @returns The width; `0` under a headless app.
   */
  get viewportWidthPx(): number {
    const surface = this.#app.renderer.surface;
    return surface === null ? 0 : surface.width;
  }

  /**
   * The surface height the views are sized against, in pixels.
   *
   * @returns The height; `0` under a headless app.
   */
  get viewportHeightPx(): number {
    const surface = this.#app.renderer.surface;
    return surface === null ? 0 : surface.height;
  }

  /**
   * Installs the callback that reacts to a scene load.
   *
   * @remarks
   * The extension cannot connect `world.onSceneLoaded` itself: `register` runs before the world
   * exists, and `onStart` runs only when a game calls `app.start()` — which a headless tool or a
   * test may never do. `System.onWorldCreated` is the one hook that fires for every world, started
   * or not, so the sync system routes it here.
   *
   * @param handler - What to run for each loaded scene.
   */
  setSceneHandler(handler: (scene: SceneInstance) => void): void {
    this.#onSceneLoaded = handler;
  }

  /**
   * Connects the scene hook to a world.
   *
   * @param world - The world that was just created.
   */
  attachWorld(world: World): void {
    this.#disconnectScene?.();
    this.#disconnectScene = world.onSceneLoaded.connect((scene: SceneInstance): void => {
      this.#onSceneLoaded?.(scene);
    });
  }

  /**
   * Disconnects the scene hook.
   */
  detachWorld(): void {
    this.#disconnectScene?.();
    this.#disconnectScene = null;
  }

  /**
   * Replaces the settings, which a scene file's `settings.twoD` block does at load time.
   *
   * @param settings - The new settings.
   */
  applySettings(settings: TwoDSettings): void {
    this.#settings = settings;
  }

  /**
   * Records the frame's camera.
   *
   * @param camera - The camera, or `null`.
   */
  setMainCamera(camera: Camera2D | null): void {
    this.#camera = camera;
  }

  /**
   * Records the parallax components the sync system should offset views for.
   *
   * @param layers - The components.
   */
  setParallaxLayers(layers: readonly ParallaxLayer[]): void {
    this.#parallax = layers;
  }

  /**
   * Offsets each parallax layer's view by the camera's motion times `1 - factor`
   * (`docs/architecture/11-2d-toolkit.md` §2.6).
   */
  applyParallax(): void {
    const camera = this.#camera;
    if (camera === null || this.#parallax.length === 0) {
      return;
    }
    const entries = this.#registry.describe();
    for (let index = 0; index < this.#parallax.length; index += 1) {
      const layer = this.#parallax[index];
      if (layer === undefined || !layer.isEnabledInHierarchy) {
        continue;
      }
      layer.applyTo(entries, camera, this.#settings.pixelsPerUnit);
    }
  }

  /**
   * The layer-pixel rectangle the camera can currently see, for chunk culling.
   *
   * @remarks
   * Read off the first world layer's view, which the sync system has already written this frame.
   * Every world layer carries the same view, so any of them answers; `null` means there is no world
   * layer yet, in which case a tilemap builds every chunk and culls from the next frame on.
   *
   * @returns The bounds, or `null`.
   */
  cameraBounds(): LiteBounds2D | null {
    const layers = this.#registry.collectLayers(true, this.#boundsLayers);
    const first = layers[0];
    if (first === undefined || this.viewportWidthPx === 0) {
      return null;
    }
    return visibleBounds(first.view, this.viewportWidthPx, this.viewportHeightPx, this.#bounds);
  }

  /**
   * Advances every animated tile on the 2D animation clock.
   *
   * @remarks
   * Implements `AnimatedTilemapSink`, which is what lets the animation system drive tilemaps
   * without importing the renderer.
   *
   * @param world - The world holding the tilemaps.
   * @param deltaSeconds - The scaled frame delta.
   */
  advanceAnimatedTiles(world: World, deltaSeconds: number): void {
    const renderers = world.components(TilemapRenderer);
    for (let index = 0; index < renderers.length; index += 1) {
      const renderer = renderers[index];
      if (renderer !== undefined && renderer.isEnabledInHierarchy && renderer.advanceAnimation(deltaSeconds)) {
        renderer.invalidate();
      }
    }
  }

  /**
   * Records the enabled `SpriteLayerEffect` of each sorting layer, so the registry can reach one
   * when it creates a layer.
   *
   * @param world - The world to walk.
   */
  collectEffects(world: World): void {
    const effects = world.components(SpriteLayerEffect);
    this.#effects.clear();
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      if (effect !== undefined && effect.isEnabledInHierarchy) {
        this.#effects.set(effect.sortingLayer, effect);
      }
    }
    const parallax: ParallaxLayer[] = [];
    const layers = world.components(ParallaxLayer);
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer !== undefined) {
        parallax.push(layer);
      }
    }
    this.setParallaxLayers(parallax);
  }

  /**
   * Writes every effect's `fx.params` vec4 onto its sorting layer's Lite layers.
   */
  writeEffectParams(): void {
    for (const [sortingLayer, effect] of this.#effects) {
      effect.writeParams(this.#params);
      this.#registry.writeShaderParams(sortingLayer, this.#params);
    }
  }

  /**
   * The compiled custom shader a sorting layer's Lite layers are created with.
   *
   * @param sortingLayer - The sorting layer's name.
   * @returns The shader, or `null` when no effect covers the layer.
   */
  #shaderFor(sortingLayer: string): LiteSpriteCustomShader | null {
    const effect = this.#effects.get(sortingLayer);
    if (effect === undefined) {
      return null;
    }
    const source = effect.source();
    const cached = this.#shaders.get(source);
    if (cached !== undefined) {
      return cached;
    }
    const compiled = compileLayerShader(source);
    this.#shaders.set(source, compiled);
    return compiled;
  }

  /**
   * Publishes the frame's sync counters.
   *
   * @param synced - How many sprites were written.
   * @param total - How many sprite components were walked.
   */
  reportSynced(synced: number, total: number): void {
    this.#syncedThisFrame = synced;
    this.#spriteCount = total;
  }

  /**
   * Creates and registers the Lite sprite renderer, once, on the first frame that can.
   *
   * @remarks
   * Idempotent, and a no-op under a headless app or once a first attempt has failed. See the
   * module's own remarks for why this cannot happen in `onStart`.
   */
  ensureRenderer(): void {
    if (this.#hasTriedRenderer || this.#options.createRenderer === null) {
      return;
    }
    this.#hasTriedRenderer = true;
    const renderer = this.#options.createRenderer();
    this.#renderer = renderer;
    // Layers created before the renderer existed have to be attached now, in draw order.
    const entries = this.#registry.describe();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry !== undefined) {
        this.#options.attachLayer(renderer, entry.layer);
      }
    }
  }

  /**
   * Drops every layer and the renderer.
   */
  dispose(): void {
    this.detachWorld();
    this.#registry.clear();
    const renderer = this.#renderer;
    this.#renderer = null;
    if (renderer !== null) {
      this.#options.destroyRenderer(renderer);
    }
  }
}
