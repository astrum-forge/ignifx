import type { InputEventQueue } from "./event-queue.js";

/**
 * What the DOM adapters under `src/dom/` need from the host page
 * (`docs/architecture/08-input.md` §4). Passing it explicitly, instead of reaching for globals,
 * is what makes two apps in one document possible (`CONSTITUTION.md` §3.6) and what lets a test
 * hand in its own canvas.
 */

/**
 * The DOM objects one app's input adapters subscribe to.
 *
 * @public
 */
export interface DomTarget {
  /** The canvas pointer and wheel events are read from, and pointer lock is requested on. */
  readonly canvas: HTMLCanvasElement;
  /** The window keyboard events and `blur` are read from. */
  readonly window: Window;
  /** The document `visibilitychange` and `pointerlockchange` are read from. */
  readonly document: Document;
}

/**
 * One adapter's subscription lifetime.
 *
 * @public
 */
export interface DomSource {
  /** Subscribes to the DOM. */
  attach(): void;
  /** Unsubscribes. Calling it twice is a no-op. */
  detach(): void;
}

/**
 * What every DOM adapter is constructed with.
 *
 * @internal
 */
export interface DomSourceOptions {
  /** The DOM objects to subscribe to. */
  readonly target: DomTarget;
  /** Where the translated events are queued. */
  readonly queue: InputEventQueue;
}

/**
 * Narrows an unknown surface to a DOM canvas, so a headless app or an `OffscreenCanvas` simply gets
 * no DOM wiring.
 *
 * @param surface - The engine's render surface, or anything else.
 * @returns The canvas, or `null` when there is no DOM canvas to subscribe to.
 *
 * @internal
 */
export function asDomCanvas(surface: unknown): HTMLCanvasElement | null {
  if (typeof HTMLCanvasElement === "undefined") {
    return null;
  }
  return surface instanceof HTMLCanvasElement ? surface : null;
}
