import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Tween } from "./tween.js";
import type { TweenableValue } from "./channel.js";
import type { TweenOptions } from "./tween.js";
import type { QuatLike, Vec2Like, Vec3Like } from "../math/types.js";

/**
 * `app.tweens` (`docs/architecture/12-3d-toolkit.md` §4): the app-wide tween list, advanced once
 * per frame in `PostUpdate` on ignifx's own clock.
 *
 * Tweens live in core rather than in a toolkit because both toolkits use them, and because a tween
 * is a clock consumer like any other: it obeys `time.timeScale`, it is frozen by `app.pause()`
 * unless it opted out, and it dies when the app is disposed (ADR-0003).
 */

/**
 * The destination value the tween should reach for one field, narrowed to the field's own shape.
 *
 * @remarks
 * `QuatLike` is tested before `Vec3Like` because a quaternion satisfies both: `{ x, y, z, w }` is
 * assignable to `{ x, y, z }`.
 *
 * @typeParam V - The field's declared type.
 *
 * @public
 */
export type TweenTargetValue<V> = V extends number
  ? number
  : V extends QuatLike
    ? QuatLike
    : V extends Vec3Like
      ? Vec3Like
      : V extends Vec2Like
        ? Vec2Like
        : never;

/**
 * The destinations `app.tweens.to` accepts for a target: every numeric, `Vec2`, `Vec3`, or `Quat`
 * field of `T`, each one optional.
 *
 * @typeParam T - The target object's type.
 *
 * @example
 * ```ts
 * const props: TweenProps<Transform> = { position: { x: 1, y: 2, z: 3 } };
 * ```
 *
 * @public
 */
export type TweenProps<T> = {
  readonly [K in keyof T as T[K] extends TweenableValue ? K : never]?: TweenTargetValue<T[K]>;
};

/**
 * The app-wide tween list.
 *
 * @example
 * ```ts
 * app.tweens.to(entity.transform, { position: { x: 0, y: 3, z: 0 } }, {
 *   duration: 0.6,
 *   ease: "backOut",
 *   yoyo: true,
 *   loop: 1,
 * });
 * ```
 *
 * @public
 */
export interface Tweens {
  /** How many tweens are alive. */
  readonly count: number;
  /**
   * Starts a tween towards `props` and returns the handle.
   *
   * @typeParam T - The target object's type.
   * @param target - The object whose fields move. Any object with numeric or vector fields works.
   * @param props - The destination value of each field to move.
   * @param options - Duration, curve, delay, looping, and the completion callback.
   * @returns The running tween.
   * @throws IgnifxError with code `IGX-0109` when an option is outside its domain.
   * @throws IgnifxError with code `IGX-0110` when a named field is not tweenable.
   */
  to<T extends object>(target: T, props: TweenProps<T>, options: TweenOptions): Tween;
  /** Stops every tween, without firing any `onComplete`. */
  stopAll(): void;
  /**
   * Stops every tween that moves one object.
   *
   * @param target - The object.
   * @returns How many tweens were stopped.
   */
  stopAllOf(target: object): number;
}

/**
 * The implementation behind `app.tweens`.
 *
 * @internal
 */
export class TweensImpl implements Tweens {
  readonly #tweens: Tween[] = [];

  /**
   * How many tweens are alive.
   *
   * @returns How many tweens are alive.
   */
  get count(): number {
    return this.#tweens.length;
  }

  /**
   * Starts a tween.
   *
   * @typeParam T - The target object's type.
   * @param target - The object whose fields move.
   * @param props - The destination value of each field.
   * @param options - Duration, curve, delay, looping, and the completion callback.
   * @returns The running tween.
   */
  to<T extends object>(target: T, props: TweenProps<T>, options: TweenOptions): Tween {
    // The mapped type is the caller-facing contract; the constructor works on the erased record,
    // which is the same object seen without the per-field narrowing, and re-checks every field's
    // shape at runtime.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- re-checked at runtime.
    const erased = props as Readonly<Record<string, TweenableValue>>;
    const tween = new Tween(target, erased, options);
    this.#tweens.push(tween);
    return tween;
  }

  /** Stops every tween, without firing any `onComplete`. */
  stopAll(): void {
    for (let index = 0; index < this.#tweens.length; index += 1) {
      this.#tweens[index]?.stop();
    }
    this.#tweens.length = 0;
  }

  /**
   * Stops every tween that moves one object.
   *
   * @param target - The object.
   * @returns How many tweens were stopped.
   */
  stopAllOf(target: object): number {
    let stopped = 0;
    for (let index = this.#tweens.length - 1; index >= 0; index -= 1) {
      const tween = this.#tweens[index];
      if (tween !== undefined && tween.target === target) {
        tween.stop();
        this.#swapRemove(index);
        stopped += 1;
      }
    }
    return stopped;
  }

  /**
   * Advances every tween and drops the ones that finished.
   *
   * @remarks
   * The list is walked backwards so that a tween removed in place never shifts the ones still to
   * be visited, and so that an `onComplete` handler starting a new tween appends behind the cursor
   * and waits for the next frame rather than being advanced twice.
   *
   * @param deltaTime - `time.deltaTime`, for ordinary tweens.
   * @param unscaledDeltaTime - `time.unscaledDeltaTime`, for `updateWhenPaused` tweens.
   * @param paused - `time.paused`.
   *
   * @internal
   */
  advance(deltaTime: number, unscaledDeltaTime: number, paused: boolean): void {
    for (let index = this.#tweens.length - 1; index >= 0; index -= 1) {
      const tween = this.#tweens[index];
      if (tween === undefined) {
        continue;
      }
      if (paused && !tween.updateWhenPaused) {
        continue;
      }
      const done = tween.advance(tween.updateWhenPaused ? unscaledDeltaTime : deltaTime);
      if (done) {
        this.#swapRemove(index);
      }
    }
  }

  /** Drops every tween without stopping them, for app disposal. */
  clear(): void {
    this.#tweens.length = 0;
  }

  /**
   * Removes the entry at `index` by moving the last one into its place.
   *
   * @param index - Where to remove.
   */
  #swapRemove(index: number): void {
    const last = this.#tweens.length - 1;
    const moved = this.#tweens[last];
    if (index !== last && moved !== undefined) {
      this.#tweens[index] = moved;
    }
    this.#tweens.length = last;
  }
}

/**
 * Narrows `app.tweens` to the implementation the kernel drives, the way `rendererInternals` does
 * for `app.renderer`.
 *
 * @param tweens - The service read off an app.
 * @returns The implementation.
 * @throws IgnifxError with code `IGX-0702` when the service came from a different copy of the
 * package.
 *
 * @internal
 */
export function tweensInternals(tweens: Tweens): TweensImpl {
  if (tweens instanceof TweensImpl) {
    return tweens;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.tweens was not created by this copy of @ignifx/core.", {
    context: { member: "app.tweens" },
    hint: "Reach the service through the app that created it.",
  });
}
