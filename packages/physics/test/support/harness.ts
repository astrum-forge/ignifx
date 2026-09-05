import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { physics } from "../../src/extension.js";
import { loadHavokForTests } from "../lite/fixtures/havok.js";
import type { CollisionIdentityMode } from "../../src/runtime/runtime.js";
import type { PhysicsSettings } from "../../src/settings.js";
import type { App, FetchLike, ManualClock, MemorySink, SettingsInput, World } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/physics` node suite runs on: a real `createApp` with the
 * physics extension, on a manual clock, with Havok loaded from the installed package's bytes.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The default fixed step, matching `time.fixedDeltaTime`. */
export const FIXED_STEP = 1 / 60;

/** Options accepted by {@link createPhysicsApp}. */
export interface PhysicsAppOptions {
  /** Project settings; the `physics` section is merged over the defaults. */
  readonly settings?: SettingsInput;
  /** Which collision-identity path to use. */
  readonly collisionIdentities?: CollisionIdentityMode;
  /** The build mode; defaults to `"development"`. */
  readonly mode?: "development" | "production";
  /** A fake `fetch`, for the suites that load an asset. */
  readonly fetch?: FetchLike;
}

/** Everything a physics suite needs. */
export interface PhysicsAppHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /** The resolved `physics` settings section. */
  readonly settings: PhysicsSettings;
  /** Runs one frame at the fixed step and advances the manual clock with it. */
  step(deltaSeconds?: number): void;
  /** Runs `count` frames at the fixed step. */
  stepMany(count: number, deltaSeconds?: number): void;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Builds a started headless app with `@ignifx/physics` registered.
 *
 * @param options - Settings, collision-identity mode, and build mode.
 * @returns The harness.
 */
export async function createPhysicsApp(options?: PhysicsAppOptions): Promise<PhysicsAppHarness> {
  const havok = await loadHavokForTests();
  const clock = createManualClock();
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    extensions: [
      physics({
        havok,
        ...(options?.collisionIdentities === undefined ? {} : { collisionIdentities: options.collisionIdentities }),
      }),
    ],
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
    settings: app.settings.section<PhysicsSettings>("physics"),
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
