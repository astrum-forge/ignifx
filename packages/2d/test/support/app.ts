import { readFileSync } from "node:fs";
import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { twoD } from "../../src/index.js";
import type { TwoDOptions } from "../../src/index.js";
import type { App, AssetHandle, MemorySink, SettingsInput } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/2d` node suite drives
 * (`docs/architecture/07-rendering.md` §6, coding standards §10).
 *
 * A headless app runs on Lite's null engine, so no sprite is ever uploaded — but every component
 * keeps its state, every loader parses, and every clock-driven system steps. That covers the whole
 * of the toolkit except the sprite renderer itself, which the `*.browser.test.ts` suites exercise
 * on real Chromium.
 */

/** How many milliseconds one second is, for the manual clock. */
const MILLISECONDS_PER_SECOND = 1000;

/** Where the checked-in 2D fixtures live, relative to this file. */
const FIXTURE_ROOT = new URL("../../../../tests/fixtures/assets/2d/", import.meta.url);

/**
 * Options accepted by {@link createTwoDApp}.
 *
 * @public
 */
export interface TwoDAppOptions {
  /** Project settings, merged into `createApp`. */
  readonly settings?: SettingsInput;
  /** What to pass `twoD(...)`. */
  readonly options?: TwoDOptions;
  /** Address to body, for the injected `fetch`. Strings are sent as UTF-8. */
  readonly files?: Readonly<Record<string, ArrayBuffer | string>>;
}

/**
 * A headless app with `@ignifx/2d` registered, plus the stepping helpers.
 *
 * @public
 */
export interface TwoDAppHarness {
  /** The app. */
  readonly app: App;
  /** Everything the app logged, for asserting `IGX-1102` warnings. */
  readonly log: MemorySink;
  /** Runs one frame, advancing the manual clock by the same amount. */
  readonly step: (deltaSeconds?: number) => void;
  /** Lets every pending microtask run, runs one frame, and flushes again. */
  readonly settle: (deltaSeconds?: number) => Promise<void>;
  /** Loads an address and waits for it, without needing a running loop. */
  readonly load: <T>(address: string) => Promise<AssetHandle<T>>;
  /** Disposes the app. */
  readonly dispose: () => void;
}

/**
 * Lets every queued microtask and promise continuation run. A zero-delay task hop, not a sleep.
 *
 * @returns A promise that settles on the next macrotask.
 *
 * @public
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Reads one of the checked-in 2D fixtures as text.
 *
 * @param name - The file name, for example `"hero.atlas.json"`.
 * @returns Its contents.
 *
 * @public
 */
export function readFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_ROOT), "utf8");
}

/**
 * Reads one of the checked-in 2D fixtures as bytes.
 *
 * @param name - The file name, for example `"hero.png"`.
 * @returns Its contents.
 *
 * @public
 */
export function readFixtureBytes(name: string): ArrayBuffer {
  const buffer = readFileSync(new URL(name, FIXTURE_ROOT));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Parses one of the checked-in 2D fixtures.
 *
 * @param name - The file name.
 * @returns The parsed document, typed `unknown` because an importer's parameter is too.
 *
 * @public
 */
export function readFixtureJson(name: string): unknown {
  return JSON.parse(readFixture(name));
}

/**
 * The fixture table most suites hand {@link createTwoDApp}, addressed as `2d/<name>`.
 *
 * @returns Address to body.
 *
 * @public
 */
export function fixtureFiles(): Readonly<Record<string, ArrayBuffer | string>> {
  return {
    "2d/hero.atlas.json": readFixture("hero.atlas.json"),
    "2d/hero.spriteanim.json": readFixture("hero.spriteanim.json"),
    "2d/hero.png": readFixtureBytes("hero.png"),
    "2d/checker.png": readFixtureBytes("checker.png"),
  };
}

/**
 * Answers asset reads from a table of addresses.
 *
 * @param files - Address to body.
 * @returns A `fetch` the asset service can read through.
 */
function tableFetch(files: Readonly<Record<string, ArrayBuffer | string>>): typeof globalThis.fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const address = url.replace(/^assets\//u, "");
    const body = files[url] ?? files[address] ?? null;
    if (body === null) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

/**
 * Builds a headless app with the 2D extension registered.
 *
 * @remarks
 * `load` awaits the handle **without** stepping, which is what the asset delivery rule wants
 * before `app.start()`: a completed load settles as soon as it finishes until the loop is running
 * (commit `7be9401`). Once a suite calls `app.start()` it must pump frames instead.
 *
 * @param options - Settings, extension options, and the fixture table.
 * @returns The harness.
 *
 * @example
 * ```ts
 * const h = await createTwoDApp({ files: fixtureFiles() });
 * const atlas = await h.load<SpriteAtlasAsset>("2d/hero.atlas.json");
 * ```
 *
 * @public
 */
export async function createTwoDApp(options?: TwoDAppOptions): Promise<TwoDAppHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: log,
    logLevel: "debug",
    fetch: tableFetch(options?.files ?? {}),
    extensions: [twoD(options?.options)],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
  });
  const step = (deltaSeconds = 1 / 60): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  return {
    app,
    log,
    step,
    settle: async (deltaSeconds = 1 / 60): Promise<void> => {
      await flushMicrotasks();
      step(deltaSeconds);
      await flushMicrotasks();
    },
    load: async <T>(address: string): Promise<AssetHandle<T>> => {
      const handle = app.assets.load<T>(address);
      await handle.promise;
      return handle;
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}
