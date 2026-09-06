import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { physics2d } from "../../src/extension.js";
import type { Physics2DSettings } from "../../src/settings.js";
import type { App, Extension, FetchLike, ManualClock, MemorySink, SettingsInput, World } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/physics-2d` node suite runs on: a real `createApp` with the
 * 2D physics extension, on a manual clock. Rapier is pure WebAssembly with its binary inlined, so a
 * headless app needs no configuration at all — the same code runs in Node and in Chromium.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The default fixed step, matching `time.fixedDeltaTime`. */
export const FIXED_STEP = 1 / 60;

/** Options accepted by {@link createPhysics2DApp}. */
export interface Physics2DAppOptions {
  /** Project settings; the `physics2d` section is merged over the defaults. */
  readonly settings?: SettingsInput;
  /** The build mode; defaults to `"development"`. */
  readonly mode?: "development" | "production";
  /** A fake `fetch`, for the suites that load an asset. */
  readonly fetch?: FetchLike;
  /** Extra extensions registered before `physics2d()`. */
  readonly extensions?: readonly Extension[];
}

/** Everything a 2D physics suite needs. */
export interface Physics2DAppHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /** The resolved `physics2d` settings section. */
  readonly settings: Physics2DSettings;
  /** Runs one frame at the fixed step and advances the manual clock with it. */
  step(deltaSeconds?: number): void;
  /** Runs `count` frames at the fixed step. */
  stepMany(count: number, deltaSeconds?: number): void;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Builds a started headless app with `@ignifx/physics-2d` registered.
 *
 * @param options - Settings, build mode, and any extra extensions.
 * @returns The harness.
 */
export async function createPhysics2DApp(options?: Physics2DAppOptions): Promise<Physics2DAppHarness> {
  const clock = createManualClock();
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    extensions: [...(options?.extensions ?? []), physics2d()],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
    mode: options?.mode ?? "development",
  });
  await app.start();
  const step = (deltaSeconds: number = FIXED_STEP): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  return {
    app,
    world: app.world,
    clock,
    sink,
    settings: app.settings.section<Physics2DSettings>("physics2d"),
    step,
    stepMany: (count: number, deltaSeconds: number = FIXED_STEP): void => {
      for (let index = 0; index < count; index += 1) {
        step(deltaSeconds);
      }
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}
