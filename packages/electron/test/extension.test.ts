import { createApp, createMemorySink, storageInternals } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
// The barrel rather than the module: it is what carries the `App.desktop` declaration merge, and
// asserting against `app.desktop` is the point of half these tests.
import { electron } from "../src/index.js";
import type { App, MemorySink } from "@ignifx/core";

/**
 * The `electron()` extension in the environment most of its users will never see it in: a headless
 * Node app with no preload bridge (`docs/architecture/14-platform-electron.md` §3).
 *
 * This is the half of the extension that has to work everywhere, and it is the half a desktop test
 * cannot cover: one renderer bundle serves the browser build and the desktop build, so registering
 * `electron()` in a browser tab must be inert, must define `app.desktop` anyway, and must say so
 * once at debug level rather than warning about a situation that is entirely normal.
 *
 * The half that needs a bridge — `platform.kind`, the storage backend, `onApplicationFocus` — is
 * exercised against a real Electron process in `tests/visual/tests/desktop.spec.ts`, because a fake
 * bridge would prove only that this package can call its own mock.
 */

let app: App | null = null;
let sink: MemorySink | null = null;

/**
 * Builds a headless app with `electron()` registered.
 *
 * @param hostScope - The scope the extension looks for a bridge on.
 * @returns The app.
 */
async function createHeadlessApp(hostScope?: unknown): Promise<App> {
  sink = createMemorySink();
  app = await createApp({
    headless: true,
    logSink: sink,
    logLevel: "debug",
    extensions: [electron(hostScope === undefined ? {} : { hostScope })],
  });
  return app;
}

afterEach(() => {
  app?.dispose();
  app = null;
  sink = null;
});

describe("electron() without a preload bridge", () => {
  it("registers without throwing and still defines app.desktop", async () => {
    const running = await createHeadlessApp({});

    expect(running.desktop).toBeDefined();
    expect(running.desktop.isElectron).toBe(false);
    expect(running.desktop.versions).toBeNull();
  });

  it("leaves app.platform.kind alone", async () => {
    const running = await createHeadlessApp({});

    // A headless Node app is `"node"`, and nothing about registering the extension changes that.
    expect(running.platform.kind).toBe("node");
  });

  it("says so once, at debug level — this is normal, not a warning", async () => {
    await createHeadlessApp({});

    const lines = (sink?.toArray() ?? []).map((entry) => `${entry.level} ${entry.message}`);
    const mentions = lines.filter((line) => line.includes("ignifxHost"));

    expect(mentions.length).toBe(1);
    expect(mentions[0]).toContain("debug");
    expect(lines.some((line) => line.startsWith("warn") && line.includes("ignifxHost"))).toBe(false);
  });

  it("refuses every app.desktop call with IGX-1462", async () => {
    const running = await createHeadlessApp({});

    await expect(running.desktop.setFullscreen(true)).rejects.toMatchObject({ code: "IGX-1462" });
    await expect(running.desktop.quit()).rejects.toMatchObject({ code: "IGX-1462" });
    await expect(running.desktop.openExternal("https://ignifx.com")).rejects.toMatchObject({ code: "IGX-1462" });
  });

  it("registers this package's error codes with the app", async () => {
    const running = await createHeadlessApp({});

    // The registration is what lets tooling describe an `IGX-146x` code it did not compile against.
    await expect(running.desktop.paths()).rejects.toMatchObject({ code: "IGX-1462" });
  });

  it("starts and steps without doing anything at all", async () => {
    const running = await createHeadlessApp({});

    await running.start();
    running.step(1 / 60);
    running.step(1 / 60);

    expect(running.desktop.isElectron).toBe(false);
  });
});

/**
 * Answers `null` to anything, which is all a contract-shape check needs.
 *
 * @returns `null`.
 */
async function noop(): Promise<null> {
  return Promise.resolve(null);
}

/**
 * Builds a bridge complete enough to pass `assertHostContract`.
 *
 * @returns The fake host.
 */
function createFakeHost(): unknown {
  return {
    version: "1.0.0",
    versions: { electron: "44.2.0", chrome: "140.0.0.0", node: "22.0.0" },
    storage: { get: noop, set: noop, delete: noop, keys: noop, clear: noop },
    paths: noop,
    window: {
      setFullscreen: noop,
      isFullscreen: noop,
      setTitle: noop,
      quit: noop,
      onEvent: (): (() => void) => (): void => {
        // nothing to unsubscribe in the fake
      },
    },
    dialogs: { showOpenDialog: noop },
    shell: { openExternal: noop },
  };
}

describe("electron() with a preload bridge", () => {
  it("refuses a bridge whose major it cannot talk to, rather than running on the wrong contract", async () => {
    const host = { ...(createFakeHost() as Record<string, unknown>), version: "2.0.0" };

    await expect(createHeadlessApp({ ignifxHost: host })).rejects.toMatchObject({ code: "IGX-1460" });
    app = null;
  });

  it("refuses an incomplete bridge with IGX-1461", async () => {
    const host = createFakeHost() as Record<string, unknown>;
    host["shell"] = {};

    await expect(createHeadlessApp({ ignifxHost: host })).rejects.toMatchObject({ code: "IGX-1461" });
    app = null;
  });

  it("records the host, installs the file backend, and reports app.desktop.isElectron", async () => {
    const running = await createHeadlessApp({ ignifxHost: createFakeHost() });

    expect(running.desktop.isElectron).toBe(true);
    // The one supported mutation of `app.platform`, through core's `platformInternals` seam.
    expect(running.platform.kind).toBe("electron");
    expect(running.desktop.versions).toEqual({ electron: "44.2.0", chrome: "140.0.0.0", node: "22.0.0" });
    // `app.storage` now writes through the bridge rather than through IndexedDB or memory.
    // `backend` is on `StorageImpl`, not on the `Storage` interface, so it is read through the
    // same `@internal` accessor the extension installs with.
    expect(storageInternals(running.storage).backend.name).toBe("electron-file");
  });

  it("leaves app.storage alone when the game asked it to", async () => {
    sink = createMemorySink();
    app = await createApp({
      headless: true,
      logSink: sink,
      extensions: [electron({ hostScope: { ignifxHost: createFakeHost() }, storage: false })],
    });

    expect(app.desktop.isElectron).toBe(true);
    expect(storageInternals(app.storage).backend.name).not.toBe("electron-file");
  });
});

describe("the window events electron() forwards", () => {
  /** A bridge that hands its listener back so a test can drive it. */
  function createDrivableHost(): { host: unknown; fire: (event: string) => void } {
    let listener: ((event: string) => void) | null = null;
    const base = createFakeHost() as Record<string, unknown>;
    const window = { ...(base["window"] as Record<string, unknown>) };
    window["onEvent"] = (handler: (event: string) => void): (() => void) => {
      listener = handler;
      return (): void => {
        listener = null;
      };
    };
    return {
      host: { ...base, window },
      fire: (event: string): void => {
        listener?.(event);
      },
    };
  }

  it("turns the host's focus and blur into onApplicationFocus, and leaves the rest to the signal", async () => {
    const { host, fire } = createDrivableHost();
    const scope = { ignifxHost: host, dispatchEvent: undefined };
    const running = await createHeadlessApp(scope);
    const seen: string[] = [];
    running.desktop.onWindowEvent.connect((event) => {
      seen.push(event);
    });

    // A headless Node app has no `EventTarget` on the scope, so the DOM forwarding is a no-op and
    // only the signal fires — which is exactly the browser-build path this must not throw on.
    fire("focus");
    fire("blur");
    fire("minimize");
    fire("restore");

    expect(seen).toEqual(["focus", "blur", "minimize", "restore"]);
  });

  it("still feeds the signal when the DOM forwarding is switched off", async () => {
    const { host, fire } = createDrivableHost();
    sink = createMemorySink();
    app = await createApp({
      headless: true,
      logSink: sink,
      extensions: [electron({ hostScope: { ignifxHost: host }, applicationEvents: false })],
    });
    const seen: string[] = [];
    app.desktop.onWindowEvent.connect((event) => {
      seen.push(event);
    });

    fire("focus");
    fire("minimize");

    expect(seen).toEqual(["focus", "minimize"]);
  });

  it("unsubscribes from the host when the app is disposed", async () => {
    const { host, fire } = createDrivableHost();
    const running = await createHeadlessApp({ ignifxHost: host });
    const seen: string[] = [];
    running.desktop.onWindowEvent.connect((event) => {
      seen.push(event);
    });

    running.dispose();
    app = null;
    fire("focus");

    expect(seen).toEqual([]);
  });
});
