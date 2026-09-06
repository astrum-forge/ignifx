import { UI_CLASS_NAMES } from "./styles.js";

/**
 * One named stacking layer inside the overlay root (`docs/architecture/13-ui.md` §1:
 * "games mount React/Preact/Svelte/Vue/vanilla trees into it, or into named layers"*).
 *
 * A layer is a plain absolutely-positioned `<div>` that fills the root, carries a `z-index`, and is
 * `pointer-events: none` like the root — children opt in with the
 * {@link UI_CLASS_NAMES.interactive} class or their own CSS. Under a headless app the layer still
 * exists as an object, with `element` `null` and every mutation a no-op, so game code never has to
 * branch on the environment.
 */

/**
 * Options accepted by `app.ui.layer`.
 *
 * @public
 */
export interface UiLayerOptions {
  /** The stacking order. Defaults to the layer's declaration index times `UI_LAYER_Z_STEP`. */
  readonly zIndex?: number;
  /** Whether the layer starts visible. Defaults to `true`. */
  readonly visible?: boolean;
}

/**
 * A named layer of the overlay.
 *
 * @example
 * ```ts
 * const hud = app.ui.layer("hud");
 * hud.element?.append(document.createElement("div"));
 * hud.visible = false;
 * ```
 *
 * @public
 */
export class UiLayer {
  /** The name the layer is addressed by. */
  readonly name: string;

  #element: HTMLDivElement | null;

  #zIndex: number;

  #visible: boolean;

  /**
   * Builds a layer. `app.ui.layer` does this; a game never constructs one.
   *
   * @param name - The layer name.
   * @param element - The layer's element, or `null` under a headless app.
   * @param zIndex - The initial stacking order.
   * @param visible - Whether the layer starts visible.
   *
   * @internal
   */
  constructor(name: string, element: HTMLDivElement | null, zIndex: number, visible: boolean) {
    this.name = name;
    this.#element = element;
    this.#zIndex = zIndex;
    this.#visible = visible;
    if (element !== null) {
      this.#dress(element);
    }
  }

  /**
   * Gives a layer that was created before the overlay mounted its element.
   *
   * @remarks
   * The host builds its root when the world is created, which is after every extension registered;
   * a layer declared in the `ui` settings section therefore exists as an object first and gets its
   * element a moment later. Nothing observable changes: an unmounted layer is exactly a headless
   * one.
   *
   * @param element - The layer's element.
   *
   * @internal
   */
  attach(element: HTMLDivElement): void {
    this.#element = element;
    this.#dress(element);
  }

  /**
   * The layer's element, or `null` when the app has no DOM overlay.
   *
   * @returns The `<div>` a game mounts its tree into.
   */
  get element(): HTMLDivElement | null {
    return this.#element;
  }

  /**
   * The layer's stacking order within the root.
   *
   * @returns The `z-index`.
   */
  get zIndex(): number {
    return this.#zIndex;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set zIndex(value: number) {
    if (this.#zIndex === value) {
      return;
    }
    this.#zIndex = value;
    this.#applyZIndex();
  }

  /**
   * Whether the layer is shown. Hiding a layer hides everything mounted in it without unmounting
   * anything, which is what a pause menu wants.
   *
   * @returns `true` while the layer is shown.
   */
  get visible(): boolean {
    return this.#visible;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set visible(value: boolean) {
    if (this.#visible === value) {
      return;
    }
    this.#visible = value;
    this.#applyVisibility();
  }

  /**
   * Removes every child of the layer without removing the layer itself.
   *
   * @remarks
   * A no-op under a headless app.
   */
  clear(): void {
    const element = this.#element;
    if (element !== null) {
      element.replaceChildren();
    }
  }

  /**
   * Writes the layer's name, class, order, and visibility onto a fresh element.
   *
   * @param element - The element to dress.
   */
  #dress(element: HTMLDivElement): void {
    element.className = UI_CLASS_NAMES.layer;
    element.dataset["ignifxLayer"] = this.name;
    this.#applyZIndex();
    this.#applyVisibility();
  }

  /** Writes the current `z-index` onto the element. */
  #applyZIndex(): void {
    this.#element?.style.setProperty("z-index", String(this.#zIndex));
  }

  /** Writes the current visibility onto the element. */
  #applyVisibility(): void {
    this.#element?.style.setProperty("display", this.#visible ? "block" : "none");
  }
}
