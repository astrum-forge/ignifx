import { join } from "node:path";
import {
  applyWebGpuSwitches,
  createGameWindow,
  installHostHandlers,
  registerIgnifxScheme,
  serveIgnifxProtocol,
} from "@ignifx/electron/main";
import { app, BrowserWindow } from "electron";

/**
 * The Electron **main** process for this template.
 *
 * This file is an application entry point, which is the one place `CONSTITUTION.md` §3.5's
 * no-import-time-side-effects rule does not reach: Electron loads it and expects the process to
 * have been configured by the time `whenReady` resolves. Everything it calls lives in
 * `@ignifx/electron/main`, which is a library and has no side effects of its own.
 *
 * ## The order is Chromium's, not ours
 *
 * 1. `applyWebGpuSwitches()` appends `enable-unsafe-webgpu` (and `enable-features=Vulkan` on
 *    Linux). A switch appended after `whenReady` is inert, and the symptom is
 *    `navigator.gpu === undefined` with no error anywhere.
 * 2. `registerIgnifxScheme()` declares `ignifx://` standard, secure, fetchable, and streamable.
 *    Those privileges are read while Chromium builds its network stack, so this is also a
 *    before-`whenReady` call.
 * 3. After `whenReady`: serve the built renderer over `ignifx://`, open the window, and install the
 *    IPC handlers the preload bridge invokes.
 */

/** Where `electron-vite dev` publishes the renderer; `undefined` in a packaged build. */
const DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"];

/** The built renderer, beside this file's own output directory in a packaged build. */
const RENDERER_DIRECTORY = join(import.meta.dirname, "../renderer");

/** The preload script. It is CommonJS because `sandbox: true` refuses an ES module. */
const PRELOAD = join(import.meta.dirname, "../preload/index.cjs");

/** Removes the IPC handlers, so re-creating the window does not register them twice. */
let removeHandlers: (() => void) | null = null;

applyWebGpuSwitches();
registerIgnifxScheme();

/**
 * Opens the game window and wires the bridge to it.
 */
function openGameWindow(): void {
  removeHandlers?.();
  const window = createGameWindow({
    entry: DEV_SERVER_URL ?? "index.html",
    preload: PRELOAD,
    width: 1600,
    height: 900,
    title: "ignifx — first person",
  });
  removeHandlers = installHostHandlers({ window });
}

app.whenReady().then(
  (): void => {
    // Only a packaged build serves over the protocol; in dev the renderer lives on the dev server
    // and Vite owns the module graph.
    if (DEV_SERVER_URL === undefined) {
      serveIgnifxProtocol(RENDERER_DIRECTORY);
    }
    openGameWindow();

    // macOS keeps an application running with no windows; clicking the dock icon reopens one.
    app.on("activate", (): void => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openGameWindow();
      }
    });
  },
  (error: unknown): void => {
    // There is no logger yet at this point, and a main process that cannot start has to say so.
    process.stderr.write(`ignifx: the desktop app failed to start: ${String(error)}\n`);
    app.exit(1);
  },
);

// Windows and Linux quit with the last window; macOS does not, by platform convention.
app.on("window-all-closed", (): void => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (): void => {
  removeHandlers?.();
  removeHandlers = null;
});
