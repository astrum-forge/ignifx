import type { InputService } from "./input-service.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The one system this package registers (`docs/architecture/01-lifecycle-and-time.md` §3 step 2:
 * "input polls devices and resolves action states for this frame", before asset delivery).
 */

/**
 * Where the input system sits in `PreUpdate`. Core delivers assets at `-900`, so `-950` puts input
 * first: a script woken by an asset delivered this frame already sees this frame's input.
 *
 * @public
 */
export const INPUT_RESOLVE_ORDER = -950;

/**
 * Drains the input queue and resolves every action, once per frame.
 *
 * @internal
 */
export class InputSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "input-resolve";

  readonly #service: InputService;

  /**
   * Binds the system to its service.
   *
   * @param service - The app's input service.
   */
  constructor(service: InputService) {
    this.#service = service;
  }

  /**
   * Resolves this frame's input.
   *
   * @param ctx - The world, clock, phase, and delta for this invocation.
   */
  update(ctx: SystemContext): void {
    this.#service.resolveFrame(ctx.time.unscaledDeltaTime);
  }
}
