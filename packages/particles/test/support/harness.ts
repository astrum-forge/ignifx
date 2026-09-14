import { createApp, createManualClock, createMemorySink, defineSchema, vec3 } from "@ignifx/core";
import { particles } from "../../src/extension.js";
import type { ParticlesOptions } from "../../src/extension.js";
import type {
  App,
  ErrorReport,
  Extension,
  ExtensionContext,
  FetchLike,
  ManualClock,
  MemorySink,
  SettingsInput,
  Vec3Like,
  World,
} from "@ignifx/core";

/**
 * The headless harness every `@ignifx/particles` node suite runs on: a real `createApp` with the
 * extension registered, on a manual clock, so `step()` advances exactly one frame.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The default frame length, matching `time.fixedDeltaTime`. */
export const FRAME = 1 / 60;

/** How many zero-length frames {@link ParticlesAppHarness.settle} runs before it gives up. */
const DEFAULT_SETTLE_TURNS = 64;

/**
 * Yields to the macrotask queue, which is where an asset fetch settles.
 *
 * @returns A promise that resolves on the next turn.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Options accepted by {@link createParticlesApp}. */
export interface ParticlesAppOptions {
  /** Project settings. */
  readonly settings?: SettingsInput;
  /** Overrides for the `particles` settings section. */
  readonly particles?: ParticlesOptions;
  /** A fake `fetch`, for the suites that load a `.particles.json`. */
  readonly fetch?: FetchLike;
  /** Whether to register `particles()`; defaults to `true`. */
  readonly withExtension?: boolean;
  /** Extra extensions to register before `particles()`. */
  readonly extensions?: readonly Extension[];
  /**
   * Whether to start the app; defaults to `true`. An unstarted app settles an asset load as soon as
   * it finishes, which is what lets a suite `await handle.promise` without stepping a frame.
   */
  readonly start?: boolean;
}

/** Everything a particles suite needs. */
export interface ParticlesAppHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** Every message the sink recorded, newest last. */
  messages(): readonly string[];
  /** Runs one frame and advances the manual clock with it. */
  step(deltaSeconds?: number): void;
  /** Runs `count` frames. */
  stepMany(count: number, deltaSeconds?: number): void;
  /**
   * Runs `count` frames, letting pending asset loads settle between them. Asset promises resolve on
   * the macrotask queue, so a synchronous loop of `step()` never sees them arrive.
   */
  stepAsync(count: number, deltaSeconds?: number): Promise<void>;
  /**
   * Steps zero-length frames until `isReady` holds, so an asset can arrive without the system clock
   * moving. Gives up after `maxTurns`, leaving the caller's own assertion to report the failure.
   */
  settle(isReady?: () => boolean, maxTurns?: number): Promise<void>;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Builds a started headless app with `@ignifx/particles` registered.
 *
 * @param options - Settings, extension options, and a fake `fetch`.
 * @returns The harness.
 */
export async function createParticlesApp(options?: ParticlesAppOptions): Promise<ParticlesAppHarness> {
  const clock = createManualClock();
  const sink = createMemorySink();
  const errors: ErrorReport[] = [];
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    logLevel: "debug",
    extensions: [
      ...(options?.extensions ?? []),
      ...(options?.withExtension === false ? [] : [particles(options?.particles)]),
    ],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
    mode: "development",
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  if (options?.start !== false) {
    await app.start();
  }
  const step = (deltaSeconds: number = FRAME): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  return {
    app,
    world: app.world,
    clock,
    sink,
    errors,
    messages: (): readonly string[] => sink.toArray().map((record) => record.message),
    step,
    stepMany: (count: number, deltaSeconds: number = FRAME): void => {
      for (let index = 0; index < count; index += 1) {
        step(deltaSeconds);
      }
    },
    stepAsync: async (count: number, deltaSeconds: number = FRAME): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        step(deltaSeconds);
        // oxlint-disable-next-line eslint/no-await-in-loop -- frame n + 1 depends on frame n.
        await nextTurn();
      }
    },
    settle: async (isReady?: () => boolean, maxTurns: number = DEFAULT_SETTLE_TURNS): Promise<void> => {
      for (let turn = 0; turn < maxTurns; turn += 1) {
        step(0);
        // oxlint-disable-next-line eslint/no-await-in-loop -- the next turn depends on this one.
        await nextTurn();
        if (isReady?.() === true) {
          return;
        }
      }
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/**
 * A `fetch` that serves one JSON document per address suffix and 404s everything else. `data:` URLs
 * go to the real `fetch`, because that is how the generated particle shader reaches the loader.
 *
 * @param files - The documents, keyed by the suffix of the URL the asset service resolves to.
 * @returns The fake.
 */
export function jsonFetch(files: Readonly<Record<string, unknown>>): FetchLike {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.startsWith("data:")) {
      return globalThis.fetch(input, init);
    }
    for (const [suffix, body] of Object.entries(files)) {
      if (url.endsWith(suffix)) {
        return Promise.resolve(
          new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
        );
      }
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
}

/**
 * An extension that registers nothing but a `physics` settings section, so the gravity-by-data path
 * can be exercised without depending on `@ignifx/physics`.
 *
 * @param gravity - What the section declares as its default gravity.
 * @returns The extension.
 */
export function physicsSettingsStub(gravity: Vec3Like): Extension {
  return {
    name: "test/physics-settings",
    version: "0.0.0",
    engine: ">=0.0.0 <1.0.0",
    requires: [],
    register(ctx: ExtensionContext): void {
      ctx.registerSettings("physics", defineSchema({ gravity: vec3(gravity) }), { gravity });
    },
  };
}

/**
 * The URL a `fetch` argument names, whatever shape it arrives in.
 *
 * @param input - What the asset service passed.
 * @returns The URL as a string.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}
