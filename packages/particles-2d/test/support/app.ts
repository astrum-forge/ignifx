import { readFileSync } from "node:fs";
import { twoD, TwoDService } from "@ignifx/2d";
import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { particles } from "@ignifx/particles";
import { particles2D } from "../../src/index.js";
import type { SpriteBatch, SpriteBatchOptions } from "@ignifx/2d";
import type { App, AssetHandle, MemorySink, ServiceKey, SettingsInput } from "@ignifx/core";

/**
 * The headless harness every `@ignifx/particles-2d` node suite drives (coding standards §10).
 *
 * A headless app runs on Lite's null engine, so a `SpriteBatch` validates and counts but uploads
 * nothing. {@link recordBatches} is what lets a suite read the numbers the component wrote into it;
 * the pixels are the browser suite's job.
 */

/** How many milliseconds one second is, for the manual clock. */
const MILLISECONDS_PER_SECOND = 1000;

/** Where the checked-in 2D fixtures live, relative to this file. */
const FIXTURE_ROOT = new URL("../../../../tests/fixtures/assets/2d/", import.meta.url);

/** Options accepted by {@link createParticles2DApp}. */
export interface Particles2DAppOptions {
  /** Project settings, merged into `createApp`. */
  readonly settings?: SettingsInput;
  /** Extra files the injected `fetch` answers, beyond the 2D fixtures. */
  readonly files?: Readonly<Record<string, ArrayBuffer | string>>;
}

/** A headless app with the three extensions registered, plus the stepping helpers. */
export interface Particles2DAppHarness {
  /** The app. */
  readonly app: App;
  /** Everything the app logged, for asserting `IGX-175#` warnings. */
  readonly log: MemorySink;
  /** Runs one frame, advancing the manual clock by the same amount. */
  readonly step: (deltaSeconds?: number) => void;
  /** Loads an address and waits for it, without needing a running loop. */
  readonly load: <T>(address: string) => Promise<AssetHandle<T>>;
  /** Disposes the app. */
  readonly dispose: () => void;
}

/** One slot as the component last wrote it. */
export interface RecordedSprite {
  /** The world X the sprite is centred on, in metres. */
  x: number;
  /** The world Y, in metres, +Y up. */
  y: number;
  /** The drawn width, in metres. */
  width: number;
  /** The drawn height, in metres. */
  height: number;
  /** The atlas frame index. */
  frame: number;
  /** The rotation, in degrees counter-clockwise. */
  rotation: number;
  /** The linear red tint. */
  r: number;
  /** The linear green tint. */
  g: number;
  /** The linear blue tint. */
  b: number;
  /** The alpha. */
  a: number;
}

/** What one component claimed and wrote. */
export interface RecordedBatch {
  /** The options the component asked for. */
  readonly options: SpriteBatchOptions;
  /** The slots, by index, holding the values of the last write to each. */
  readonly sprites: Map<number, RecordedSprite>;
  /** The slots the component hid explicitly. */
  readonly hidden: number[];
  /** The batch's `count` as the component last set it. */
  count: number;
  /** Whether the component disposed the batch. */
  isDisposed: boolean;
}

/** What {@link recordBatches} returns. */
export interface BatchRecorder {
  /** Every batch claimed since recording started, in claim order. */
  readonly batches: RecordedBatch[];
  /** The batch a single-system suite claimed, or `null` before the first frame that draws. */
  readonly first: () => RecordedBatch | null;
  /** The slots of {@link BatchRecorder.first}, in index order, up to its count. */
  readonly sprites: () => readonly RecordedSprite[];
}

/**
 * Watches what `ParticleSystem2D` writes into its sprite batches.
 *
 * @remarks
 * A headless batch keeps no geometry — it exists to validate indices and remember `count` — so the
 * only way to assert the numbers the component produced is to record them as they pass. The
 * recorder wraps the real batch rather than replacing it, so index validation, the count rules and
 * disposal still run.
 *
 * @param app - The app whose 2D service hands out batches.
 * @returns The recorder.
 */
export function recordBatches(app: App): BatchRecorder {
  const service = app.services.tryGet(TwoDService);
  if (service === null) {
    throw new Error("the app has no TwoDService");
  }
  const batches: RecordedBatch[] = [];
  const create = service.createSpriteBatch.bind(service);
  service.createSpriteBatch = (options: SpriteBatchOptions): SpriteBatch => {
    const inner = create(options);
    const record: RecordedBatch = { options, sprites: new Map(), hidden: [], count: 0, isDisposed: false };
    batches.push(record);
    return wrap(inner, record);
  };
  return {
    batches,
    first: (): RecordedBatch | null => batches[0] ?? null,
    sprites: (): readonly RecordedSprite[] => {
      const record = batches[0];
      if (record === undefined) {
        return [];
      }
      const out: RecordedSprite[] = [];
      for (let index = 0; index < record.count; index += 1) {
        const sprite = record.sprites.get(index);
        if (sprite !== undefined) {
          out.push(sprite);
        }
      }
      return out;
    },
  };
}

/**
 * Wraps one batch so every call is recorded and then forwarded.
 *
 * @param inner - The real batch.
 * @param record - Where to record.
 * @returns The wrapper.
 */
function wrap(inner: SpriteBatch, record: RecordedBatch): SpriteBatch {
  const wrapper: SpriteBatch = {
    capacity: inner.capacity,
    get count(): number {
      return inner.count;
    },
    set count(value: number) {
      inner.count = value;
      record.count = value;
    },
    // oxlint-disable-next-line max-params -- mirrors `SpriteBatch.write`, which takes them positionally.
    write(
      index: number,
      x: number,
      y: number,
      width: number,
      height: number,
      frame: number,
      rotation: number,
      r: number,
      g: number,
      b: number,
      a: number,
      flipX?: boolean,
      flipY?: boolean,
    ): void {
      inner.write(index, x, y, width, height, frame, rotation, r, g, b, a, flipX, flipY);
      record.sprites.set(index, { x, y, width, height, frame, rotation, r, g, b, a });
    },
    hide(index: number): void {
      inner.hide(index);
      record.hidden.push(index);
    },
    dispose(): void {
      inner.dispose();
      record.isDisposed = true;
    },
    get lite(): SpriteBatch["lite"] {
      return inner.lite;
    },
    [Symbol.dispose](): void {
      wrapper.dispose();
    },
  };
  return wrapper;
}

/**
 * The service registered under a key, or a failure naming it.
 *
 * @param app - The app.
 * @param key - The service class.
 * @returns The instance.
 */
export function requireService<T>(app: App, key: ServiceKey<T>): T {
  const service = app.services.tryGet(key);
  if (service === null) {
    throw new Error("the app has no such service");
  }
  return service;
}

/**
 * Reads one of the checked-in 2D fixtures as text.
 *
 * @param name - The file name, for example `"hero.atlas.json"`.
 * @returns Its contents.
 */
export function readFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_ROOT), "utf8");
}

/**
 * Reads one of the checked-in 2D fixtures as bytes.
 *
 * @param name - The file name, for example `"hero.png"`.
 * @returns Its contents.
 */
export function readFixtureBytes(name: string): ArrayBuffer {
  const buffer = readFileSync(new URL(name, FIXTURE_ROOT));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * The fixture table the suites hand {@link createParticles2DApp}, addressed as `2d/<name>`.
 *
 * @returns Address to body.
 */
export function fixtureFiles(): Readonly<Record<string, ArrayBuffer | string>> {
  return {
    "2d/hero.atlas.json": readFixture("hero.atlas.json"),
    "2d/hero.png": readFixtureBytes("hero.png"),
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
 * Builds a headless app with `twoD()`, `particles()` and `particles2D()` registered.
 *
 * @param options - Settings and extra fixture files.
 * @returns The harness.
 */
export async function createParticles2DApp(options?: Particles2DAppOptions): Promise<Particles2DAppHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: log,
    logLevel: "debug",
    fetch: tableFetch({ ...fixtureFiles(), ...options?.files }),
    extensions: [twoD(), particles(), particles2D()],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
  });
  return {
    app,
    log,
    step: (deltaSeconds = 1 / 60): void => {
      clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
      app.step(deltaSeconds);
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
