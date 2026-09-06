import { readFileSync } from "node:fs";
import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { ui } from "../../src/index.js";
import type { UiOptions } from "../../src/index.js";
import type { App, AssetHandle, MemorySink, SettingsInput } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/ui` node suite drives
 * (`docs/architecture/07-rendering.md` §6, coding standards §10).
 *
 * A headless app has no DOM canvas, so `app.ui.root` is `null` and every overlay member is a
 * documented no-op — but the components keep their state, the `.i18n.json` loader parses, the
 * `PreRender` system runs, and Babylon Lite's text shaper works, because `createFontFromBuffer`
 * and `createDefaultTextData` touch no device. That covers the whole package except the text
 * renderer and the real DOM, which the `*.browser.test.ts` suites exercise on Chromium.
 */

/** How many milliseconds one second is, for the manual clock. */
const MILLISECONDS_PER_SECOND = 1000;

/** Where the checked-in UI fixtures live, relative to this file. */
const FIXTURE_ROOT = new URL("../../../../tests/fixtures/assets/ui/", import.meta.url);

/**
 * Options accepted by {@link createUiApp}.
 *
 * @public
 */
export interface UiAppOptions {
  /** Project settings, merged into `createApp`. */
  readonly settings?: SettingsInput;
  /** What to pass `ui(...)`. */
  readonly options?: UiOptions;
  /** Address to body, for the injected `fetch`. Strings are sent as UTF-8. */
  readonly files?: Readonly<Record<string, ArrayBuffer | string>>;
}

/**
 * A headless app with `@ignifx/ui` registered, plus the stepping helpers.
 *
 * @public
 */
export interface UiAppHarness {
  /** The app. */
  readonly app: App;
  /** Everything the app logged. */
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
 * Reads one of the checked-in UI fixtures as text.
 *
 * @param name - The file name, for example `"strings.i18n.json"`.
 * @returns Its contents.
 *
 * @public
 */
export function readFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_ROOT), "utf8");
}

/**
 * Reads one of the checked-in UI fixtures as bytes.
 *
 * @param name - The file name, for example `"ShareTechMono-Regular.ttf"`.
 * @returns Its contents.
 *
 * @public
 */
export function readFixtureBytes(name: string): ArrayBuffer {
  const buffer = readFileSync(new URL(name, FIXTURE_ROOT));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * The fixture table most suites hand {@link createUiApp}, addressed as `ui/<name>`.
 *
 * @returns Address to body.
 *
 * @public
 */
export function fixtureFiles(): Readonly<Record<string, ArrayBuffer | string>> {
  return {
    "ui/strings.i18n.json": readFixture("strings.i18n.json"),
    "ui/ShareTechMono-Regular.ttf": readFixtureBytes("ShareTechMono-Regular.ttf"),
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
 * Builds a headless app with the UI extension registered.
 *
 * @remarks
 * `load` awaits the handle **without** stepping, which is what the asset delivery rule wants before
 * `app.start()`: a completed load settles as soon as it finishes until the loop is running. Once a
 * suite calls `app.start()` it must pump frames instead.
 *
 * @param options - Settings, extension options, and the fixture table.
 * @returns The harness.
 *
 * @example
 * ```ts
 * const h = await createUiApp({ files: fixtureFiles() });
 * const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
 * ```
 *
 * @public
 */
export async function createUiApp(options?: UiAppOptions): Promise<UiAppHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: log,
    logLevel: "debug",
    fetch: tableFetch(options?.files ?? {}),
    extensions: [ui(options?.options)],
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
