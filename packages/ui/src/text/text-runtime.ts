import type { LiteTextLayer, LiteTextRenderer } from "../lite/text.js";

/**
 * The text renderer's life, injected rather than imported so the node suite covers it
 * (`docs/architecture/11-2d-toolkit.md` §1 uses the same shape for the sprite renderer, and
 * `07-rendering.md` §1 is the rule both follow).
 *
 * ## Why the renderer is created lazily
 *
 * A `TextRenderer` must be registered **after** the render scene, so it composites over the frame
 * rather than under it. An extension's `register` runs before the scene exists and its `onStart`
 * runs only when a game calls `app.start()` — which a headless tool never does. Creating it on the
 * first `PreRender` tick is the one moment that satisfies both: the scene is registered, and a
 * headless app never gets there because it has no renderer factory in the first place.
 */

/**
 * The renderer operations the runtime needs, supplied by the extension so this module never imports
 * `@babylonjs/lite`.
 *
 * @internal
 */
export interface TextRuntimeOptions {
  /** Creates and registers the renderer, or `null` under a headless app. */
  readonly createRenderer: (() => LiteTextRenderer) | null;
  /** Adds a layer to the renderer's draw list. */
  readonly attachLayer: (renderer: LiteTextRenderer, layer: LiteTextLayer) => void;
  /** Removes a layer from the renderer's draw list. */
  readonly detachLayer: (renderer: LiteTextRenderer, layer: LiteTextLayer) => boolean;
  /** Unregisters and disposes the renderer. */
  readonly destroyRenderer: (renderer: LiteTextRenderer) => void;
}

/**
 * Owns the one text renderer an app has, and the layers registered on it.
 *
 * @internal
 */
export class TextRuntime {
  readonly #options: TextRuntimeOptions;

  readonly #pending = new Set<LiteTextLayer>();

  readonly #attached = new Set<LiteTextLayer>();

  #renderer: LiteTextRenderer | null = null;

  #disposed = false;

  /**
   * Builds the runtime. The extension does this.
   *
   * @param options - The renderer operations.
   */
  constructor(options: TextRuntimeOptions) {
    this.#options = options;
  }

  /**
   * The renderer, once it exists.
   *
   * @returns The renderer, or `null` before the first frame and under a headless app.
   */
  get renderer(): LiteTextRenderer | null {
    return this.#renderer;
  }

  /**
   * How many layers are currently drawn.
   *
   * @returns The count.
   */
  get layerCount(): number {
    return this.#attached.size + this.#pending.size;
  }

  /**
   * Creates the renderer if it does not exist yet and flushes the layers that were registered
   * before it did. The UI text system calls this at the top of every `PreRender`.
   */
  ensureRenderer(): void {
    if (this.#disposed || this.#renderer !== null || this.#options.createRenderer === null) {
      return;
    }
    const renderer = this.#options.createRenderer();
    this.#renderer = renderer;
    for (const layer of this.#pending) {
      this.#options.attachLayer(renderer, layer);
      this.#attached.add(layer);
    }
    this.#pending.clear();
  }

  /**
   * Starts drawing a layer.
   *
   * @param layer - The layer.
   */
  addLayer(layer: LiteTextLayer): void {
    if (this.#disposed || this.#attached.has(layer) || this.#pending.has(layer)) {
      return;
    }
    const renderer = this.#renderer;
    if (renderer === null) {
      this.#pending.add(layer);
      return;
    }
    this.#options.attachLayer(renderer, layer);
    this.#attached.add(layer);
  }

  /**
   * Stops drawing a layer and frees its per-layer GPU buffers.
   *
   * @param layer - The layer.
   */
  removeLayer(layer: LiteTextLayer): void {
    this.#pending.delete(layer);
    if (!this.#attached.delete(layer)) {
      return;
    }
    const renderer = this.#renderer;
    if (renderer !== null) {
      this.#options.detachLayer(renderer, layer);
    }
  }

  /** Tears the renderer down. The extension calls this from `onDispose`. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const renderer = this.#renderer;
    this.#pending.clear();
    this.#attached.clear();
    this.#renderer = null;
    if (renderer !== null) {
      this.#options.destroyRenderer(renderer);
    }
  }
}
