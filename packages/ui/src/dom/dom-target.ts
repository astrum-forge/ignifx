/**
 * What the overlay host needs from the host page (`docs/architecture/13-ui.md` §1). Passing it
 * explicitly, instead of reaching for `globalThis.document`, is what makes two apps in one document
 * possible (`CONSTITUTION.md` §3.6) and what lets a test hand in a fake.
 *
 * The whole module is written against the real DOM types rather than structural stand-ins, which is
 * the choice `@ignifx/input`'s `DomTarget` already made: games get real elements to mount React or
 * Svelte into, and the node test suite passes a fake through one `as unknown as` in
 * `test/support/fake-dom.ts` rather than every call site paying for an abstraction.
 */

/**
 * The DOM objects one app's overlay is built in.
 *
 * @public
 */
export interface UiDomTarget {
  /** The canvas the overlay is positioned over. */
  readonly canvas: HTMLCanvasElement;
  /** The document the overlay's elements and its stylesheet are created in. */
  readonly document: Document;
  /** The window resize and focus events are read from, and the pixel ratio is read from. */
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
 * @remarks
 * Returns `null` — which is what makes every overlay member a documented no-op
 * (`docs/architecture/07-rendering.md` §6) — for a headless app, for an `OffscreenCanvas`, and for
 * a canvas that has been removed from its document, because a detached canvas has no
 * `defaultView` to subscribe to.
 *
 * @param surface - The renderer's surface, or anything else.
 * @returns The target, or `null` when there is no DOM to build an overlay in.
 *
 * @internal
 */
export function resolveDomTarget(surface: unknown): UiDomTarget | null {
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
