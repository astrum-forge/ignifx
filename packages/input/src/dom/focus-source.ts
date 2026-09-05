import type { DomSource, DomSourceOptions } from "./dom-target.js";
import type { InputEventQueue } from "./event-queue.js";

/**
 * The focus adapter (`docs/architecture/08-input.md` §4: "`blur`/`visibilitychange` release all
 * controls to avoid stuck keys"). Both are translated into one queued `releaseAll` entry, so the
 * release lands in arrival order with everything else rather than mutating device state from a DOM
 * callback.
 */

/**
 * Queues a release-everything entry when the page loses focus or is hidden.
 *
 * @internal
 */
export class FocusSource implements DomSource {
  readonly #target: DomSourceOptions["target"];

  readonly #queue: InputEventQueue;

  #attached = false;

  readonly #onBlur = (): void => {
    this.#queue.push("releaseAll");
  };

  readonly #onVisibilityChange = (): void => {
    if (this.#target.document.visibilityState === "hidden") {
      this.#queue.push("releaseAll");
    }
  };

  /**
   * Builds the adapter.
   *
   * @param options - The DOM target and the queue to write into.
   */
  constructor(options: DomSourceOptions) {
    this.#target = options.target;
    this.#queue = options.queue;
  }

  /** Subscribes to the DOM. */
  attach(): void {
    if (this.#attached) {
      return;
    }
    this.#attached = true;
    this.#target.window.addEventListener("blur", this.#onBlur);
    this.#target.document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  /** Unsubscribes. Calling it twice is a no-op. */
  detach(): void {
    if (!this.#attached) {
      return;
    }
    this.#attached = false;
    this.#target.window.removeEventListener("blur", this.#onBlur);
    this.#target.document.removeEventListener("visibilitychange", this.#onVisibilityChange);
  }
}
