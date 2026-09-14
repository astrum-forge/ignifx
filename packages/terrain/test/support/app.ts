import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { terrain } from "../../src/extension.js";
import type { App, AssetHandle, MemorySink } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/terrain` node suite drives (coding standards §10).
 *
 * A headless app runs on Lite's null engine: no chunk mesh is created, but the height field, the
 * splat weights, the queries, `colliderInit`, and the scatter placement all run, which is the whole
 * package apart from the draw.
 */

/** How many milliseconds one second is, for the manual clock. */
const MILLISECONDS_PER_SECOND = 1000;

/** Options accepted by {@link createTerrainApp}. */
export interface TerrainAppOptions {
  /** Address to body, for the injected `fetch`. Strings are sent as UTF-8. */
  readonly files?: Readonly<Record<string, ArrayBuffer | Uint8Array | string>>;
}

/** A headless app with `@ignifx/terrain` registered, plus the stepping helpers. */
export interface TerrainAppHarness {
  /** The app. */
  readonly app: App;
  /** Everything the app logged, for asserting the `IGX-16##` warnings. */
  readonly log: MemorySink;
  /** Runs one frame, advancing the manual clock by the same amount. */
  readonly step: (deltaSeconds?: number) => void;
  /** Lets pending microtasks run, runs one frame, and flushes again. */
  readonly settle: (deltaSeconds?: number) => Promise<void>;
  /** Loads an address and waits for it, without needing a running loop. */
  readonly load: <T>(address: string) => Promise<AssetHandle<T>>;
  /** Disposes the app. */
  readonly dispose: () => void;
}

/**
 * Lets every queued microtask and promise continuation run.
 *
 * @returns A promise that settles on the next macrotask.
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Answers asset reads from a table of addresses.
 *
 * @param files - Address to body.
 * @returns A `fetch` the asset service can read through.
 */
function tableFetch(files: Readonly<Record<string, ArrayBuffer | Uint8Array | string>>): typeof globalThis.fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Generated shaders reach the loader as `data:` URLs, which the platform decodes for us.
    if (url.startsWith("data:")) {
      return globalThis.fetch(input);
    }
    const address = url.replace(/^assets\//u, "");
    const body = files[url] ?? files[address] ?? null;
    if (body === null) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    // `Response` accepts a `Uint8Array` at runtime; the DOM typing names `BodyInit`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Promise.resolve(new Response(body as BodyInit, { status: 200 }));
  };
}

/**
 * Builds a headless app with the terrain extension registered.
 *
 * @param options - The fixture table.
 * @returns The harness.
 */
export async function createTerrainApp(options?: TerrainAppOptions): Promise<TerrainAppHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: log,
    logLevel: "debug",
    fetch: tableFetch(options?.files ?? {}),
    extensions: [terrain()],
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
