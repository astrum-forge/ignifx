import type { DomSource, DomSourceOptions } from "./dom-target.js";
import type { InputEventQueue } from "./event-queue.js";

/**
 * The pointing adapter (`docs/architecture/08-input.md` §4). One adapter serves `Mouse`, `Pointer`,
 * and `Touch`, because DOM **pointer events** already unify them: a touch fires `pointerdown` with
 * `pointerType === "touch"` and its own `pointerId`, which is exactly the slot model `<Touch>`
 * needs. Subscribing to `touchstart`/`touchmove` as well would double-count every touch, so this
 * build does not; the only thing the touch events are still used for is suppressing the browser's
 * default scroll/zoom gestures, which `touch-action: none` on the canvas does declaratively.
 *
 * `pointerdown` and `wheel` are read from the canvas — a wheel over the page's chrome is not game
 * input — while `pointermove`, `pointerup`, and `pointercancel` are read from the window, so a drag
 * that leaves the canvas still ends.
 */

/** What {@link PointerSource} needs beyond the shared options. */
export interface PointerSourceOptions extends DomSourceOptions {
  /**
   * Whether pointer lock is active.
   *
   * @returns `true` while the canvas holds the pointer.
   */
  readonly isLocked: () => boolean;
}

/**
 * Translates pointer and wheel events into queue entries.
 *
 * @internal
 */
export class PointerSource implements DomSource {
  readonly #target: DomSourceOptions["target"];

  readonly #queue: InputEventQueue;

  readonly #isLocked: () => boolean;

  #attached = false;

  readonly #onPointerDown = (event: PointerEvent): void => {
    this.#pushPointer("pointerdown", event);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    this.#pushPointer("pointermove", event);
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    this.#pushPointer("pointerup", event);
  };

  readonly #onWheel = (event: WheelEvent): void => {
    const entry = this.#queue.push("wheel");
    entry.deltaX = event.deltaX;
    entry.deltaY = event.deltaY;
    const point = this.#toCanvas(event.clientX, event.clientY);
    entry.x = point.x;
    entry.y = point.y;
  };

  readonly #onContextMenu = (event: Event): void => {
    // A right-click is a game button while the pointer is locked; letting the browser open its menu
    // would drop the lock (`docs/architecture/08-input.md` §4).
    if (this.#isLocked()) {
      event.preventDefault();
    }
  };

  readonly #point = { x: 0, y: 0 };

  /**
   * Builds the adapter.
   *
   * @param options - The DOM target, the queue, and the pointer-lock probe.
   */
  constructor(options: PointerSourceOptions) {
    this.#target = options.target;
    this.#queue = options.queue;
    this.#isLocked = options.isLocked;
  }

  /** Subscribes to the DOM. */
  attach(): void {
    if (this.#attached) {
      return;
    }
    this.#attached = true;
    const { canvas, window: view } = this.#target;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("wheel", this.#onWheel, { passive: true });
    canvas.addEventListener("contextmenu", this.#onContextMenu);
    view.addEventListener("pointermove", this.#onPointerMove);
    view.addEventListener("pointerup", this.#onPointerUp);
    view.addEventListener("pointercancel", this.#onPointerUp);
  }

  /** Unsubscribes. Calling it twice is a no-op. */
  detach(): void {
    if (!this.#attached) {
      return;
    }
    this.#attached = false;
    const { canvas, window: view } = this.#target;
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("wheel", this.#onWheel);
    canvas.removeEventListener("contextmenu", this.#onContextMenu);
    view.removeEventListener("pointermove", this.#onPointerMove);
    view.removeEventListener("pointerup", this.#onPointerUp);
    view.removeEventListener("pointercancel", this.#onPointerUp);
  }

  /**
   * Queues one pointer event.
   *
   * @param type - The published event type.
   * @param event - The DOM event.
   */
  #pushPointer(type: "pointerdown" | "pointermove" | "pointerup", event: PointerEvent): void {
    const entry = this.#queue.push(type);
    const point = this.#toCanvas(event.clientX, event.clientY);
    entry.x = point.x;
    entry.y = point.y;
    entry.deltaX = event.movementX;
    entry.deltaY = event.movementY;
    entry.button = event.button;
    entry.pointerId = event.pointerId;
    entry.pointerType = event.pointerType;
  }

  /**
   * Converts a client coordinate into CSS pixels from the canvas's top-left corner.
   *
   * @param clientX - The event's `clientX`.
   * @param clientY - The event's `clientY`.
   * @returns The reused point object; copy it before the next call.
   */
  #toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#target.canvas.getBoundingClientRect();
    this.#point.x = clientX - rect.left;
    this.#point.y = clientY - rect.top;
    return this.#point;
  }
}
