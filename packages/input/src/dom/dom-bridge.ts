import { FocusSource } from "./focus-source.js";
import { KeyboardSource } from "./keyboard-source.js";
import { PointerSource } from "./pointer-source.js";
import type { Cursor } from "./cursor.js";
import type { DomSource, DomTarget } from "./dom-target.js";
import type { InputEventQueue } from "./event-queue.js";
import type { PointerLock } from "./pointer-lock.js";

/**
 * The DOM wiring as a whole (`docs/architecture/08-input.md` §4): one adapter per input family,
 * attached when the app has a canvas and detached when it is disposed. A headless app never
 * constructs one, which is what lets the same service run under Node with `simulate`.
 */

/** What {@link DomBridge} is constructed with. */
export interface DomBridgeOptions {
  /** The DOM objects to subscribe to. */
  readonly target: DomTarget;
  /** Where translated events are queued. */
  readonly queue: InputEventQueue;
  /** The pointer-lock controller to bind to the document. */
  readonly pointerLock: PointerLock;
  /** The cursor controller to bind to the canvas. */
  readonly cursor: Cursor;
}

/**
 * Every DOM subscription one app's input service owns.
 *
 * @internal
 */
export class DomBridge {
  readonly #sources: readonly DomSource[];

  readonly #pointerLock: PointerLock;

  readonly #cursor: Cursor;

  readonly #target: DomTarget;

  #attached = false;

  /**
   * Builds the adapters.
   *
   * @param options - The DOM target, the queue, and the two controllers.
   */
  constructor(options: DomBridgeOptions) {
    this.#target = options.target;
    this.#pointerLock = options.pointerLock;
    this.#cursor = options.cursor;
    this.#sources = [
      new KeyboardSource({ target: options.target, queue: options.queue }),
      new PointerSource({
        target: options.target,
        queue: options.queue,
        isLocked: (): boolean => options.pointerLock.locked,
      }),
      new FocusSource({ target: options.target, queue: options.queue }),
    ];
  }

  /** Subscribes every adapter and binds the pointer-lock and cursor controllers. */
  attach(): void {
    if (this.#attached) {
      return;
    }
    this.#attached = true;
    for (const source of this.#sources) {
      source.attach();
    }
    this.#pointerLock.attach(this.#target);
    this.#cursor.attach(this.#target);
  }

  /** Unsubscribes everything and restores the canvas's cursor. */
  detach(): void {
    if (!this.#attached) {
      return;
    }
    this.#attached = false;
    for (const source of this.#sources) {
      source.detach();
    }
    this.#pointerLock.detach();
    this.#cursor.detach();
  }
}
