import { createApp } from "../../../src/app/app.js";
import { assetsInternals } from "../../../src/assets/assets-service.js";
import { createMemorySink } from "../../../src/log/memory-sink.js";
import { rendererInternals } from "../../../src/render/renderer.js";
import { createManualClock } from "../../../src/time/clock.js";
import { FakeFetch } from "../../assets/support/fake-fetch.js";
import type { App, ErrorReport, Extension } from "../../../src/app/types.js";
import type { AssetsImpl } from "../../../src/assets/assets-service.js";
import type { AssetManifest } from "../../../src/assets/types.js";
import type { MemorySink } from "../../../src/log/memory-sink.js";
import type { RendererImpl } from "../../../src/render/renderer.js";
import type { SettingsInput } from "../../../src/settings/settings-input.js";
import type { World } from "../../../src/world/world.js";

/**
 * A headless app with the whole render layer registered, a fake network, a manual clock, and a
 * memory log sink.
 *
 * Everything the render components need is already in place because the core extension registers it
 * (`docs/architecture/04-extensions.md` §7); the harness adds the accessors every test reaches for,
 * a `frame()` that runs one whole ignifx frame — which is what drives the `PreRender` render-sync
 * system — and a way to read the warnings `IGX-0705`/`IGX-0706` produce.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The frame delta every step uses unless a test passes its own. */
export const STEP = 1 / 60;

/** Options accepted by {@link createRenderHarness}. */
export interface RenderHarnessOptions {
  /** The address-to-URL table. */
  readonly manifest?: AssetManifest;
  /** Project settings, for example `{ rendering: { features: { shadows: true } } }`. */
  readonly settings?: SettingsInput;
  /** Extra extensions. */
  readonly extensions?: readonly Extension[];
}

/** The app, its world, the rendering service, and the fakes around them. */
export interface RenderHarness {
  /** The app. */
  readonly app: App;
  /** The world the components are attached to. */
  readonly world: World;
  /** The rendering service, with its engine-owned half reachable. */
  readonly renderer: RendererImpl;
  /** The asset service, with its engine-owned half reachable. */
  readonly assets: AssetsImpl;
  /** The `fetch` the service reads through. */
  readonly net: FakeFetch;
  /** Every log record the app produced. */
  readonly log: MemorySink;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** Runs one whole frame, which is what makes the render-sync system reconcile. */
  frame(deltaSeconds?: number): void;
  /** Lets every pending microtask and `fetch` continuation run. */
  flush(): Promise<void>;
  /** Flushes, runs one frame, and flushes again. */
  settle(deltaSeconds?: number): Promise<void>;
  /** Disposes the app. */
  dispose(): void;
}

/** Lets every queued microtask and promise continuation run (coding standards §10). */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** Builds a headless app with the render layer registered. */
export async function createRenderHarness(options?: RenderHarnessOptions): Promise<RenderHarness> {
  const net = new FakeFetch();
  const clock = createManualClock();
  const log = createMemorySink();
  const errors: ErrorReport[] = [];
  const app = await createApp({
    headless: true,
    clock,
    fetch: net.fetch,
    logSink: log,
    logLevel: "debug",
    ...(options?.manifest === undefined ? {} : { assets: { manifest: options.manifest } }),
    settings: { time: { maximumDeltaTime: 1000 }, ...options?.settings },
    ...(options?.extensions === undefined ? {} : { extensions: options.extensions }),
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  const frame = (deltaSeconds: number = STEP): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  return {
    app,
    world: app.world,
    renderer: rendererInternals(app.renderer),
    assets: assetsInternals(app.assets),
    net,
    log,
    errors,
    frame,
    flush: flushMicrotasks,
    settle: async (deltaSeconds: number = STEP): Promise<void> => {
      await flushMicrotasks();
      frame(deltaSeconds);
      await flushMicrotasks();
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/** Every message the app logged at `warn` or above. */
export function warningsOf(harness: RenderHarness): readonly string[] {
  return harness.log
    .toArray()
    .filter((record) => record.level === "warn" || record.level === "error")
    .map((record) => record.message);
}
