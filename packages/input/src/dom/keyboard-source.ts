import { keyCodeControlNames } from "../devices/keyboard.js";
import type { DomSource, DomSourceOptions } from "./dom-target.js";
import type { InputEventQueue } from "./event-queue.js";

/**
 * The keyboard adapter (`docs/architecture/08-input.md` §4). It subscribes on `window`, not on the
 * canvas, because a canvas only receives key events while it is focused and games expect the
 * keyboard to work as soon as the page does.
 *
 * Events are queued, never applied: `keydown`/`keyup` carry the physical `KeyboardEvent.code`, and
 * the resolver turns it into a control name through the table in `src/devices/keyboard.ts`.
 */

/**
 * Translates `keydown`/`keyup` into queue entries.
 *
 * @internal
 */
export class KeyboardSource implements DomSource {
  readonly #target: DomSourceOptions["target"];

  readonly #queue: InputEventQueue;

  readonly #codes: ReadonlyMap<string, string>;

  #attached = false;

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    this.#push("keydown", event);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#push("keyup", event);
  };

  /**
   * Builds the adapter.
   *
   * @param options - The DOM target and the queue to write into.
   */
  constructor(options: DomSourceOptions) {
    this.#target = options.target;
    this.#queue = options.queue;
    this.#codes = keyCodeControlNames();
  }

  /** Subscribes to the DOM. */
  attach(): void {
    if (this.#attached) {
      return;
    }
    this.#attached = true;
    this.#target.window.addEventListener("keydown", this.#onKeyDown);
    this.#target.window.addEventListener("keyup", this.#onKeyUp);
  }

  /** Unsubscribes. Calling it twice is a no-op. */
  detach(): void {
    if (!this.#attached) {
      return;
    }
    this.#attached = false;
    this.#target.window.removeEventListener("keydown", this.#onKeyDown);
    this.#target.window.removeEventListener("keyup", this.#onKeyUp);
  }

  /**
   * Queues one key event.
   *
   * @param type - `keydown` or `keyup`.
   * @param event - The DOM event.
   */
  #push(type: "keydown" | "keyup", event: KeyboardEvent): void {
    // A code this build has no control for is still published on `app.input.events`, so text entry
    // and tools see every key; only the device write is skipped, by the resolver.
    const entry = this.#queue.push(type);
    entry.code = this.#codes.get(event.code) ?? "";
    entry.key = event.key;
    entry.repeat = event.repeat;
  }
}
