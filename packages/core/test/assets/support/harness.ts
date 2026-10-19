import { createApp } from "../../../src/app/app.js";
import { assetsInternals } from "../../../src/assets/assets-service.js";
import { createManualClock } from "../../../src/time/clock.js";
import { FakeFetch } from "./fake-fetch.js";
import type { App, ErrorReport, Extension } from "../../../src/app/types.js";
import type { AssetsImpl } from "../../../src/assets/assets-service.js";
import type { AssetLoader, AssetManifest } from "../../../src/assets/types.js";
import type { HotReloadOptions } from "../../../src/hot-reload/contract.js";
import type { SettingsInput } from "../../../src/settings/settings-input.js";
import type { ManualClock } from "../../../src/time/clock.js";

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The frame delta every step uses unless a test passes its own. */
export const STEP = 1 / 60;

/** How many frames `settleUntil` runs before it calls a load stuck. */
export const SETTLE_UNTIL_FRAMES = 5000;

/** Options accepted by {@link createAssetHarness}. */
export interface AssetHarnessOptions {
  /** The address-to-URL table. */
  readonly manifest?: AssetManifest;
  /** Project settings, for example `{ assets: { concurrency: 1 } }`. */
  readonly settings?: SettingsInput;
  /** Loaders registered before the first load. */
  readonly loaders?: readonly AssetLoader[];
  /** Extra extensions. */
  readonly extensions?: readonly Extension[];
  /**
   * Whether to call `app.start()` before returning. Defaults to `true`, so delivery waits for
   * `PreUpdate` as in a running game; tests of the pre-start behaviour pass `false`.
   */
  readonly start?: boolean;
  /** Hot-reload options, for the suites that exercise `app.hotReload`. */
  readonly hotReload?: HotReloadOptions;
  /** Builds the app in edit mode. */
  readonly editMode?: boolean;
}

/** A headless app whose asset service is driven entirely by the test. */
export interface AssetHarness {
  /** The app. */
  readonly app: App;
  /** Its asset service, with the engine-owned half reachable. */
  readonly assets: AssetsImpl;
  /** The `fetch` the service reads through. */
  readonly net: FakeFetch;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** Runs one frame, advancing the manual clock by the same amount. */
  step(deltaSeconds?: number): void;
  /** Lets every pending microtask and `fetch` continuation run. */
  flush(): Promise<void>;
  /** Flushes, runs one frame, and flushes again — the usual "make it happen" call. */
  settle(deltaSeconds?: number): Promise<void>;
  /**
   * Runs {@link AssetHarness.settle} until a promise settles, then answers with it.
   *
   * @remarks
   * A started app delivers a load in `PreUpdate`, so a load needs frames, but part of a scene load
   * runs neither in a frame nor on the microtask queue: its content hash is `crypto.subtle.digest`,
   * which Node computes on libuv's thread pool. A fixed number of frames races that pool, and a
   * loaded runner loses: the frames run out, and the load waits for a frame that never comes
   * (`edit-mode.test.ts` on CI, 2026-10-19). So the cap is far above any load's real need,
   * {@link SETTLE_UNTIL_FRAMES} frames, and only there to fail a stuck load by name.
   *
   * @param work - The promise to drive.
   * @param what - What it is, for the error, such as the address being loaded.
   * @returns What `work` resolved with.
   * @throws Error naming `what` and the requests still open, when `work` has not settled after
   * {@link SETTLE_UNTIL_FRAMES} frames.
   */
  settleUntil<T>(work: Promise<T>, what?: string): Promise<T>;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Lets every queued microtask and promise continuation run, without waiting on the wall clock
 * (coding standards §10).
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** Builds a headless app with a fake network and a manual clock. */
export async function createAssetHarness(options?: AssetHarnessOptions): Promise<AssetHarness> {
  const net = new FakeFetch();
  const clock = createManualClock();
  const errors: ErrorReport[] = [];
  const app = await createApp({
    headless: true,
    clock,
    fetch: net.fetch,
    ...(options?.manifest === undefined ? {} : { assets: { manifest: options.manifest } }),
    // A high frame-delta clamp so `step(2)` really advances two seconds: the collector and the
    // retry backoff are driven by the frame delta, and the default 0.1 s clamp would otherwise make
    // every timing assertion a multiple of 100 ms (`01-lifecycle-and-time.md` §2).
    settings: { time: { maximumDeltaTime: 1000 }, ...options?.settings },
    ...(options?.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options?.hotReload === undefined ? {} : { hotReload: options.hotReload }),
    ...(options?.editMode === undefined ? {} : { editMode: options.editMode }),
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  const loaders = options?.loaders ?? [];
  for (const loader of loaders) {
    app.assets.registerLoader(loader);
  }
  // Started, so that delivery waits for `PreUpdate` the way it does in a running game; before
  // `app.start()` a completed load settles at once (`05-assets-and-loading.md` §4), which
  // `idle-delivery.test.ts` covers on its own app.
  if (options?.start !== false) {
    await app.start();
  }
  const step = (deltaSeconds: number = STEP): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  const settle = async (deltaSeconds: number = STEP): Promise<void> => {
    await flushMicrotasks();
    step(deltaSeconds);
    await flushMicrotasks();
  };
  return {
    app,
    assets: assetsInternals(app.assets),
    net,
    clock,
    errors,
    step,
    flush: flushMicrotasks,
    settle,
    settleUntil: async <T>(work: Promise<T>, what = "the promise"): Promise<T> => {
      const state = { done: false };
      const finish = (): void => {
        state.done = true;
      };
      void work.then(finish, finish);
      for (let frame = 0; frame < SETTLE_UNTIL_FRAMES && !state.done; frame += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one frame at a time is the point
        await settle();
      }
      if (!state.done) {
        const open = net.requests.filter((request) => !request.isSettled).map((request) => request.url);
        throw new Error(
          `${what} did not settle within ${String(SETTLE_UNTIL_FRAMES)} frames; open requests: [${open.join(", ")}].`,
        );
      }
      return work;
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}
