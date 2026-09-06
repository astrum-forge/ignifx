import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it, vi } from "vitest";
import { HOST_CONTRACT_VERSION, isCompatibleHostVersion } from "../src/host-contract.js";
import { HostDesktop, UnavailableDesktop } from "../src/renderer/desktop.js";
import { assertHostContract, findIgnifxHost, REQUIRED_HOST_MEMBERS } from "../src/renderer/host.js";
import { ELECTRON_STORAGE_BACKEND_NAME, ElectronStorageBackend } from "../src/renderer/storage-backend.js";
import type { HostStoredValue, HostWindowEvent, IgnifxHost } from "../src/host-contract.js";

/**
 * The renderer half: bridge detection, the `StorageBackend`, and `app.desktop`
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * Nothing here imports `electron`, and that is the assertion as much as the code: the renderer runs
 * in a sandboxed, context-isolated page whose only interface is `window.ignifxHost`, so the whole
 * surface is testable in plain Node against a hand-written host.
 */

/** What a fake host recorded. */
interface FakeHostRecord {
  readonly calls: { member: string; args: readonly unknown[] }[];
  readonly values: Map<string, HostStoredValue>;
  listeners: ((event: HostWindowEvent) => void)[];
  fail: string | null;
}

/**
 * Builds a complete, well-behaved fake bridge.
 *
 * @param record - Where calls are recorded.
 * @returns The host.
 */
function createFakeHost(record: FakeHostRecord): IgnifxHost {
  const note = async <T>(member: string, value: T, ...args: readonly unknown[]): Promise<T> => {
    record.calls.push({ member, args });
    if (record.fail === member) {
      throw new Error(`main process refused ${member}`);
    }
    return value;
  };
  return {
    version: HOST_CONTRACT_VERSION,
    versions: { electron: "44.2.0", chrome: "140.0.0.0", node: "22.0.0" },
    storage: {
      get: async (namespace, key) => note("storage.get", record.values.get(`${namespace}/${key}`) ?? null),
      set: async (namespace, key, value) => {
        record.values.set(`${namespace}/${key}`, value);
        return note("storage.set", undefined, namespace, key, value);
      },
      delete: async (namespace, key) => {
        record.values.delete(`${namespace}/${key}`);
        return note("storage.delete", undefined);
      },
      keys: async () => note<readonly string[]>("storage.keys", [...record.values.keys()]),
      clear: async () => note("storage.clear", undefined),
    },
    paths: async () =>
      note("paths", {
        userData: "/u",
        appData: "/a",
        temp: "/t",
        home: "/h",
        downloads: "",
        documents: "",
        appPath: "/app",
      }),
    window: {
      setFullscreen: async (value) => note("window.setFullscreen", undefined, value),
      isFullscreen: async () => note("window.isFullscreen", true),
      setTitle: async (title) => note("window.setTitle", undefined, title),
      quit: async () => note("window.quit", undefined),
      onEvent: (listener) => {
        record.listeners.push(listener);
        return (): void => {
          record.listeners = record.listeners.filter((entry) => entry !== listener);
        };
      },
    },
    dialogs: {
      showOpenDialog: async (options) => note("dialogs.showOpenDialog", { canceled: true, paths: [] }, options),
    },
    shell: {
      openExternal: async (url) => note("shell.openExternal", undefined, url),
    },
  };
}

/**
 * Builds an empty recording.
 *
 * @returns The recording.
 */
function createRecord(): FakeHostRecord {
  return { calls: [], values: new Map<string, HostStoredValue>(), listeners: [], fail: null };
}

describe("findIgnifxHost", () => {
  it("finds a bridge on the scope it is given", () => {
    const host = createFakeHost(createRecord());

    expect(findIgnifxHost({ ignifxHost: host })).toBe(host);
  });

  it("answers null wherever there is none, which is every browser tab and every Node test", () => {
    expect(findIgnifxHost({})).toBeNull();
    expect(findIgnifxHost({ ignifxHost: null })).toBeNull();
    expect(findIgnifxHost({ ignifxHost: "not an object" })).toBeNull();
    expect(findIgnifxHost(null)).toBeNull();
    expect(findIgnifxHost(42)).toBeNull();
  });
});

describe("assertHostContract", () => {
  it("accepts a complete bridge of the same major", () => {
    expect(() => {
      assertHostContract(createFakeHost(createRecord()));
    }).not.toThrow();
  });

  it("accepts a newer minor and rejects a different major with IGX-1460", () => {
    expect(isCompatibleHostVersion("1.9.3")).toBe(true);
    expect(isCompatibleHostVersion("2.0.0")).toBe(false);
    expect(isCompatibleHostVersion("")).toBe(false);
    expect(isCompatibleHostVersion("not-a-version")).toBe(false);

    const stale = { ...createFakeHost(createRecord()), version: "2.0.0" };
    let thrown: unknown = null;
    try {
      assertHostContract(stale);
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1460");
  });

  it("names the missing member with IGX-1461", () => {
    const incomplete = createFakeHost(createRecord());
    const broken: IgnifxHost = {
      ...incomplete,
      window: { ...incomplete.window, setTitle: undefined as unknown as IgnifxHost["window"]["setTitle"] },
    };

    let thrown: unknown = null;
    try {
      assertHostContract(broken);
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1461");
    expect(thrown instanceof Error && thrown.message).toContain("window.setTitle");
  });

  it("checks every member the renderer actually calls", () => {
    expect(REQUIRED_HOST_MEMBERS).toContain("storage.set");
    expect(REQUIRED_HOST_MEMBERS).toContain("shell.openExternal");
    expect(REQUIRED_HOST_MEMBERS).toContain("window.onEvent");
  });
});

describe("ElectronStorageBackend", () => {
  it("names itself so a failure says which store it came from", () => {
    const backend = new ElectronStorageBackend(createFakeHost(createRecord()));

    expect(backend.name).toBe(ELECTRON_STORAGE_BACKEND_NAME);
  });

  it("forwards every call to the bridge", async () => {
    const record = createRecord();
    const backend = new ElectronStorageBackend(createFakeHost(record));

    await backend.set("saves", "slot1", { kind: "json", json: "1" });
    expect(await backend.get("saves", "slot1")).toEqual({ kind: "json", json: "1" });
    await backend.keys("saves");
    await backend.delete("saves", "slot1");
    await backend.clear("saves");

    expect(record.calls.map((entry) => entry.member)).toEqual([
      "storage.set",
      "storage.get",
      "storage.keys",
      "storage.delete",
      "storage.clear",
    ]);
  });

  it("copies bytes before they cross, so a reused buffer cannot corrupt the write", async () => {
    const record = createRecord();
    const backend = new ElectronStorageBackend(createFakeHost(record));
    const buffer = new Uint8Array([1, 2, 3]);

    await backend.set("saves", "thumb", { kind: "bytes", bytes: buffer });
    buffer[0] = 99;

    const stored = record.values.get("saves/thumb");
    expect(stored?.kind === "bytes" && [...stored.bytes]).toEqual([1, 2, 3]);
  });

  it("turns a bridge failure into IGX-1425", async () => {
    const record = createRecord();
    record.fail = "storage.get";
    const backend = new ElectronStorageBackend(createFakeHost(record));

    let thrown: unknown = null;
    try {
      await backend.get("saves", "slot1");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1425");
  });

  it("turns an out-of-space failure into IGX-1424", async () => {
    const record = createRecord();
    const host = createFakeHost(record);
    const backend = new ElectronStorageBackend({
      ...host,
      storage: {
        ...host.storage,
        set: async (): Promise<void> => {
          // The prefix is how a quota failure survives Electron's error flattening.
          throw new Error("IGNIFX_STORAGE_QUOTA: ENOSPC: no space left on device");
        },
      },
    });

    let thrown: unknown = null;
    try {
      await backend.set("saves", "slot1", { kind: "json", json: "1" });
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1424");
  });

  it("turns a value it cannot read back into IGX-1426", async () => {
    const record = createRecord();
    const host = createFakeHost(record);
    const backend = new ElectronStorageBackend({
      ...host,
      storage: {
        ...host.storage,
        get: async (): Promise<HostStoredValue> => ({ kind: "json", json: 42 as unknown as string }),
      },
    });

    let thrown: unknown = null;
    try {
      await backend.get("saves", "slot1");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1426");
  });
});

describe("UnavailableDesktop", () => {
  it("answers isElectron false rather than not existing", () => {
    const desktop = new UnavailableDesktop();

    expect(desktop.isElectron).toBe(false);
    expect(desktop.versions).toBeNull();
    expect(desktop.onWindowEvent.connectionCount).toBe(0);
  });

  it("refuses every call with IGX-1462, naming the member", async () => {
    const desktop = new UnavailableDesktop();
    const calls: readonly [string, Promise<unknown>][] = [
      ["paths", desktop.paths()],
      ["setFullscreen", desktop.setFullscreen(true)],
      ["isFullscreen", desktop.isFullscreen()],
      ["setWindowTitle", desktop.setWindowTitle("x")],
      ["quit", desktop.quit()],
      ["showOpenDialog", desktop.showOpenDialog()],
      ["openExternal", desktop.openExternal("https://ignifx.com")],
    ];

    const outcomes = await Promise.all(
      calls.map(async ([member, promise]) => {
        try {
          await promise;
          return `${member}: no error`;
        } catch (error) {
          const code = isIgnifxError(error) ? error.code : "not an IgnifxError";
          const named = error instanceof Error && error.message.includes(member);
          return `${member}: ${code} ${named ? "named" : "unnamed"}`;
        }
      }),
    );

    expect(outcomes).toEqual(calls.map(([member]) => `${member}: IGX-1462 named`));
  });
});

describe("HostDesktop", () => {
  it("forwards every call to the bridge", async () => {
    const record = createRecord();
    const desktop = new HostDesktop(createFakeHost(record));

    expect(desktop.isElectron).toBe(true);
    expect(desktop.versions).toEqual({ electron: "44.2.0", chrome: "140.0.0.0", node: "22.0.0" });

    await desktop.setFullscreen(true);
    expect(await desktop.isFullscreen()).toBe(true);
    await desktop.setWindowTitle("My Game");
    await desktop.quit();
    await desktop.showOpenDialog({ multiple: true });
    await desktop.openExternal("https://ignifx.com");
    await desktop.paths();

    expect(record.calls.map((entry) => entry.member)).toEqual([
      "window.setFullscreen",
      "window.isFullscreen",
      "window.setTitle",
      "window.quit",
      "dialogs.showOpenDialog",
      "shell.openExternal",
      "paths",
    ]);
    expect(record.calls[2]?.args).toEqual(["My Game"]);
    expect(record.calls[5]?.args).toEqual(["https://ignifx.com"]);
  });

  it("wraps a refusal as IGX-1463, naming the channel", async () => {
    const record = createRecord();
    record.fail = "window.setTitle";
    const desktop = new HostDesktop(createFakeHost(record));

    let thrown: unknown = null;
    try {
      await desktop.setWindowTitle("x");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1463");
    expect(thrown instanceof Error && thrown.message).toContain("window.setTitle");
  });

  it("re-emits the host's window events on app.desktop.onWindowEvent", () => {
    const record = createRecord();
    const desktop = new HostDesktop(createFakeHost(record));
    const seen: HostWindowEvent[] = [];
    const mapped: HostWindowEvent[] = [];

    desktop.watchWindowEvents((event) => {
      mapped.push(event);
    });
    desktop.onWindowEvent.connect((event) => {
      seen.push(event);
    });

    for (const event of ["minimize", "restore", "focus", "blur"] as const) {
      for (const listener of record.listeners) {
        listener(event);
      }
    }

    expect(seen).toEqual(["minimize", "restore", "focus", "blur"]);
    // The mapping callback runs *before* the signal, which is what lets `electron()` turn `focus`
    // and `blur` into `onApplicationFocus` in the same tick.
    expect(mapped).toEqual(["minimize", "restore", "focus", "blur"]);
  });

  it("unsubscribes on dispose, twice without complaint", () => {
    const record = createRecord();
    const desktop = new HostDesktop(createFakeHost(record));
    desktop.watchWindowEvents(vi.fn());

    expect(record.listeners.length).toBe(1);
    desktop.dispose();
    desktop.dispose();
    expect(record.listeners.length).toBe(0);
  });
});
