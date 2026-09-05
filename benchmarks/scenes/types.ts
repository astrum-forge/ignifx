import type { App } from "@ignifx/core";

/** A headless benchmark scene, built and running, ready to be stepped. */
export interface BenchScene {
  /** The name the baselines file records it under. */
  readonly name: string;
  /** The running app. `app.step(dt)` advances one frame. */
  readonly app: App;
  /** Stops and releases everything the scene built. */
  dispose(): void;
}
