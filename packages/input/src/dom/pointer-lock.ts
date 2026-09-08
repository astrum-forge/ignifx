import { Signal } from "@ignifx/core";
import { inputError, InputErrorCode } from "../errors.js";
import type { DomTarget } from "./dom-target.js";
import type { SignalLike } from "@ignifx/core";

/**
 * Pointer lock (`docs/architecture/08-input.md` §4). While the canvas holds the pointer,
 * `<Mouse>/delta` and `<Pointer>/delta` keep reporting from `movementX`/`movementY` and
 * `<Mouse>/position` stops moving — which is exactly what a first-person camera wants.
 *
 * The browser only grants a lock inside a user gesture, so `request()` is called from a click
 * handler, not from `start()`. The returned promise settles either way: it resolves `true` on
 * `pointerlockchange` and `false` on `pointerlockerror`.
 *
 * A lock is asked for with `unadjustedMovement: true` before it is asked for plainly, so that the
 * deltas a locked look reads are the mouse's own counts rather than the pointer-acceleration curve
 * the desktop applies to a cursor.
 */

/**
 * The pointer-lock controller, reached as `app.input.pointerLock`.
 *
 * @example
 * ```ts
 * canvas.addEventListener("click", () => {
 *   void app.input.pointerLock.request();
 * });
 * app.input.pointerLock.onChange.connect((locked) => hud.setCrosshair(locked));
 * ```
 *
 * @public
 */
export class PointerLock {
  readonly #changed = new Signal<boolean>();

  #target: DomTarget | null = null;

  #pending: ((locked: boolean) => void)[] = [];

  #attached = false;

  readonly #onChange = (): void => {
    this.#settle(this.locked);
  };

  readonly #onError = (): void => {
    this.#settle(false);
  };

  /**
   * Whether the canvas currently holds the pointer.
   *
   * @returns `true` while `document.pointerLockElement` is this app's canvas.
   */
  get locked(): boolean {
    const target = this.#target;
    if (target === null) {
      return false;
    }
    return target.document.pointerLockElement === target.canvas;
  }

  /**
   * Emitted whenever the lock is taken or released, with the new state.
   *
   * @returns The signal.
   */
  get onChange(): SignalLike<boolean> {
    return this.#changed;
  }

  /**
   * Requests the lock. Must be called from inside a user gesture.
   *
   * @remarks
   * The lock is asked for with `unadjustedMovement: true` first — raw, un-accelerated mouse motion,
   * which is what a first-person look wants — and plainly when the browser rejects the option.
   * Either way the promise settles once, on the outcome of whichever request the browser accepted.
   *
   * @returns `true` once the lock is held, `false` when the browser refused it.
   * @throws IgnifxError with code `IGX-0809` when the app has no DOM canvas to lock.
   */
  request(): Promise<boolean> {
    const target = this.#target;
    if (target === null) {
      return Promise.reject(
        inputError(InputErrorCode.pointerLockUnavailable, "Pointer lock needs a DOM canvas; this app has none.", {
          hint: "Pointer lock is a browser feature; a headless app has nothing to lock.",
        }),
      );
    }
    if (this.locked) {
      return Promise.resolve(true);
    }
    const settled = new Promise<boolean>((resolve) => {
      this.#pending.push(resolve);
    });
    const result = this.#lock(target.canvas);
    if (result instanceof Promise) {
      // Newer Chromium returns a promise that rejects with the same reason `pointerlockerror`
      // reports; whichever arrives first settles the request.
      void result.catch((): void => {
        this.#settle(false);
      });
    }
    return settled;
  }

  /** Releases the lock, if this app holds it. */
  exit(): void {
    const target = this.#target;
    if (target !== null && this.locked) {
      target.document.exitPointerLock();
    }
  }

  /**
   * Subscribes to the document's pointer-lock events.
   *
   * @param target - The DOM objects to subscribe to.
   *
   * @internal
   */
  attach(target: DomTarget): void {
    if (this.#attached) {
      return;
    }
    this.#target = target;
    this.#attached = true;
    target.document.addEventListener("pointerlockchange", this.#onChange);
    target.document.addEventListener("pointerlockerror", this.#onError);
  }

  /**
   * Unsubscribes and settles anything still waiting.
   *
   * @internal
   */
  detach(): void {
    const target = this.#target;
    if (target !== null && this.#attached) {
      target.document.removeEventListener("pointerlockchange", this.#onChange);
      target.document.removeEventListener("pointerlockerror", this.#onError);
    }
    this.#attached = false;
    this.#settle(false);
    this.#target = null;
    this.#changed.clear();
  }

  /**
   * Takes the lock, asking for raw mouse motion first.
   *
   * @remarks
   * `unadjustedMovement` turns off the operating system's pointer acceleration for the duration of
   * the lock, which is what a first-person look wants: acceleration makes a fast flick travel
   * further than a slow one over the same distance, and that is the "jumpy" feel players report.
   * The option is Chromium-only and is rejected — synchronously in older builds, through the
   * returned promise in newer ones — where it is unsupported, so a refusal falls back to the plain
   * request rather than leaving the game with no lock at all.
   *
   * @param canvas - The element to lock.
   * @returns Whatever the browser returned: a promise, or `undefined` in the older shape.
   */
  #lock(canvas: DomTarget["canvas"]): unknown {
    const plain = (): unknown => canvas.requestPointerLock();
    let result: unknown;
    try {
      result = canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      // Older engines throw on the unrecognised argument instead of rejecting.
      return plain();
    }
    if (result instanceof Promise) {
      const pending: Promise<unknown> = result;
      // A browser that knows the promise shape but not the option rejects it. Swallow that one
      // rejection here and retry plainly; whatever the retry does settles the caller's promise.
      return pending.catch(plain);
    }
    return result;
  }

  /**
   * Resolves every pending request and announces the new state.
   *
   * @param locked - Whether the lock is held.
   */
  #settle(locked: boolean): void {
    const pending = this.#pending;
    if (pending.length > 0) {
      this.#pending = [];
      for (const resolve of pending) {
        resolve(locked);
      }
    }
    this.#changed.emit(locked);
  }
}
