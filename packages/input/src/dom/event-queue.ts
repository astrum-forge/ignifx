import type { InputDevice } from "../devices/device.js";

/**
 * The frame's raw event stream (`docs/architecture/08-input.md` §1 and §5). Browser events are
 * **queued** as they arrive and applied once, in `PreUpdate`, in arrival order. Nothing is applied
 * on arrival: a key pressed and released between two frames must still be visible to that frame's
 * `wasPressedThisFrame`.
 *
 * Records are pooled. One frame's published records stay valid for the whole frame and are returned
 * to the pool at the start of the next drain, so a steady stream of events allocates nothing after
 * the pool has grown to the frame's high-water mark (coding standards §7).
 */

/**
 * The raw event kinds `app.input.events` publishes.
 *
 * @public
 */
export type InputEventType = "keydown" | "keyup" | "pointerdown" | "pointerup" | "pointermove" | "wheel" | "textinput";

/** The queue's own kinds: the published ones, plus the two the resolver consumes silently. */
type QueuedKind = InputEventType | "releaseAll" | "control";

/**
 * One raw event of the current frame (`docs/architecture/08-input.md` §5).
 *
 * @remarks
 * Every field is always present; the ones an event kind does not use read `0` or `""`. A fixed
 * shape is what lets the records be pooled, and reading `deltaX` on a `keydown` is harmless.
 *
 * Pointer **positions** are backing-store pixels and pointer **deltas** are CSS pixels; the two
 * spaces differ by the device pixel ratio and the render scale, and §5 of the architecture document
 * says why each is where it is.
 *
 * The records are recycled: keep a copy of anything needed after the frame ends.
 *
 * @public
 */
export interface InputEventRecord {
  /** Which kind of event this is. */
  readonly type: InputEventType;
  /** A monotonically increasing arrival number, shared by every event of one app. */
  readonly sequence: number;
  /** The physical `KeyboardEvent.code`, for key events. */
  readonly code: string;
  /** The layout-dependent `KeyboardEvent.key`, or the composed text of a `textinput` event. */
  readonly key: string;
  /** Whether a key event is an auto-repeat. */
  readonly repeat: boolean;
  /** The pointer x, in backing-store pixels from the canvas's left edge. */
  readonly x: number;
  /** The pointer y, in backing-store pixels from the canvas's top edge. */
  readonly y: number;
  /** The pointer movement x, in **CSS** pixels, or the wheel's horizontal delta. */
  readonly deltaX: number;
  /** The pointer movement y, in **CSS** pixels, or the wheel's vertical delta. */
  readonly deltaY: number;
  /** The `PointerEvent.button` index, for pointer events. */
  readonly button: number;
  /** The `PointerEvent.pointerId`, for pointer events. */
  readonly pointerId: number;
  /** The `PointerEvent.pointerType`: `mouse`, `pen`, or `touch`. */
  readonly pointerType: string;
}

/** One pooled queue entry: an {@link InputEventRecord} plus the internal routing fields. */
class QueuedEvent implements InputEventRecord {
  kind: QueuedKind = "control";
  type: InputEventType = "keydown";
  sequence = 0;
  code = "";
  key = "";
  repeat = false;
  x = 0;
  y = 0;
  deltaX = 0;
  deltaY = 0;
  button = 0;
  pointerId = 0;
  pointerType = "";
  device: InputDevice | null = null;
  controlIndex = -1;
  valueX = 0;
  valueY = 0;

  /** Returns every field to its resting value so a recycled record carries nothing stale. */
  reset(): void {
    this.kind = "control";
    this.type = "keydown";
    this.sequence = 0;
    this.code = "";
    this.key = "";
    this.repeat = false;
    this.x = 0;
    this.y = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.button = 0;
    this.pointerId = 0;
    this.pointerType = "";
    this.device = null;
    this.controlIndex = -1;
    this.valueX = 0;
    this.valueY = 0;
  }
}

/** What the resolver is handed for each queued entry while draining. */
export type QueueVisitor = (entry: QueuedEvent) => void;

/**
 * The pooled event queue.
 *
 * @internal
 */
export class InputEventQueue {
  readonly #pool: QueuedEvent[] = [];

  readonly #queue: QueuedEvent[] = [];

  readonly #published: InputEventRecord[] = [];

  #sequence = 0;

  /**
   * The current frame's published records, in arrival order.
   *
   * @returns The frame's raw event list.
   */
  get events(): readonly InputEventRecord[] {
    return this.#published;
  }

  /**
   * How many records the pool holds. The allocation test watches it stabilise.
   *
   * @returns The free-list length.
   */
  get poolSize(): number {
    return this.#pool.length;
  }

  /**
   * How many entries are waiting to be drained.
   *
   * @returns The queue length.
   */
  get pendingCount(): number {
    return this.#queue.length;
  }

  /**
   * Takes a record from the pool and appends it to the queue.
   *
   * @param kind - The queue kind, which is also the published type for public kinds.
   * @returns The entry to fill in.
   */
  push(kind: QueuedKind): QueuedEvent {
    const entry = this.#pool.pop() ?? new QueuedEvent();
    entry.reset();
    entry.kind = kind;
    if (kind !== "releaseAll" && kind !== "control") {
      entry.type = kind;
    }
    this.#sequence += 1;
    entry.sequence = this.#sequence;
    this.#queue.push(entry);
    return entry;
  }

  /**
   * Applies every queued entry in arrival order, publishing the ones `app.input.events` exposes.
   *
   * @param visit - Called once per entry, before it is published or recycled.
   * @returns How many entries were drained.
   */
  drain(visit: QueueVisitor): number {
    this.#recyclePublished();
    const queue = this.#queue;
    const drained = queue.length;
    for (let index = 0; index < drained; index += 1) {
      const entry = queue[index];
      if (entry === undefined) {
        continue;
      }
      visit(entry);
      if (entry.kind === "releaseAll" || entry.kind === "control") {
        this.#pool.push(entry);
        continue;
      }
      this.#published.push(entry);
    }
    queue.length = 0;
    return drained;
  }

  /** Drops everything, published and pending, back into the pool. */
  clear(): void {
    this.#recyclePublished();
    for (const entry of this.#queue) {
      this.#pool.push(entry);
    }
    this.#queue.length = 0;
  }

  /** Returns the previous frame's published records to the pool. */
  #recyclePublished(): void {
    const published = this.#published;
    for (let index = 0; index < published.length; index += 1) {
      const entry = published[index];
      if (entry instanceof QueuedEvent) {
        this.#pool.push(entry);
      }
    }
    published.length = 0;
  }
}

/**
 * The mutable view of a queue entry, for the adapters that fill one in.
 *
 * @internal
 */
export type MutableInputEvent = QueuedEvent;
