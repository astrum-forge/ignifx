import {
  array,
  asset,
  bool,
  color,
  createApp,
  createManualClock,
  createMemorySink,
  entityRef,
  enumOf,
  f32,
  i32,
  Script,
  str,
  vec3,
} from "@ignifx/core";
import { devtools } from "../../src/extension.js";
import { DevtoolsService } from "../../src/service.js";
import { defaultDevtoolsSettings } from "../../src/settings.js";
import { createFakeDom } from "./fake-dom.js";
import type { FakeDom, FakeDomOptions } from "./fake-dom.js";
import type { DevtoolsDomTarget } from "../../src/dom/dom-target.js";
import type { DevtoolsOptions } from "../../src/extension.js";
import type { DevtoolsLogSink } from "../../src/log-sink.js";
import type { DevtoolsSettings } from "../../src/settings.js";
import type { App, AssetManifest, MemorySink, SettingsInput, System } from "@ignifx/core";

/**
 * The headless harnesses every `@ignifx/devtools` node suite drives.
 *
 * Two of them, because the package has two halves. {@link createDevtoolsApp} builds a real app with
 * `devtools()` registered, which is what the extension-level assertions need — zero systems, the
 * headless no-op, the settings section, the error table. {@link createOverlayHarness} builds a
 * `DevtoolsService` over the fake DOM, which is what everything with an element in it needs, and it
 * is the same seam `@ignifx/ui`'s `createTestHost` opens: one `as unknown as DevtoolsDomTarget`, in
 * a test helper, instead of an abstraction at every call site.
 */

/** How many milliseconds one second is, for the manual clock. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * An asset class used only as the token of the harness component's `asset()` field.
 *
 * `AssetTypeToken` is satisfied structurally through `prototype`, so a class is the shape the
 * schema wants even though this one carries nothing but its type name.
 */
// oxlint-disable-next-line typescript/no-extraneous-class -- it is a token, not a service.
export class ProbeAsset {
  /** The type name written into files. */
  static assetType = "binary";
}

/**
 * A component declaring one field of every kind the inspector has an editor for, plus the three
 * `FieldOptions` the inspector honours.
 */
export class Probe extends Script.define({
  speed: f32(5, { min: 0, max: 10, step: 0.5, tooltip: "How fast the probe moves." }),
  count: i32(2, { min: 0, max: 9 }),
  flag: bool(true),
  label: str("hello"),
  mode: enumOf(["idle", "busy"], "idle"),
  offset: vec3({ x: 1, y: 2, z: 3 }),
  tint: color({ r: 1, g: 0, b: 0, a: 1 }),
  texture: asset(ProbeAsset),
  target: entityRef(),
  secret: f32(7, { hidden: true }),
  locked: f32(8, { readonly: true }),
  grouped: f32(9, { group: "Advanced" }),
  tags: array(str(), ["a"]),
}) {
  /** The namespaced registration id. */
  static typeId = "devtools-test/Probe";
}

/**
 * Answers asset reads from a table of addresses.
 *
 * @param files - Address to body.
 * @returns A `fetch` the asset service can read through.
 */
function tableFetch(files: Readonly<Record<string, string>>): typeof globalThis.fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = files[url] ?? null;
    return Promise.resolve(body === null ? new Response(null, { status: 404 }) : new Response(body, { status: 200 }));
  };
}

/** What {@link createDevtoolsApp} accepts. */
export interface DevtoolsAppOptions {
  /** Project settings, merged into `createApp`. */
  readonly settings?: SettingsInput;
  /** What to pass `devtools(...)`. */
  readonly options?: DevtoolsOptions;
}

/** A headless app with `@ignifx/devtools` registered. */
export interface DevtoolsAppHarness {
  /** The app. */
  readonly app: App;
  /** Everything the app logged. */
  readonly log: MemorySink;
  /** Runs one frame, advancing the manual clock by the same amount. */
  readonly step: (deltaSeconds?: number) => void;
  /** Disposes the app. */
  readonly dispose: () => void;
}

/**
 * Builds a headless app with the devtools extension registered.
 *
 * @param options - Settings and extension options.
 * @returns The harness.
 */
export async function createDevtoolsApp(options: DevtoolsAppOptions = {}): Promise<DevtoolsAppHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: log,
    logLevel: "debug",
    extensions: [devtools(options.options)],
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  app.registerComponents([Probe]);
  return {
    app,
    log,
    step: (deltaSeconds = 1 / 60): void => {
      clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
      app.step(deltaSeconds);
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/** What {@link createOverlayHarness} accepts. */
export interface OverlayHarnessOptions extends FakeDomOptions {
  /** Overrides for the resolved `devtools` settings section. */
  readonly settings?: Partial<DevtoolsSettings>;
  /** The Console panel's sink. */
  readonly logSink?: DevtoolsLogSink;
  /** Build the service with no DOM at all, as a headless app has. */
  readonly headless?: boolean;
  /**
   * Drive the app on the host's real clock rather than the manual one, so the scheduler's
   * development-only per-phase timings are non-zero. The Timeline panel is the only thing that
   * needs it.
   */
  readonly realClock?: boolean;
  /** The asset manifest the app is built with, for the Assets panel. */
  readonly manifest?: AssetManifest;
  /** Address to body, for the injected `fetch`. */
  readonly files?: Readonly<Record<string, string>>;
}

/** A `DevtoolsService` over the fake DOM. */
export interface OverlayHarness {
  /** The app the service inspects. */
  readonly app: App;
  /** The service under test. */
  readonly service: DevtoolsService;
  /** The fake DOM the overlay mounts into. */
  readonly dom: FakeDom;
  /** Every system the service registered, in order. */
  readonly systems: System[];
  /** Everything the app logged. */
  readonly log: MemorySink;
  /** Runs one frame, advancing the manual clock and every registered system. */
  readonly step: (deltaSeconds?: number) => void;
  /** Disposes the service and the app. */
  readonly dispose: () => void;
}

/**
 * Builds a service over a fresh fake DOM, on a headless app.
 *
 * @remarks
 * The systems the service registers are collected rather than handed to the app's scheduler, so a
 * test can assert on how many there are and drive them by hand — which is exactly what the
 * zero-cost assertions need.
 *
 * @param options - The canvas size, the settings overrides, and the log sink.
 * @returns The harness.
 */
export async function createOverlayHarness(options: OverlayHarnessOptions = {}): Promise<OverlayHarness> {
  const clock = createManualClock();
  const log = createMemorySink();
  const app = await createApp({
    headless: true,
    logSink: log,
    logLevel: "debug",
    ...(options.realClock === true ? {} : { clock }),
    ...(options.manifest === undefined ? {} : { assets: { manifest: options.manifest } }),
    ...(options.files === undefined ? {} : { fetch: tableFetch(options.files) }),
  });
  app.registerComponents([Probe]);
  const dom = createFakeDom(options);
  const systems: System[] = [];
  const settings: DevtoolsSettings = { ...defaultDevtoolsSettings(), ...options.settings };
  const service = new DevtoolsService({
    app,
    settings,
    logSink: options.logSink ?? null,
    registerSystem: (system: System): void => {
      systems.push(system);
    },
    resolveTarget: (): DevtoolsDomTarget | null =>
      options.headless === true ? null : (dom as unknown as DevtoolsDomTarget),
  });
  return {
    app,
    service,
    dom,
    systems,
    log,
    step: (deltaSeconds = 1 / 60): void => {
      if (options.realClock !== true) {
        clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
      }
      app.step(deltaSeconds);
      for (const system of systems) {
        system.update?.({ world: app.world, time: app.time, phase: 5, dt: deltaSeconds });
      }
    },
    dispose: (): void => {
      service.dispose();
      app.dispose();
    },
  };
}
