import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { threeD } from "../../src/extension.js";
import { loadHavokForTests } from "../lite/fixtures/havok.js";
import type { ThreeDOptions } from "../../src/extension.js";
import type { App, FetchLike, ManualClock, MemorySink, SettingsInput, World } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/3d` node suite runs on: a real `createApp` with physics,
 * input, and the 3D toolkit registered, on a manual clock, with Havok loaded from the installed
 * package's bytes (mirroring `packages/physics/test/support/harness.ts`).
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The default fixed step, matching `time.fixedDeltaTime`. */
export const FIXED_STEP = 1 / 60;

/** Options accepted by {@link createThreeDApp}. */
export interface ThreeDAppOptions {
  /** Project settings. */
  readonly settings?: SettingsInput;
  /** Overrides for the `threeD` settings section. */
  readonly threeD?: ThreeDOptions;
  /** A fake `fetch`, for the suites that load an asset. */
  readonly fetch?: FetchLike;
  /** Whether to register `@ignifx/physics`; defaults to `true`. */
  readonly withPhysics?: boolean;
}

/** Everything a 3D suite needs. */
export interface ThreeDAppHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /** Runs one frame at the fixed step and advances the manual clock with it. */
  step(deltaSeconds?: number): void;
  /** Runs `count` frames at the fixed step. */
  stepMany(count: number, deltaSeconds?: number): void;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Builds a started headless app with the 3D toolkit registered.
 *
 * @param options - Settings and extension options.
 * @returns The harness.
 */
export async function createThreeDApp(options?: ThreeDAppOptions): Promise<ThreeDAppHarness> {
  const clock = createManualClock();
  const sink = createMemorySink();
  const withPhysics = options?.withPhysics ?? true;
  const havok = withPhysics ? await loadHavokForTests() : null;
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    extensions: [...(havok === null ? [] : [physics({ havok })]), input(), threeD(options?.threeD)],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
    mode: "development",
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
