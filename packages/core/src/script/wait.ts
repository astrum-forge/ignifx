import type { WaitInstruction } from "../app/types.js";

/**
 * The wait instructions a coroutine yields
 * (`docs/architecture/01-lifecycle-and-time.md` §5, ADR-0010). Each factory allocates one small,
 * frozen object; a coroutine that waits every frame therefore allocates one object per wait, which
 * is why long-running loops hoist a wait into a field and yield it repeatedly where the wait is
 * stateless (`waitFixedUpdate`, a fixed `waitSeconds`).
 */

/**
 * Waits for a number of **scaled** seconds — `time.timeScale` applies, so a slow-motion effect
 * slows the wait too.
 *
 * @param seconds - How long to wait, in seconds.
 * @returns The instruction to `yield`. Allocates one small object.
 *
 * @example
 * ```ts
 * reload() {
 *   this.isReloading = true;
 *   yield waitSeconds(1.5);
 *   this.isReloading = false;
 * }
 * ```
 *
 * @public
 */
export function waitSeconds(seconds: number): WaitInstruction {
  return Object.freeze({ kind: "seconds", seconds });
}

/**
 * Waits for a number of **unscaled** seconds — unaffected by `time.timeScale`, so a pause menu's
 * animations keep running while the game is frozen.
 *
 * @param seconds - How long to wait, in seconds of wall-clock time.
 * @returns The instruction to `yield`. Allocates one small object.
 *
 * @public
 */
export function waitSecondsRealtime(seconds: number): WaitInstruction {
  return Object.freeze({ kind: "secondsRealtime", seconds });
}

/**
 * Waits until just after the next fixed step, so the coroutine sees the same world state a
 * `fixedUpdate` would.
 *
 * @returns The instruction to `yield`. Allocates one small object; hoist it into a field when a
 * loop yields it every iteration.
 *
 * @example
 * ```ts
 * push() {
 *   const step = waitFixedUpdate();
 *   for (let index = 0; index < 30; index += 1) {
 *     this.body.addForce(this.direction);
 *     yield step;
 *   }
 * }
 * ```
 *
 * @public
 */
export function waitFixedUpdate(): WaitInstruction {
  return Object.freeze({ kind: "fixedUpdate" });
}

/**
 * Waits until a predicate becomes `true`. The predicate is evaluated once per frame in the
 * `Update` phase, so it must be cheap and free of side effects.
 *
 * @param predicate - Evaluated each frame; the coroutine resumes on the first `true`.
 * @returns The instruction to `yield`. Allocates one small object.
 *
 * @example
 * ```ts
 * yield waitUntil(() => this.door.isOpen);
 * ```
 *
 * @public
 */
export function waitUntil(predicate: () => boolean): WaitInstruction {
  return Object.freeze({ kind: "until", predicate });
}

/**
 * Waits while a predicate stays `true` — the complement of {@link waitUntil}.
 *
 * @param predicate - Evaluated each frame; the coroutine resumes on the first `false`.
 * @returns The instruction to `yield`. Allocates one small object.
 *
 * @public
 */
export function waitWhile(predicate: () => boolean): WaitInstruction {
  return Object.freeze({ kind: "while", predicate });
}
