import type { DomTarget } from "./dom-target.js";

/**
 * Cursor visibility (`docs/architecture/08-input.md` §4). Hiding the cursor is a CSS property on
 * the canvas, so it is restored exactly — the previous inline value is remembered rather than
 * assumed to be empty.
 */

/**
 * The cursor controller, reached as `app.input.cursor`.
 *
 * @example
 * ```ts
 * app.input.cursor.visible = false;
 * ```
 *
 * @public
 */
export class Cursor {
  #target: DomTarget | null = null;

  #visible = true;

  #previous = "";

  /**
   * Whether the mouse cursor is drawn over the canvas. Assigning `false` applies `cursor: none` to
   * the canvas; a headless app records the value and does nothing else.
   *
   * @returns `true` unless the cursor has been hidden.
   */
  get visible(): boolean {
    return this.#visible;
  }

  // A second TSDoc block on the setter is API Extractor's `ae-setter-with-docs` warning, which
  // fails the non-local `api-report` run; the accessor pair is documented on the getter above.
  // eslint-disable-next-line jsdoc/require-jsdoc -- see the note above.
  set visible(value: boolean) {
    if (this.#visible === value) {
      return;
    }
    this.#visible = value;
    this.#apply();
  }

  /**
   * Binds the controller to a canvas and applies the current value.
   *
   * @param target - The DOM objects this app owns.
   *
   * @internal
   */
  attach(target: DomTarget): void {
    this.#target = target;
    this.#previous = target.canvas.style.cursor;
    this.#apply();
  }

  /**
   * Restores the canvas's original cursor and unbinds.
   *
   * @internal
   */
  detach(): void {
    const target = this.#target;
    if (target !== null) {
      target.canvas.style.cursor = this.#previous;
    }
    this.#target = null;
  }

  /** Writes the current value onto the canvas. */
  #apply(): void {
    const target = this.#target;
    if (target === null) {
      return;
    }
    target.canvas.style.cursor = this.#visible ? this.#previous : "none";
  }
}
