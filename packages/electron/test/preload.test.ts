// Must come first: it registers the `electron` module mock every import below depends on.
// eslint-disable-next-line import-x/order -- must be evaluated first; it registers the `electron` module mock.
import { electronMock, resetElectronMock } from "./support/electron-mock.js";
import { beforeEach, describe, expect, it } from "vitest";
import { HOST_CHANNELS, HOST_CONTRACT_VERSION, HOST_GLOBAL_NAME } from "../src/host-contract.js";
import { createIgnifxHost, exposeIgnifxHost, readHostVersions } from "../src/preload/bridge.js";
import { REQUIRED_HOST_MEMBERS } from "../src/renderer/host.js";

/**
 * The preload bridge's shape and wiring (`docs/architecture/14-platform-electron.md` §3,
 * `CONSTITUTION.md` §9.2).
 *
 * What is provable here is that the object the renderer receives is the contract, that every method
 * reaches the channel it claims to, and that nothing that would hand a renderer a live `ipcRenderer`
 * crosses. What is *not* provable here is that `contextBridge` really is a boundary — that is a
 * Chromium property, asserted against a real Electron process in
 * `tests/visual/tests/desktop.spec.ts`.
 */

beforeEach(() => {
  resetElectronMock();
});

describe("createIgnifxHost", () => {
  it("announces the contract version", () => {
    expect(createIgnifxHost().version).toBe(HOST_CONTRACT_VERSION);
  });

  it("has every member the renderer requires", () => {
    const host: unknown = createIgnifxHost();

    for (const path of REQUIRED_HOST_MEMBERS) {
      const value = path.split(".").reduce<unknown>((current, step) => {
        return typeof current === "object" && current !== null ? (current as Record<string, unknown>)[step] : undefined;
      }, host);
      expect(typeof value).toBe("function");
    }
  });

  it("exposes no ipcRenderer, no channel names, and nothing else with a prototype into Node", () => {
    const host = createIgnifxHost();
    const keys = Object.keys(host).toSorted();

    expect(keys).toEqual(["dialogs", "paths", "shell", "storage", "version", "versions", "window"]);
    for (const key of keys) {
      const value: unknown = (host as unknown as Record<string, unknown>)[key];
      // Everything is a function, a plain object of functions, or a plain value. Nothing else.
      expect(["function", "object", "string"]).toContain(typeof value);
    }
    expect("ipcRenderer" in host).toBe(false);
    expect("invoke" in host).toBe(false);
  });

  it("invokes the channel each member claims", async () => {
    const host = createIgnifxHost();

    await host.storage.get("saves", "slot1");
    await host.storage.set("saves", "slot1", { kind: "json", json: "1" });
    await host.storage.delete("saves", "slot1");
    await host.storage.keys("saves", "s");
    await host.storage.clear("saves");
    await host.paths();
    await host.window.setFullscreen(true);
    await host.window.isFullscreen();
    await host.window.setTitle("t");
    await host.window.quit();
    await host.dialogs.showOpenDialog();
    await host.shell.openExternal("https://ignifx.com");

    const channels = electronMock.calls
      .filter((entry) => entry.member === "ipcRenderer.invoke")
      .map((entry) => entry.args[0]);

    expect(channels).toEqual([
      HOST_CHANNELS.storageGet,
      HOST_CHANNELS.storageSet,
      HOST_CHANNELS.storageDelete,
      HOST_CHANNELS.storageKeys,
      HOST_CHANNELS.storageClear,
      HOST_CHANNELS.paths,
      HOST_CHANNELS.windowSetFullscreen,
      HOST_CHANNELS.windowIsFullscreen,
      HOST_CHANNELS.windowSetTitle,
      HOST_CHANNELS.windowQuit,
      HOST_CHANNELS.dialogsShowOpen,
      HOST_CHANNELS.shellOpenExternal,
    ]);
  });

  it("passes the arguments through unchanged", async () => {
    const host = createIgnifxHost();
    await host.storage.set("saves", "slot1", { kind: "json", json: '{"level":3}' });

    const call = electronMock.calls.find((entry) => entry.args[0] === HOST_CHANNELS.storageSet);
    expect(call?.args.slice(1)).toEqual(["saves", "slot1", { kind: "json", json: '{"level":3}' }]);
  });

  it("subscribes to the one main-to-renderer channel and hands back an unsubscribe", () => {
    const host = createIgnifxHost();
    const stop = host.window.onEvent(() => {
      // no assertion on delivery here; the mock does not dispatch
    });

    expect(electronMock.calls.some((entry) => entry.member === "ipcRenderer.on")).toBe(true);
    stop();
    expect(electronMock.calls.some((entry) => entry.member === "ipcRenderer.removeListener")).toBe(true);
  });
});

describe("readHostVersions", () => {
  it("reports empty strings where there is no process shim, rather than throwing", () => {
    // Under vitest's Node environment `process.versions` exists but has no `electron` key, which is
    // exactly the "read it defensively" case.
    const versions = readHostVersions();

    expect(typeof versions.electron).toBe("string");
    expect(typeof versions.chrome).toBe("string");
    expect(typeof versions.node).toBe("string");
    expect(versions.electron).toBe("");
  });
});

describe("exposeIgnifxHost", () => {
  it("exposes the host under the contract's global name", () => {
    exposeIgnifxHost();

    const call = electronMock.calls.find((entry) => entry.member === "contextBridge.exposeInMainWorld");
    expect(call?.args[0]).toBe(HOST_GLOBAL_NAME);
    expect(typeof call?.args[1]).toBe("object");
  });
});
