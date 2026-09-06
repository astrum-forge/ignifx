import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPlatform, platformInternals, readPlatformHost } from "../../src/platform/platform.js";
import type { PlatformHost, PlatformOs } from "../../src/platform/platform.js";

/**
 * `app.platform` (`docs/architecture/14-platform-electron.md` §1). Detection is split into a host
 * scrape and a pure interpretation, so every operating system and every mobile heuristic is tested
 * here under Node with a fabricated host; `platform.browser.test.ts` checks that the scrape itself
 * reads a real browser correctly.
 */

/** A host with nothing on it: what a bare JavaScript runtime looks like. */
function bareHost(overrides?: Partial<PlatformHost>): PlatformHost {
  return {
    hasDocument: false,
    userAgent: null,
    navigatorPlatform: null,
    userAgentDataPlatform: null,
    userAgentDataMobile: null,
    maxTouchPoints: 0,
    hasPointerLock: false,
    hasGamepads: false,
    locale: "en-AU",
    reducedMotion: false,
    processPlatform: null,
    ...overrides,
  };
}

/** A host that looks like a browser. */
function browserHost(overrides?: Partial<PlatformHost>): PlatformHost {
  return bareHost({
    hasDocument: true,
    hasPointerLock: true,
    hasGamepads: true,
    ...overrides,
  });
}

describe("the host scrape", () => {
  it("reports Node as a bare runtime with no document", () => {
    const host = readPlatformHost();
    expect(host.hasDocument).toBe(false);
    expect(host.hasPointerLock).toBe(false);
    expect(host.processPlatform).toBe(process.platform);
    expect(host.reducedMotion).toBe(false);
  });

  it("reads a locale from the host", () => {
    expect(readPlatformHost().locale).toMatch(/^[a-z]{2}/u);
  });
});

/** Puts a browser's globals on `globalThis`, as far as Node lets a test. */
function stubBrowser(navigatorOverrides?: Readonly<Record<string, unknown>>): void {
  vi.stubGlobal("document", { pointerLockElement: null });
  vi.stubGlobal("window", {});
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("navigator", {
    language: "fr-FR",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    platform: "MacIntel",
    maxTouchPoints: 5,
    getGamepads: (): readonly unknown[] => [],
    userAgentData: { platform: "macOS", mobile: false },
    ...navigatorOverrides,
  });
}

describe("the host scrape in a browser-shaped global", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads every browser global it knows about", () => {
    stubBrowser();
    const host = readPlatformHost();
    expect(host.hasDocument).toBe(true);
    expect(host.hasPointerLock).toBe(true);
    expect(host.hasGamepads).toBe(true);
    expect(host.reducedMotion).toBe(true);
    expect(host.locale).toBe("fr-FR");
    expect(host.userAgent).toContain("Macintosh");
    expect(host.navigatorPlatform).toBe("MacIntel");
    expect(host.userAgentDataPlatform).toBe("macOS");
    expect(host.userAgentDataMobile).toBe(false);
    expect(host.maxTouchPoints).toBe(5);
  });

  it("turns the whole reading into an iPad", () => {
    stubBrowser();
    const platform = detectPlatform(readPlatformHost());
    expect(platform.kind).toBe("browser");
    expect(platform.os).toBe("ios");
    expect(platform.isMobile).toBe(true);
  });

  it("tolerates a browser with no client hints and no touch", () => {
    stubBrowser({ userAgentData: undefined, maxTouchPoints: undefined });
    const host = readPlatformHost();
    expect(host.userAgentDataPlatform).toBeNull();
    expect(host.userAgentDataMobile).toBeNull();
    expect(host.maxTouchPoints).toBe(0);
    expect(detectPlatform(host).os).toBe("macos");
  });

  it("tolerates client hints whose fields are the wrong shape", () => {
    stubBrowser({ userAgentData: { platform: 7, mobile: "yes" }, language: "" });
    const host = readPlatformHost();
    expect(host.userAgentDataPlatform).toBeNull();
    expect(host.userAgentDataMobile).toBeNull();
    // An empty `navigator.language` falls through to Intl rather than being reported as the locale.
    expect(host.locale).not.toBe("");
  });

  it("tolerates a host with no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    const host = readPlatformHost();
    expect(host.userAgent).toBeNull();
    expect(host.navigatorPlatform).toBeNull();
    expect(host.userAgentDataPlatform).toBeNull();
    expect(host.userAgentDataMobile).toBeNull();
    expect(host.maxTouchPoints).toBe(0);
    expect(host.hasGamepads).toBe(false);
    expect(host.locale.length).toBeGreaterThan(0);
  });

  it("tolerates a host whose process is not an object", () => {
    vi.stubGlobal("process", "not an object");
    expect(readPlatformHost().processPlatform).toBeNull();
    vi.stubGlobal("process", { platform: 7 });
    expect(readPlatformHost().processPlatform).toBeNull();
  });
});

describe("detection under Node", () => {
  it("is a node host with no WebGPU", () => {
    const platform = detectPlatform();
    expect(platform.kind).toBe("node");
    expect(platform.webgpu).toBeNull();
    expect(platform.isMobile).toBe(false);
    expect(platform.hasPointerLock).toBe(false);
    expect(platform.hasGamepads).toBe(false);
  });

  it("takes the operating system from process.platform, not from navigator.platform", () => {
    // Node 24's `navigator.platform` answers "MacIntel" on every architecture, which is why the
    // Node branch never consults it.
    const expected: Record<string, PlatformOs> = { darwin: "macos", win32: "windows", linux: "linux" };
    expect(detectPlatform().os).toBe(expected[process.platform] ?? "unknown");
  });

  it("takes the locale from Intl when the host has no navigator language", () => {
    expect(detectPlatform(bareHost({ locale: "fr-CA" })).locale).toBe("fr-CA");
  });

  it("reports unknown for a process.platform nobody has heard of", () => {
    expect(detectPlatform(bareHost({ processPlatform: "haiku" })).os).toBe("unknown");
  });

  it("maps every process.platform the engine claims to support", () => {
    expect(detectPlatform(bareHost({ processPlatform: "darwin" })).os).toBe("macos");
    expect(detectPlatform(bareHost({ processPlatform: "win32" })).os).toBe("windows");
    expect(detectPlatform(bareHost({ processPlatform: "linux" })).os).toBe("linux");
    expect(detectPlatform(bareHost({ processPlatform: "android" })).os).toBe("android");
    expect(detectPlatform(bareHost({ processPlatform: "freebsd" })).os).toBe("linux");
  });
});

describe("detection in a browser", () => {
  it("prefers the client hint over navigator.platform and the user agent", () => {
    const platform = detectPlatform(
      browserHost({
        userAgentDataPlatform: "Windows",
        navigatorPlatform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh)",
      }),
    );
    expect(platform.kind).toBe("browser");
    expect(platform.os).toBe("windows");
  });

  it("falls back to navigator.platform, then to the user agent", () => {
    expect(detectPlatform(browserHost({ navigatorPlatform: "Linux x86_64" })).os).toBe("linux");
    expect(detectPlatform(browserHost({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64)" })).os).toBe("linux");
    expect(detectPlatform(browserHost({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).os).toBe("windows");
  });

  it("reports unknown when the host says nothing at all", () => {
    expect(detectPlatform(browserHost()).os).toBe("unknown");
  });

  it("calls a touch-capable Macintosh an iPad", () => {
    const mac = browserHost({ navigatorPlatform: "MacIntel", maxTouchPoints: 0 });
    const ipad = browserHost({ navigatorPlatform: "MacIntel", maxTouchPoints: 5 });
    expect(detectPlatform(mac).os).toBe("macos");
    expect(detectPlatform(mac).isMobile).toBe(false);
    expect(detectPlatform(ipad).os).toBe("ios");
    expect(detectPlatform(ipad).isMobile).toBe(true);
  });

  it("trusts the mobile client hint, and still calls a tablet mobile", () => {
    expect(detectPlatform(browserHost({ userAgentDataMobile: true, userAgentDataPlatform: "Windows" })).isMobile).toBe(
      true,
    );
    expect(detectPlatform(browserHost({ userAgentDataMobile: false, userAgentDataPlatform: "Android" })).isMobile).toBe(
      true,
    );
    expect(detectPlatform(browserHost({ userAgentDataMobile: false, userAgentDataPlatform: "macOS" })).isMobile).toBe(
      false,
    );
  });

  it("calls iOS and Android mobile without a client hint", () => {
    expect(detectPlatform(browserHost({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0)" })).isMobile).toBe(true);
    expect(detectPlatform(browserHost({ userAgent: "Mozilla/5.0 (Linux; Android 15)" })).os).toBe("android");
    expect(detectPlatform(browserHost({ userAgent: "Mozilla/5.0 (Linux; Android 15)" })).isMobile).toBe(true);
  });

  it("carries the capability flags and the reduced-motion preference through", () => {
    const platform = detectPlatform(browserHost({ reducedMotion: true, locale: "ja-JP" }));
    expect(platform.hasPointerLock).toBe(true);
    expect(platform.hasGamepads).toBe(true);
    expect(platform.reducedMotion).toBe(true);
    expect(platform.locale).toBe("ja-JP");
  });
});

describe("the internals accessor", () => {
  it("lets an extension record that the browser is an Electron renderer", () => {
    const platform = detectPlatform(browserHost());
    expect(platform.kind).toBe("browser");
    platformInternals(platform).setKind("electron");
    expect(platform.kind).toBe("electron");
  });

  it("records a WebGPU report", () => {
    const platform = detectPlatform(browserHost());
    expect(platform.webgpu).toBeNull();
    platformInternals(platform).setWebGpu({
      adapterInfo: { vendor: "apple", architecture: "metal-3", device: "", description: "" },
      features: ["depth-clip-control"],
      limits: { maxBindGroups: 4 },
    });
    expect(platform.webgpu?.adapterInfo.vendor).toBe("apple");
    expect(platform.webgpu?.limits["maxBindGroups"]).toBe(4);
    platformInternals(platform).setWebGpu(null);
    expect(platform.webgpu).toBeNull();
  });

  it("refuses a record it did not create", () => {
    expect(() =>
      platformInternals({
        kind: "node",
        os: "linux",
        isMobile: false,
        hasPointerLock: false,
        hasGamepads: false,
        webgpu: null,
        locale: "en",
        reducedMotion: false,
      }),
    ).toThrow(/IGX-0702/u);
  });
});
