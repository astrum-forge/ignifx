// Must come first: it registers the `electron` module mock every import below depends on.
// eslint-disable-next-line import-x/order -- must be evaluated first; it registers the `electron` module mock.
import { electronMock, fakeInvokeEvent, FakeBrowserWindow, resetElectronMock } from "./support/electron-mock.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isIgnifxError } from "@ignifx/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOST_CHANNELS, HOST_WINDOW_EVENT_CHANNEL } from "../src/host-contract.js";
import {
  allowedSenderOrigins,
  installHostHandlers,
  isTrustedSender,
  openDialogOptionsFor,
  resolveHostPaths,
} from "../src/main/ipc.js";
import { FileStorage } from "../src/main/storage-fs.js";
import { applyWebGpuSwitches, LINUX_FEATURES_SWITCH, WEBGPU_SWITCH } from "../src/main/switches.js";
import { FORWARDED_WINDOW_EVENTS, forwardWindowEvents } from "../src/main/window.js";
import type { BrowserWindow } from "electron";

/**
 * The main-process IPC handlers, the window-event forwarder, and the WebGPU switches
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * Every handler is invoked the way `ipcMain` would invoke it — through the channel name, with an
 * ignored event as the first argument — so the argument validation each one does is exercised
 * rather than bypassed.
 */

let root = "";
let window: FakeBrowserWindow;
let removeHandlers: () => void;

/**
 * Calls one registered handler as the game window's own top-level document would.
 *
 * @param channel - The channel name.
 * @param args - The arguments the renderer would have sent.
 * @returns Whatever the handler returned.
 */
async function invoke(channel: string, ...args: readonly unknown[]): Promise<unknown> {
  return invokeAs(fakeInvokeEvent(window), channel, ...args);
}

/**
 * Calls one registered handler as some other sender.
 *
 * @param event - The `IpcMainInvokeEvent` stand-in, from `fakeInvokeEvent`.
 * @param channel - The channel name.
 * @param args - The arguments the renderer would have sent.
 * @returns Whatever the handler returned.
 */
async function invokeAs(event: unknown, channel: string, ...args: readonly unknown[]): Promise<unknown> {
  const handler = electronMock.handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`no handler for ${channel}`);
  }
  return handler(event, ...args);
}

beforeEach(async () => {
  resetElectronMock();
  root = await mkdtemp(join(tmpdir(), "ignifx-ipc-"));
  window = new FakeBrowserWindow();
  removeHandlers = installHostHandlers({
    // The fake stands in for a `BrowserWindow`; only the four members the handlers call exist.
    window: window as unknown as BrowserWindow,
    storage: new FileStorage(root),
  });
});

afterEach(async () => {
  removeHandlers();
  await rm(root, { recursive: true, force: true });
});

describe("installHostHandlers", () => {
  it("registers exactly the channels the contract declares, and removes them again", () => {
    expect([...electronMock.handlers.keys()].toSorted()).toEqual(Object.values(HOST_CHANNELS).toSorted());

    removeHandlers();
    expect(electronMock.handlers.size).toBe(0);
    // Re-installed by `afterEach`'s partner; make the teardown idempotent for this test.
    removeHandlers = (): void => {
      // already removed
    };
  });

  it("round-trips a value through the storage channels", async () => {
    await invoke(HOST_CHANNELS.storageSet, "saves", "slot1", { kind: "json", json: '{"level":3}' });

    expect(await invoke(HOST_CHANNELS.storageGet, "saves", "slot1")).toEqual({
      kind: "json",
      json: '{"level":3}',
    });
    expect(await invoke(HOST_CHANNELS.storageKeys, "saves")).toEqual(["slot1"]);
    expect(await invoke(HOST_CHANNELS.storageKeys, "saves", "nope")).toEqual([]);

    await invoke(HOST_CHANNELS.storageDelete, "saves", "slot1");
    expect(await invoke(HOST_CHANNELS.storageGet, "saves", "slot1")).toBeNull();
  });

  it("clears a namespace through its channel", async () => {
    await invoke(HOST_CHANNELS.storageSet, "saves", "a", { kind: "json", json: "1" });
    await invoke(HOST_CHANNELS.storageClear, "saves");

    expect(await invoke(HOST_CHANNELS.storageKeys, "saves")).toEqual([]);
  });

  it("refuses an argument of the wrong type rather than passing it to the file system", async () => {
    const attempts = (
      [
        [42, "key"],
        ["saves", null],
        [{}, "key"],
      ] as const
    ).map(async (bad) => expect(invoke(HOST_CHANNELS.storageGet, ...bad)).rejects.toThrow());

    await Promise.all(attempts);
  });

  it("refuses a stored value that is neither JSON text nor bytes", async () => {
    const bad = [{ kind: "json", json: 42 }, { kind: "bytes", bytes: "not bytes" }, { kind: "other" }, null];

    const codes = await Promise.all(
      bad.map(async (value) => {
        try {
          await invoke(HOST_CHANNELS.storageSet, "saves", "k", value);
          return "no error";
        } catch (error) {
          return isIgnifxError(error) ? error.code : "not an IgnifxError";
        }
      }),
    );

    expect(codes).toEqual(["IGX-1463", "IGX-1463", "IGX-1463", "IGX-1463"]);
  });

  it("drives the window controls, and ignores them once the window is destroyed", async () => {
    await invoke(HOST_CHANNELS.windowSetFullscreen, true);
    expect(window.fullscreen).toBe(true);
    expect(await invoke(HOST_CHANNELS.windowIsFullscreen)).toBe(true);

    await invoke(HOST_CHANNELS.windowSetTitle, "My Game");
    expect(window.title).toBe("My Game");

    await invoke(HOST_CHANNELS.windowQuit);
    expect(electronMock.quitCalled).toBe(true);

    window.destroyed = true;
    await invoke(HOST_CHANNELS.windowSetTitle, "ignored");
    expect(window.title).toBe("My Game");
    expect(await invoke(HOST_CHANNELS.windowIsFullscreen)).toBe(false);
  });

  it("reports the platform paths, tolerating one the platform does not have", async () => {
    electronMock.missingPaths.add("downloads");

    const paths = await invoke(HOST_CHANNELS.paths);

    expect(paths).toEqual({
      userData: "/tmp/ignifx-test/userData",
      appData: "/tmp/ignifx-test/appData",
      temp: "/tmp",
      home: "/tmp/ignifx-test/home",
      downloads: "",
      documents: "/tmp/ignifx-test/Documents",
      appPath: "/tmp/ignifx-test/app",
    });
    expect(resolveHostPaths().userData).toBe("/tmp/ignifx-test/userData");
  });

  it("shows the open dialog over the captured window and flattens its result", async () => {
    electronMock.openDialogResult = { canceled: false, filePaths: ["/tmp/save.sav"] };

    expect(await invoke(HOST_CHANNELS.dialogsShowOpen, { multiple: true })).toEqual({
      canceled: false,
      paths: ["/tmp/save.sav"],
    });
    const call = electronMock.calls.find((entry) => entry.member === "dialog.showOpenDialog");
    expect(call?.args[0]).toBe(window);
  });

  it("opens an allowed URL and refuses everything else with IGX-1464", async () => {
    await invoke(HOST_CHANNELS.shellOpenExternal, "https://ignifx.com");
    expect(electronMock.opened).toEqual(["https://ignifx.com"]);

    let thrown: unknown = null;
    try {
      await invoke(HOST_CHANNELS.shellOpenExternal, "file:///etc/passwd");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1464");
    // Refused before the shell ever saw it.
    expect(electronMock.opened).toEqual(["https://ignifx.com"]);
  });
});

describe("the sender check every handler runs first", () => {
  /**
   * Reads the code an untrusted sender was refused with.
   *
   * @param event - The sender to pretend to be.
   * @returns The `IgnifxError` code, or `"resolved"` when the call went through.
   */
  async function refusalFor(event: unknown): Promise<string> {
    try {
      await invokeAs(event, HOST_CHANNELS.paths);
      return "resolved";
    } catch (error) {
      return isIgnifxError(error) ? error.code : String(error);
    }
  }

  it("refuses a subframe, another window, a departed frame, and a foreign origin", async () => {
    expect(await refusalFor(fakeInvokeEvent(window, { isMainFrame: false }))).toBe("IGX-1467");
    expect(await refusalFor(fakeInvokeEvent(window, { isGameWindow: false }))).toBe("IGX-1467");
    expect(await refusalFor(fakeInvokeEvent(window, { origin: null }))).toBe("IGX-1467");
    expect(await refusalFor(fakeInvokeEvent(window, { origin: "https://evil.example" }))).toBe("IGX-1467");
    // …and the honest case still works, so the gate is not simply refusing everything.
    expect(await refusalFor(fakeInvokeEvent(window))).toBe("resolved");
  });

  it("refuses before it reads an argument, so a hostile frame cannot even write storage", async () => {
    const hostile = fakeInvokeEvent(window, { origin: "https://evil.example" });

    await expect(
      invokeAs(hostile, HOST_CHANNELS.storageSet, "saves", "slot1", { kind: "json", json: "1" }),
    ).rejects.toThrow("IGX-1467");
    await expect(invokeAs(hostile, HOST_CHANNELS.shellOpenExternal, "https://ignifx.com")).rejects.toThrow("IGX-1467");

    expect(electronMock.opened).toEqual([]);
    expect(await invoke(HOST_CHANNELS.storageKeys, "saves")).toEqual([]);
  });

  it("accepts the dev-server origin only when the entry says the window is on one", async () => {
    expect(allowedSenderOrigins()).toEqual(["ignifx://app"]);
    expect(allowedSenderOrigins("index.html")).toEqual(["ignifx://app"]);
    expect(allowedSenderOrigins("http://localhost:5173/")).toEqual(["http://localhost:5173", "ignifx://app"]);

    const development = new FakeBrowserWindow();
    const remove = installHostHandlers({
      window: development as unknown as BrowserWindow,
      storage: new FileStorage(root),
      entry: "http://localhost:5173/",
    });
    try {
      const fromDevServer = fakeInvokeEvent(development, { origin: "http://localhost:5173" });
      await expect(invokeAs(fromDevServer, HOST_CHANNELS.paths)).resolves.toBeDefined();
    } finally {
      remove();
    }
  });

  it("takes an explicit origin list over what the entry implies", async () => {
    const custom = new FakeBrowserWindow();
    const remove = installHostHandlers({
      window: custom as unknown as BrowserWindow,
      storage: new FileStorage(root),
      origins: ["https://game.example"],
    });
    try {
      await expect(
        invokeAs(fakeInvokeEvent(custom, { origin: "https://game.example" }), HOST_CHANNELS.paths),
      ).resolves.toBeDefined();
      await expect(invokeAs(fakeInvokeEvent(custom), HOST_CHANNELS.paths)).rejects.toThrow("IGX-1467");
    } finally {
      remove();
    }
  });

  it("is a pure predicate, so every way of failing can be stated on its own", () => {
    const origins = ["ignifx://app"];

    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: true }, origins)).toBe(true);
    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: false, isGameWindow: true }, origins)).toBe(false);
    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: false }, origins)).toBe(false);
    expect(isTrustedSender({ origin: null, isMainFrame: true, isGameWindow: true }, origins)).toBe(false);
    expect(isTrustedSender({ origin: "ignifx://evil", isMainFrame: true, isGameWindow: true }, origins)).toBe(false);
  });
});

describe("openDialogOptionsFor", () => {
  it("offers files by default", () => {
    expect(openDialogOptionsFor().properties).toEqual(["openFile"]);
  });

  it("switches to directories when directories are asked for", () => {
    expect(openDialogOptionsFor({ directories: true }).properties).toEqual(["openDirectory"]);
    expect(openDialogOptionsFor({ directories: true, files: true }).properties).toEqual(["openFile", "openDirectory"]);
  });

  it("adds multi-selection only when asked", () => {
    expect(openDialogOptionsFor({ multiple: true }).properties).toEqual(["openFile", "multiSelections"]);
  });

  it("passes through the labels and copies the filters", () => {
    const options = openDialogOptionsFor({
      title: "Load a save",
      defaultPath: "/tmp",
      buttonLabel: "Load",
      filters: [{ name: "Saves", extensions: ["sav"] }],
    });

    expect(options.title).toBe("Load a save");
    expect(options.defaultPath).toBe("/tmp");
    expect(options.buttonLabel).toBe("Load");
    expect(options.filters).toEqual([{ name: "Saves", extensions: ["sav"] }]);
  });

  it("never lets a renderer choose a property of its own", () => {
    // The contract takes booleans, so `showHiddenFiles` and `promptToCreate` are unreachable.
    const options = openDialogOptionsFor({ files: true, directories: true, multiple: true });

    expect(options.properties).toEqual(["openFile", "openDirectory", "multiSelections"]);
  });
});

describe("applyWebGpuSwitches", () => {
  it("appends the WebGPU switch everywhere", () => {
    resetElectronMock();

    expect(applyWebGpuSwitches(undefined, "darwin")).toEqual([WEBGPU_SWITCH]);
    expect(electronMock.switches).toEqual([WEBGPU_SWITCH]);
  });

  it("adds the Vulkan feature only on Linux", () => {
    resetElectronMock();
    const applied = applyWebGpuSwitches(undefined, "linux");

    expect(applied).toEqual([WEBGPU_SWITCH, `${LINUX_FEATURES_SWITCH.name}=${LINUX_FEATURES_SWITCH.value}`]);
    expect(electronMock.switches).toEqual([WEBGPU_SWITCH, "enable-features=Vulkan"]);
  });

  it("records into whatever command line it is given, so a test needs no Electron", () => {
    const recorded: string[] = [];

    applyWebGpuSwitches(
      {
        appendSwitch: (name: string, value?: string): void => {
          recorded.push(value === undefined ? name : `${name}=${value}`);
        },
      },
      "win32",
    );

    expect(recorded).toEqual([WEBGPU_SWITCH]);
  });
});

describe("forwardWindowEvents", () => {
  it("sends every forwarded event to the renderer under its contract name", () => {
    const target = new FakeBrowserWindow();
    forwardWindowEvents(target as unknown as BrowserWindow);

    for (const event of FORWARDED_WINDOW_EVENTS) {
      target.emit(event);
    }

    expect(target.sent.map((entry) => entry.payload)).toEqual([...FORWARDED_WINDOW_EVENTS]);
    expect(new Set(target.sent.map((entry) => entry.channel))).toEqual(new Set([HOST_WINDOW_EVENT_CHANNEL]));
  });

  it("says nothing once the window is gone, rather than throwing during teardown", () => {
    const target = new FakeBrowserWindow();
    forwardWindowEvents(target as unknown as BrowserWindow);
    target.destroyed = true;

    target.emit("minimize");

    expect(target.sent).toEqual([]);
  });
});
