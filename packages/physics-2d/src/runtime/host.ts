import type { Physics2DRuntime } from "./runtime.js";

/**
 * The one mutable cell between `register` and `onStart`.
 *
 * `Extension.register` runs **before** `createApp` builds the world
 * (`packages/core/src/app/app.ts`, `initialize`), and the Rapier world needs the world's layer
 * table and Rapier's WebAssembly module, which is loaded asynchronously. So the extension declares
 * its systems and its service in `register` — which is where `docs/architecture/04-extensions.md`
 * §1 says everything is declared — and they all read the runtime through this holder, which
 * `onStart` fills in.
 *
 * @internal
 */
export class Physics2DHost {
  /** The runtime, or `null` until `onStart` has built it. */
  runtime: Physics2DRuntime | null = null;
}
