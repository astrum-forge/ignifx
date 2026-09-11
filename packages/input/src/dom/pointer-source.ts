import type { DomSource, DomSourceOptions } from "./dom-target.js";
import type { InputEventQueue, MutableInputEvent } from "./event-queue.js";

/**
 * Use pointer events for mouse, pen, and touch to avoid counting touches twice.
 * Read presses and wheel events from the canvas, but movement and release from the window so
 * leaving the canvas cannot strand a drag. Positions use backing-store pixels for picking;
 * deltas use CSS pixels so display density does not change look sensitivity.
 */

/**
 * How many pointers the CSS-delta fallback remembers at once: ten touches plus a mouse and a pen,
 * which is the same ceiling `<Touch>` itself has.
 */
const TRACKED_POINTERS = 12;

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
    // The listener is registered non-passive so that this call counts: a wheel over a running game
    // canvas is a zoom, and letting it through would also scroll the page the canvas is embedded in
    // (`docs/architecture/08-input.md` §4).
    event.preventDefault();
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

  /** `pointerId` held by each tracking slot, or `-1` when the slot is free. */
  readonly #trackedIds: Int32Array = new Int32Array(TRACKED_POINTERS).fill(-1);

  /** The last client position of each tracked pointer, in CSS pixels, as `x, y` pairs. */
  readonly #trackedPoints: Float64Array = new Float64Array(TRACKED_POINTERS * 2);

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
    // Non-passive on purpose: `#onWheel` calls `preventDefault`, which a passive listener may not.
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
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
    this.#trackedIds.fill(-1);
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
    this.#writeDelta(entry, event, type);
    entry.button = event.button;
    entry.pointerId = event.pointerId;
    entry.pointerType = event.pointerType;
  }

  /**
   * Writes the event's motion in **CSS pixels**.
   *
   * @remarks
   * `movementX`/`movementY` are the browser's own hand-motion measurement and are what pointer lock
   * keeps reporting, so they are used whenever they say anything. Touch pointers — and pens on some
   * engines — leave them at zero, so the motion is derived from the pointer's own previous
   * `clientX`/`clientY` instead. Deriving it from the queued position would reintroduce the device
   * pixel ratio, which is exactly what these deltas must not carry.
   *
   * @param entry - The entry being filled in.
   * @param event - The DOM event.
   * @param type - The published event type; a `pointerdown` starts a track rather than moving one.
   */
  #writeDelta(entry: MutableInputEvent, event: PointerEvent, type: "pointerdown" | "pointermove" | "pointerup"): void {
    const slot = this.#slotFor(event.pointerId);
    const moved = event.movementX !== 0 || event.movementY !== 0;
    const started = type === "pointerdown" || slot < 0 || this.#trackedIds[slot] !== event.pointerId;
    if (moved) {
      entry.deltaX = event.movementX;
      entry.deltaY = event.movementY;
    } else if (started) {
      entry.deltaX = 0;
      entry.deltaY = 0;
    } else {
      entry.deltaX = event.clientX - (this.#trackedPoints[slot * 2] ?? 0);
      entry.deltaY = event.clientY - (this.#trackedPoints[slot * 2 + 1] ?? 0);
    }
    if (slot < 0) {
      return;
    }
    if (type === "pointerup") {
      // The touch is over: free the slot so the next one does not inherit its history.
      this.#trackedIds[slot] = -1;
      return;
    }
    this.#trackedIds[slot] = event.pointerId;
    this.#trackedPoints[slot * 2] = event.clientX;
    this.#trackedPoints[slot * 2 + 1] = event.clientY;
  }

  /**
   * Finds the tracking slot a `pointerId` owns, claiming a free one when it has none.
   *
   * @param pointerId - The DOM pointer id.
   * @returns The slot index, or `-1` when every slot is taken by another live pointer.
   */
  #slotFor(pointerId: number): number {
    let free = -1;
    for (let slot = 0; slot < TRACKED_POINTERS; slot += 1) {
      const id = this.#trackedIds[slot];
      if (id === pointerId) {
        return slot;
      }
      if (free < 0 && id === -1) {
        free = slot;
      }
    }
    return free;
  }

  /** The backing-store pixels per CSS pixel the last `#toCanvas` measured; `1` when unknown. */
  #scale = 1;

  /**
   * Converts a client coordinate into **backing-store pixels** from the canvas's top-left corner —
   * the canvas's `width`/`height` space that `Camera.worldToScreen`, `renderer.pickAsync`, and
   * `Camera.screenToRay` share (`docs/architecture/08-input.md` §5). At a device pixel ratio of 2 a
   * CSS pixel is two backing pixels; reporting CSS pixels here made `pickAsync(pointer.position)`
   * miss by that factor. The ratio is measured from the canvas itself (`width / rect.width`) rather
   * than `devicePixelRatio`, because `rendering.pixelRatio` may clamp the backing store.
   *
   * @param clientX - The event's `clientX`.
   * @param clientY - The event's `clientY`.
   * @returns The reused point object; copy it before the next call.
   */
  #toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.#target.canvas;
    const rect = canvas.getBoundingClientRect();
    const cssWidth: unknown = Reflect.get(rect, "width");
    const backingWidth: unknown = Reflect.get(canvas, "width");
    this.#scale =
      typeof cssWidth === "number" && cssWidth > 0 && typeof backingWidth === "number" && backingWidth > 0
        ? backingWidth / cssWidth
        : 1;
    this.#point.x = (clientX - rect.left) * this.#scale;
    this.#point.y = (clientY - rect.top) * this.#scale;
    return this.#point;
  }
}
