// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` and `window.__ignifxProbe` are the
// templates' test hooks, and the double underscore is what says they are not part of a game's API.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "playwright/test";
import type { ElectronApplication, Page } from "playwright/test";

/**
 * The Electron desktop suite (`docs/architecture/14-platform-electron.md` §3,
 * `docs/plan/engineering-plan.md` Phase 9 exit criteria).
 *
 * It launches the **real** packaged main process of `templates/3d-third-person` — the same
 * `out/main/index.js` `pnpm build:desktop` produces — through Playwright's `_electron` fixture, and
 * asserts the four things a unit test cannot:
 *
 * 1. WebGPU is on, and the game renders a frame.
 * 2. `CONSTITUTION.md` §9.2's window options are what the *running* window actually has.
 * 3. The `ignifx://` protocol is a secure origin serving the same manifest the browser build gets.
 * 4. A forced device loss recovers with physics, coroutines, and audio intact.
 *
 * ## Why it is not in `playwright.config.ts`'s project list
 *
 * The golden suite's config previews six Vite builds over HTTP and pins `channel: "chromium"` with
 * a SwiftShader adapter. None of that applies here: this launches an Electron binary with its own
 * Chromium and the machine's real GPU. The suite is run on its own — `pnpm test:desktop` — and is
 * skipped anywhere the desktop build has not been made.
 *
 * ## What it needs first
 *
 * `pnpm --filter ignifx-template-3d-third-person run build:desktop`. Every test is skipped with a
 * clear message when `out/main/index.js` is absent, so a checkout that has not built the desktop
 * variant reports "not built" rather than a launch failure.
 *
 * ## Where it runs
 *
 * Verified on macOS arm64 (Electron 44.2.0, Apple/metal-3 adapter). Linux CI runners need a display
 * (`xvfb-run`) and `enable-features=Vulkan`, which `applyWebGpuSwitches` appends; the Windows path
 * is configuration only. `.github/workflows/ci.yml`'s `desktop-build` job builds on all three and
 * runs this suite on macOS only.
 */

/** The template this suite drives. */
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates", "3d-third-person");

/** The built main process; its absence is what "not built" means. */
const MAIN_ENTRY = join(TEMPLATE, "out", "main", "index.js");

/**
 * The Electron binary to launch.
 *
 * @remarks
 * Playwright's `_electron.launch` resolves the `electron` package from the working directory, and
 * `tests/visual` does not depend on it — the desktop tooling belongs to the templates, which is
 * where `pnpm` installed it. Rather than add a dependency to this package for a binary it does not
 * otherwise use, the path is read out of the template's own install: `electron/path.txt` holds the
 * binary's path relative to `electron/dist`, which is the documented way to find it.
 *
 * @returns The absolute path, or `null` when the template has no Electron installed.
 */
function resolveElectronBinary(): string | null {
  const installed = join(TEMPLATE, "node_modules", "electron");
  const pointer = join(installed, "path.txt");
  if (!existsSync(pointer)) {
    return null;
  }
  const binary = join(installed, "dist", readFileSync(pointer, "utf8").trim());
  return existsSync(binary) ? binary : null;
}

/**
 * The test hooks the template installs, declared here because this project compiles the specs on
 * their own and never sees `templates/3d-third-person/src/**`. The shapes are the template's:
 * `src/main.ts` for `__ignifxReady`, `src/desktop-probe.ts` for `__ignifxProbe`, and
 * `@ignifx/electron`'s `IgnifxHost` for the bridge — reduced here to the members this suite reads.
 */
declare global {
  interface Window {
    /**
     * Resolves once the game has presented a settled frame, or reported it cannot run. Declared
     * exactly as `tests/scenes.spec.ts` and `tests/templates.spec.ts` declare it: an interface
     * merged from three files has to agree on the modifiers as well as the type.
     */
    __ignifxReady: Promise<"ready" | "unsupported">;
    /** The `?probe=1` hook; see `templates/3d-third-person/src/desktop-probe.ts`. */
    readonly __ignifxProbe?: {
      forceDeviceLoss(): string;
      snapshot(): ProbeSnapshot;
      roundTripStorage(): Promise<string | null>;
    };
    /** The preload bridge, as much of it as this suite calls. */
    readonly ignifxHost?: {
      readonly version: string;
      readonly shell: { openExternal(url: string): Promise<void> };
    };
  }
}

/** What `window.__ignifxProbe.snapshot()` returns. Duplicated from the template's own type. */
interface ProbeSnapshot {
  readonly crateY: number;
  readonly coroutineTicks: number;
  readonly audioState: string;
  readonly drawCalls: number;
  readonly deviceLost: number;
  readonly deviceRecovered: number;
  readonly deviceRecoveryFailed: number;
  readonly platformKind: string;
  readonly isElectron: boolean;
}

/** The window preferences the runtime check reads back. */
interface RuntimePreferences {
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  readonly webSecurity: boolean;
  readonly webviewTag: boolean;
  readonly experimentalFeatures: boolean;
  readonly allowRunningInsecureContent: boolean;
  readonly enableWebSQL: boolean;
  readonly url: string;
  readonly title: string;
}

let app: ElectronApplication | null = null;
let page: Page | null = null;

/**
 * The window the current test drives.
 *
 * @returns The page `beforeEach` opened.
 * @throws When called outside a test, which cannot happen.
 */
function currentPage(): Page {
  if (page === null) {
    throw new Error("no window: beforeEach did not run");
  }
  return page;
}

/**
 * The Electron application the current test drives.
 *
 * @returns The application `beforeEach` launched.
 * @throws When called outside a test, which cannot happen.
 */
function currentApp(): ElectronApplication {
  if (app === null) {
    throw new Error("no application: beforeEach did not run");
  }
  return app;
}

test.beforeAll(() => {
  test.skip(
    !existsSync(MAIN_ENTRY),
    `The desktop build is missing (${MAIN_ENTRY}). Run: pnpm --filter ignifx-template-3d-third-person run build:desktop`,
  );
  test.skip(resolveElectronBinary() === null, "The template has no Electron installed. Run: pnpm install");
});

test.beforeEach(async () => {
  const executablePath = resolveElectronBinary();
  if (executablePath === null) {
    throw new Error("no Electron binary");
  }
  app = await electron.launch({
    executablePath,
    args: [TEMPLATE],
    timeout: 60_000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  page = null;
});

/**
 * Reads one probe snapshot.
 *
 * @param target - The page to read from.
 * @returns The reading.
 */
async function readSnapshot(target: Page): Promise<ProbeSnapshot> {
  const snapshot = await target.evaluate(() => window.__ignifxProbe?.snapshot() ?? null);
  if (snapshot === null) {
    throw new Error("the probe hook is not installed: open the page with ?probe=1");
  }
  return snapshot;
}

/**
 * Reloads the window with the probe hook installed.
 *
 * @param target - The page to navigate.
 * @returns A promise that settles once the game reports ready.
 */
async function openWithProbe(target: Page): Promise<void> {
  await target.goto("ignifx://app/index.html?probe=1");
  // The hook is a property the module script assigns, so at runtime it really can be missing even
  // though the merged `Window` type declares it as always present — the specs share one declaration
  // and the other two open pages where it is already set. `in` asks the question the type cannot.
  await target.waitForFunction(() => "__ignifxReady" in window, undefined, { timeout: 30_000 });
  const status = await target.evaluate(async () => window.__ignifxReady);
  expect(status, "the game reported it could not run").toBe("ready");
}

test("opens a window on the ignifx:// origin, in a secure context", async () => {
  const target = currentPage();

  const location = await target.evaluate(() => ({
    origin: window.location.origin,
    href: window.location.href,
    isSecureContext: window.isSecureContext,
  }));

  expect(location.origin).toBe("ignifx://app");
  expect(location.href).toBe("ignifx://app/index.html");
  // Without a secure context there is no `navigator.gpu` at all, which is the whole reason the
  // scheme is registered `secure: true` rather than served over `file://`.
  expect(location.isSecureContext).toBe(true);
});

test("has WebGPU, an adapter, and a rendered frame", async () => {
  const target = currentPage();
  await openWithProbe(target);

  const gpu = await target.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      hasGpu: "gpu" in navigator,
      hasAdapter: adapter !== null,
      features: adapter === null ? 0 : adapter.features.size,
    };
  });

  expect(gpu.hasGpu).toBe(true);
  expect(gpu.hasAdapter).toBe(true);
  expect(gpu.features).toBeGreaterThan(0);

  const snapshot = await readSnapshot(target);
  // A rendered frame, not merely a running loop: the scene draws something.
  expect(snapshot.drawCalls).toBeGreaterThan(0);

  await target.screenshot({ path: join(TEMPLATE, "out", "desktop-frame.png") });
});

test("observes CONSTITUTION.md §9.2's window options at runtime", async () => {
  const running = currentApp();

  const preferences = await running.evaluate(({ BrowserWindow }): RuntimePreferences => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) {
      throw new Error("no window");
    }
    // `webContents.getWebPreferences()` does not exist in Electron 44 — it is absent from
    // `electron.d.ts` and `undefined` at runtime. `getLastWebPreferences()` does exist at runtime
    // and returns the resolved values, but it is likewise absent from the type definitions, so it
    // is reached through an index and narrowed by hand.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
    const contents = window.webContents as unknown as Record<string, unknown>;
    const read = contents["getLastWebPreferences"];
    if (typeof read !== "function") {
      throw new Error("getLastWebPreferences is unavailable on this Electron");
    }
    const resolved: unknown = read.call(window.webContents);
    const fields: Record<string, unknown> = {};
    if (typeof resolved === "object" && resolved !== null) {
      for (const [key, value] of Object.entries(resolved)) {
        fields[key] = value;
      }
    }
    const flag = (name: string): boolean => fields[name] === true;
    return {
      sandbox: flag("sandbox"),
      contextIsolation: flag("contextIsolation"),
      nodeIntegration: flag("nodeIntegration"),
      webSecurity: flag("webSecurity"),
      webviewTag: flag("webviewTag"),
      experimentalFeatures: flag("experimentalFeatures"),
      allowRunningInsecureContent: flag("allowRunningInsecureContent"),
      enableWebSQL: flag("enableWebSQL"),
      url: window.webContents.getURL(),
      title: window.getTitle(),
    };
  });

  expect(preferences.sandbox).toBe(true);
  expect(preferences.contextIsolation).toBe(true);
  expect(preferences.nodeIntegration).toBe(false);
  expect(preferences.webSecurity).toBe(true);
  // The rest of `ENFORCED_WEB_PREFERENCES`, read back off the running window rather than off the
  // pure builder, so the two are pinned to each other (docs/security/electron-review-2026-09.md).
  expect(preferences.webviewTag).toBe(false);
  expect(preferences.experimentalFeatures).toBe(false);
  expect(preferences.allowRunningInsecureContent).toBe(false);
  expect(preferences.enableWebSQL).toBe(false);
});

test("serves one ignifx:// authority and refuses every other one", async () => {
  const running = currentApp();

  // From the **main** process, because the renderer's own `connect-src 'self'` would refuse the
  // request before the protocol handler ever saw it — and it is the handler that is under test.
  const statuses = await running.evaluate(async ({ net }) => ({
    app: (await net.fetch("ignifx://app/index.html")).status,
    other: (await net.fetch("ignifx://evil/index.html")).status,
    escaping: (await net.fetch("ignifx://app/..%2f..%2f..%2fetc/passwd")).status,
  }));

  expect(statuses.app).toBe(200);
  // A second authority is a second Chromium origin serving the same files, which would make
  // `'self'` in the policy mean something other than the game.
  expect(statuses.other).toBe(403);
  expect(statuses.escaping).toBe(403);
});

test("gives the renderer the bridge and nothing else", async () => {
  const target = currentPage();

  const world = await target.evaluate(() => ({
    hasHost: window.ignifxHost !== undefined,
    hostVersion: window.ignifxHost?.version ?? null,
    // Context isolation and `nodeIntegration: false` in one assertion: neither of these exists in
    // the page's world.
    hasRequire: "require" in window,
    hasProcess: "process" in window,
    hasModule: "module" in window,
    hasGlobal: "global" in window,
    // `contextBridge` copies functions as proxies; the renderer never gets an `ipcRenderer`.
    hostKeys: Object.keys(window.ignifxHost ?? {}).toSorted(),
  }));

  expect(world.hasHost).toBe(true);
  expect(world.hostVersion).toBe("1.0.0");
  expect(world.hasRequire).toBe(false);
  expect(world.hasProcess).toBe(false);
  expect(world.hasModule).toBe(false);
  expect(world.hasGlobal).toBe(false);
  expect(world.hostKeys).toEqual(["dialogs", "paths", "shell", "storage", "version", "versions", "window"]);
});

test("serves a strict CSP that forbids inline script and framing", async () => {
  const target = currentPage();

  const policy = await target.evaluate(async () => {
    const response = await fetch("ignifx://app/index.html");
    return response.headers.get("content-security-policy");
  });

  expect(policy).not.toBeNull();
  const csp = policy ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  // WebAssembly needs the narrow token, and `@ignifx/physics` is in this template.
  expect(csp).toContain("'wasm-unsafe-eval'");

  // An inline script must not run under it.
  const inlineRan = await target.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__cspEscaped = true;";
    document.head.append(script);
    return "__cspEscaped" in window;
  });
  expect(inlineRan, "an inline script executed under the CSP").toBe(false);
});

test("serves the manifest and the hashed assets over the protocol", async () => {
  const target = currentPage();

  const served = await target.evaluate(async () => {
    const manifest = await fetch("ignifx://app/assets.manifest.json");
    const parsed: unknown = await manifest.json();
    const body: { format?: string; entries?: { address?: string; url?: string }[] } =
      typeof parsed === "object" && parsed !== null ? parsed : {};
    const first = body.entries?.[0];
    // Every asset URL in the manifest is relative, because a packaged renderer is loaded from
    // `ignifx://app/index.html` rather than from a server root.
    const asset = first?.url === undefined ? null : await fetch(new URL(first.url, window.location.href));
    const missing = await fetch("ignifx://app/nothing-here.png");
    return {
      status: manifest.status,
      type: manifest.headers.get("content-type"),
      acceptRanges: manifest.headers.get("accept-ranges"),
      format: body.format ?? null,
      entryCount: body.entries?.length ?? 0,
      firstAddress: first?.address ?? null,
      firstUrl: first?.url ?? null,
      assetStatus: asset?.status ?? 0,
      assetType: asset?.headers.get("content-type") ?? null,
      missingStatus: missing.status,
    };
  });

  expect(served.status).toBe(200);
  expect(served.type).toBe("application/json; charset=utf-8");
  expect(served.acceptRanges).toBe("bytes");
  // The same document `@ignifx/vite-plugin` writes for the browser build, served unchanged.
  expect(served.format).toBe("ignifx.manifest");
  expect(served.entryCount).toBeGreaterThan(0);
  expect(served.firstUrl).toMatch(/^\.\/assets\//u);
  // And the hashed asset it points at really is there, with a real type rather than a fallback.
  expect(served.assetStatus).toBe(200);
  expect(served.assetType).not.toBe("application/octet-stream");
  expect(served.missingStatus).toBe(404);
});

test("honours a Range request, which net.fetch of a file:// URL does not", async () => {
  const target = currentPage();

  const ranged = await target.evaluate(async () => {
    const full = await fetch("ignifx://app/assets.manifest.json");
    const size = (await full.arrayBuffer()).byteLength;
    const slice = await fetch("ignifx://app/assets.manifest.json", { headers: { Range: "bytes=0-9" } });
    return {
      size,
      status: slice.status,
      length: (await slice.arrayBuffer()).byteLength,
      contentRange: slice.headers.get("content-range"),
    };
  });

  expect(ranged.status).toBe(206);
  expect(ranged.length).toBe(10);
  expect(ranged.contentRange).toBe(`bytes 0-9/${String(ranged.size)}`);
});

test("reports app.platform.kind as electron and app.desktop.isElectron", async () => {
  const target = currentPage();
  await openWithProbe(target);

  const snapshot = await readSnapshot(target);

  expect(snapshot.platformKind).toBe("electron");
  expect(snapshot.isElectron).toBe(true);
});

test("writes app.storage through the bridge to the file system", async () => {
  const target = currentPage();
  await openWithProbe(target);

  const roundTripped = await target.evaluate(async () => window.__ignifxProbe?.roundTripStorage() ?? null);

  expect(roundTripped).toBe("yes");
});

test("recovers from a forced device loss with physics, coroutines and audio intact", async () => {
  const target = currentPage();
  await openWithProbe(target);

  // Let the scene run so the crates have settled and the coroutine has a count worth comparing.
  await target.waitForTimeout(1000);
  const before = await readSnapshot(target);
  expect(before.coroutineTicks).toBeGreaterThan(0);
  expect(before.deviceLost).toBe(0);

  const forced = await target.evaluate(() => window.__ignifxProbe?.forceDeviceLoss() ?? "no probe");
  expect(forced, "the device loss could not be armed").toBe("forced");

  // Recovery requests a replacement device asynchronously, so the wait is on the event rather than
  // on a frame count.
  await target.waitForFunction(() => (window.__ignifxProbe?.snapshot().deviceRecovered ?? 0) > 0, undefined, {
    timeout: 60_000,
  });

  // And then let it run again, so "recovered" means "kept running", not "fired an event".
  await target.waitForTimeout(1000);
  const after = await readSnapshot(target);

  expect(after.deviceLost).toBe(1);
  expect(after.deviceRecovered).toBe(1);
  expect(after.deviceRecoveryFailed).toBe(0);

  // Coroutines: still resuming, which means the frame loop survived.
  expect(after.coroutineTicks).toBeGreaterThan(before.coroutineTicks);
  // Physics: the crate is still where the simulation put it, not at the origin or NaN.
  expect(Number.isFinite(after.crateY)).toBe(true);
  expect(Math.abs(after.crateY - before.crateY)).toBeLessThan(0.5);
  // Audio: the context was never touched by the GPU device, and must still say so.
  expect(after.audioState).toBe(before.audioState);
  expect(["running", "suspended", "locked", "interrupted"]).toContain(after.audioState);
  // Rendering: drawing again.
  expect(after.drawCalls).toBeGreaterThan(0);

  await target.screenshot({ path: join(TEMPLATE, "out", "desktop-after-device-loss.png") });
});

test("refuses to open a URL whose protocol is not on the allow-list", async () => {
  const target = currentPage();

  const refused = await target.evaluate(async () => {
    try {
      await window.ignifxHost?.shell.openExternal("file:///etc/passwd");
      return "opened";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  expect(refused).not.toBe("opened");
  expect(refused).toContain("IGX-1464");
});
