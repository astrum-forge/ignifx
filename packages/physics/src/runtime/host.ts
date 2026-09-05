import type { PhysicsRuntime } from "./runtime.js";

/**
 * The one mutable cell between `register` and `onStart`.
 *
 * `Extension.register` runs **before** `createApp` builds the Lite engine and the world
 * (`packages/core/src/app/app.ts`, `initialize`), and the Havok world needs both. So the extension
 * declares its systems and its service in `register` — which is where `04-extensions.md` §1 says
 * everything is declared — and they all read the runtime through this holder, which `onStart` fills
 * in once Havok has loaded.
 *
 * @internal
 */
export class PhysicsHost {
  /** The runtime, or `null` until `onStart` has built it. */
  runtime: PhysicsRuntime | null = null;
}
