// Must come first: it registers the `electron` module mock every import below depends on.
// eslint-disable-next-line import-x/order -- must be evaluated first; it registers the `electron` module mock.
import { electronMock, FakeBrowserWindow, FakeSession, resetElectronMock } from "./support/electron-mock.js";
import { beforeEach, describe, expect, it } from "vitest";
import { IGNIFX_SCHEME } from "../src/host-contract.js";
import { cspFor, defaultCsp } from "../src/main/csp.js";
import { IGNIFX_SCHEME_PRIVILEGES, registerIgnifxScheme, serveIgnifxProtocol } from "../src/main/protocol.js";
import {
  ALLOWED_PERMISSIONS,
  createGameWindow,
  installCspHeader,
  lockNavigation,
  restrictPermissions,
} from "../src/main/window.js";
import type { Session, WebContents } from "electron";

/**
 * `createGameWindow` and the three hardening helpers it installs
 * (`docs/architecture/14-platform-electron.md` §3, `CONSTITUTION.md` §9.2).
 *
 * These exercise the *wiring* — which handler is registered on which object, and what it answers —
 * against the recording mock. That the wiring has the effect it claims in a real browser is
 * asserted in `tests/visual/tests/desktop.spec.ts`; what a mock can prove is that the code path
 * runs at all, which is what stops a hardening step being quietly deleted.
 */

beforeEach(() => {
  resetElectronMock();
});

describe("createGameWindow", () => {
  it("builds a window with the enforced preferences and loads the packaged entry", () => {
    const window = createGameWindow({
      entry: "index.html",
      preload: "/app/preload/index.cjs",
    }) as unknown as FakeBrowserWindow;

    const options = window.options as { webPreferences?: Record<string, unknown> };
    expect(options.webPreferences?.["sandbox"]).toBe(true);
    expect(options.webPreferences?.["contextIsolation"]).toBe(true);
    expect(window.loaded).toEqual(["ignifx://app/index.html"]);
  });

  it("loads a dev-server URL as given, so electron-vite dev works", () => {
    const window = createGameWindow({
      entry: "http://localhost:5173/",
      preload: "/app/preload/index.cjs",
    }) as unknown as FakeBrowserWindow;

    expect(window.loaded).toEqual(["http://localhost:5173/"]);
  });

  it("shows the window on ready-to-show rather than up front", () => {
    const window = createGameWindow({ entry: "index.html", preload: "/p.cjs" }) as unknown as FakeBrowserWindow;

    expect(window.shown).toBe(false);
    window.emit("ready-to-show");
    expect(window.shown).toBe(true);
  });

  it("injects the packaged CSP for a packaged entry", () => {
    const window = createGameWindow({ entry: "index.html", preload: "/p.cjs" }) as unknown as FakeBrowserWindow;

    expect(window.session.filterHeaders({})["Content-Security-Policy"]).toEqual([defaultCsp()]);
  });

  it("injects none when the caller asked for none", () => {
    const window = createGameWindow({
      entry: "index.html",
      preload: "/p.cjs",
      csp: null,
    }) as unknown as FakeBrowserWindow;

    expect(window.session.headersListener).toBeNull();
  });

  it("forwards the window's lifecycle events to the renderer", () => {
    const window = createGameWindow({ entry: "index.html", preload: "/p.cjs" }) as unknown as FakeBrowserWindow;

    window.emit("minimize");
    window.emit("focus");

    expect(window.sent.map((entry) => entry.payload)).toEqual(["minimize", "focus"]);
  });

  it("refuses every navigation off its own origin, and every new window", () => {
    const window = createGameWindow({ entry: "index.html", preload: "/p.cjs" }) as unknown as FakeBrowserWindow;

    expect(window.windowOpenHandler?.()).toEqual({ action: "deny" });
    expect(window.wouldAllowNavigation("ignifx://app/other.html")).toBe(true);
    expect(window.wouldAllowNavigation("https://evil.example")).toBe(false);
    expect(window.wouldAllowNavigation("not a url")).toBe(false);
  });
});

describe("installCspHeader", () => {
  it("replaces an existing policy rather than adding a second one", () => {
    const session = new FakeSession();
    installCspHeader(session as unknown as Session, cspFor());

    const produced = session.filterHeaders({
      "content-security-policy": ["default-src *"],
      "Content-Type": ["text/html"],
    });

    expect(produced["Content-Security-Policy"]).toEqual([cspFor()]);
    // Two policies would intersect, making the effective one something no file states.
    expect(Object.keys(produced).filter((name) => name.toLowerCase() === "content-security-policy").length).toBe(1);
    // Every other header survives.
    expect(produced["Content-Type"]).toEqual(["text/html"]);
  });

  it("copes with a response that carried no headers at all", () => {
    const session = new FakeSession();
    installCspHeader(session as unknown as Session, "default-src 'none'");

    expect(session.filterHeaders({})["Content-Security-Policy"]).toEqual(["default-src 'none'"]);
  });
});

describe("restrictPermissions", () => {
  it("grants pointer lock and full screen, and nothing else", () => {
    const session = new FakeSession();
    restrictPermissions(session as unknown as Session);

    for (const permission of ALLOWED_PERMISSIONS) {
      expect(session.askPermission(permission)).toBe(true);
      expect(session.permissionCheckHandler?.(null, permission)).toBe(true);
    }
    for (const permission of ["media", "geolocation", "notifications", "usb", "hid", "serial", "midiSysex"]) {
      expect(session.askPermission(permission)).toBe(false);
      expect(session.permissionCheckHandler?.(null, permission)).toBe(false);
    }
  });

  it("takes an explicit list when a game genuinely needs one more", () => {
    const session = new FakeSession();
    restrictPermissions(session as unknown as Session, ["fullscreen"]);

    expect(session.askPermission("fullscreen")).toBe(true);
    expect(session.askPermission("pointerLock")).toBe(false);
  });
});

describe("lockNavigation", () => {
  it("blocks a navigation whose URL does not parse", () => {
    const window = new FakeBrowserWindow();
    lockNavigation(window.webContents as unknown as WebContents, "ignifx://app");

    expect(window.wouldAllowNavigation("")).toBe(false);
  });
});

describe("the ignifx:// protocol registration", () => {
  it("registers the scheme with the four privileges §3 names", () => {
    registerIgnifxScheme();

    const call = electronMock.calls.find((entry) => entry.member === "protocol.registerSchemesAsPrivileged");
    expect(call?.args[0]).toEqual([{ scheme: IGNIFX_SCHEME, privileges: { ...IGNIFX_SCHEME_PRIVILEGES } }]);
    expect(IGNIFX_SCHEME_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    });
  });

  it("installs a handler and hands back the way to remove it", () => {
    const stop = serveIgnifxProtocol("/srv/dist");

    expect(electronMock.calls.some((entry) => entry.member === "protocol.handle")).toBe(true);
    stop();
    expect(electronMock.calls.some((entry) => entry.member === "protocol.unhandle")).toBe(true);
  });
});
