/**
 * What the overlay needs from the host page.
 *
 * `@ignifx/ui` declares the same three objects for the same reasons (two apps in one document,
 * `CONSTITUTION.md` §3.6; a node test hands in a fake). `@ignifx/devtools` cannot import that
 * declaration — `@ignifx/ui` is an optional peer and a core-only game must still be able to open
 * the overlay — so it declares its own, which is also why the two are structurally identical.
 */

/**
 * The DOM objects one app's overlay is built in.
 *
 * @public
 */
export interface DevtoolsDomTarget {
  /** The canvas the overlay is positioned over. */
  readonly canvas: HTMLCanvasElement;
  /** The document the overlay's elements and its stylesheet are created in. */
  readonly document: Document;
  /** The window the toggle key and resize events are read from. */
  readonly window: Window;
}

/**
 * Narrows an unknown render surface to a DOM canvas, so a headless app or an `OffscreenCanvas`
 * simply gets no overlay.
 *
 * @param surface - The renderer's surface, or anything else.
 * @returns The canvas, or `null` when there is no DOM canvas to overlay.
 *
 * @internal
 */
export function asDomCanvas(surface: unknown): HTMLCanvasElement | null {
  if (typeof HTMLCanvasElement === "undefined") {
    return null;
  }
  return surface instanceof HTMLCanvasElement ? surface : null;
}

/**
 * Builds the DOM target from a render surface.
 *
 * @param surface - The renderer's surface, or anything else.
 * @returns The target, or `null` for a headless app, an `OffscreenCanvas`, or a detached canvas.
 *
 * @internal
 */
export function resolveDevtoolsTarget(surface: unknown): DevtoolsDomTarget | null {
  const canvas = asDomCanvas(surface);
  if (canvas === null) {
    return null;
  }
  const document = canvas.ownerDocument;
  const view = document.defaultView;
  if (view === null) {
    return null;
  }
  return { canvas, document, window: view };
}
