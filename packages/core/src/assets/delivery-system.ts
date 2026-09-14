import type { AssetsImpl } from "./assets-service.js";
import type { System, SystemContext } from "../app/types.js";

/**
 * Deliver completed loads at `PreUpdate` while the loop runs so scripts agree on readiness.
 * Retries and collection use engine time, allowing headless tests to advance them with `app.step`.
 */

/**
 * Where asset delivery sits inside `PreUpdate`.
 *
 * @remarks
 * §3 step 2 lists input polling first and asset delivery second, so the order leaves the band below
 * it free for `@ignifx/input`'s own system while staying inside the `[-1000, 1000]` range core
 * systems are allotted (`docs/architecture/03-scripting-and-components.md` §6).
 *
 * @internal
 */
export const ASSET_DELIVERY_ORDER = -900;

/**
 * Drains the asset service's delivery queue once per frame.
 *
 * @internal
 */
export class AssetDeliverySystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/asset-delivery";

  readonly #assets: AssetsImpl;

  /**
   * Creates the system.
   *
   * @param assets - The service to drain.
   */
  constructor(assets: AssetsImpl) {
    this.#assets = assets;
  }

  /**
   * Delivers everything that settled since the previous frame.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    this.#assets.deliver(ctx.dt, ctx.time.unscaledDeltaTime);
  }
}
