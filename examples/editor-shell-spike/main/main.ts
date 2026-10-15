// THROWAWAY spike S0.1 — not for merge. Electron main for the editor shell spike.
//
// Environment knobs (all optional):
//   SPIKE_TEMPLATE   project directory to run `vite` in (default: ../../templates/3d-third-person)
//   SPIKE_PORT       dev-server port (default 5199)
//   SPIKE_SPAWN=0    do not spawn the dev server; assume one is already listening
//   SPIKE_CSP        none | engine | session-wide | scoped (default) — see installCsp below
//   SPIKE_FRAME_SRC  value of frame-src in the scoped/session-wide policy (default: the dev origin)
//   SPIKE_LOCKNAV    engine | frame-aware (default) | off
//   SPIKE_HMR=1      edit a project script three times and time the reload report
//   SPIKE_PLAY=1     also embed the play view (the project's own index.html)
//   SPIKE_OUT        directory for the screenshot and the JSON result
//   SPIKE_HOLD_MS    how long to keep the window open after the run (default 1500)
//   SPIKE_S02        3d | 2d — run spike S0.2's scripted scene-view checks (main/s02.ts) instead of S0.1's
//   SPIKE_QUERY      query string for the scene view, e.g. "mode=2d" or "outline=bbox"
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyWebGpuSwitches,
  cspFor,
  installCspHeader,
  lockNavigation,
  registerIgnifxScheme,
  restrictPermissions,
  serveIgnifxProtocol,
  windowOptionsFor,
} from "@ignifx/electron/main";
import { app, BrowserWindow, ipcMain } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Session, WebContents } from "electron";
import { runS02 } from "./s02.js";

const processStartEpoch = Date.now() - performance.now();
const env = process.env;
const here = import.meta.dirname;
const templateDir = resolve(env["SPIKE_TEMPLATE"] ?? join(here, "../../../../templates/3d-third-person"));
const port = Number(env["SPIKE_PORT"] ?? "5199");
const devOrigin = `http://127.0.0.1:${String(port)}`;
// SPIKE_PLAY_SITE=localhost serves the play view from http://localhost:<port>, a different *site*.
const playOrigin = env["SPIKE_PLAY_SITE"] === "localhost" ? `http://localhost:${String(port)}` : devOrigin;
const cspMode = env["SPIKE_CSP"] ?? "scoped";
const frameSrc = env["SPIKE_FRAME_SRC"] ?? (playOrigin === devOrigin ? devOrigin : `${devOrigin} ${playOrigin}`);
const lockMode = env["SPIKE_LOCKNAV"] ?? "frame-aware";
const outDir = resolve(env["SPIKE_OUT"] ?? join(here, "../../spike-out"));
const holdMs = Number(env["SPIKE_HOLD_MS"] ?? "1500");
const editorOrigin = "ignifx://app";

const result: Record<string, unknown> = {
  cspMode,
  frameSrc,
  lockMode,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  events: [] as unknown[],
};
const events = result["events"] as unknown[];

function log(kind: string, data: Record<string, unknown> = {}): void {
  const line = { kind, mainEpochMs: Date.now(), sinceStartMs: Date.now() - processStartEpoch, ...data };
  events.push(line);
  process.stdout.write(`SPIKE ${JSON.stringify(line)}\n`);
}

mkdirSync(outDir, { recursive: true });
applyWebGpuSwitches();
registerIgnifxScheme();

let devServer: ChildProcess | null = null;
let devServerSpawnEpoch = 0;

function spawnDevServer(): void {
  const viteBin = join(templateDir, "node_modules/vite/bin/vite.js");
  devServerSpawnEpoch = Date.now();
  // Plain `node` from PATH here; running it through the Electron binary is spike S0.4's question.
  devServer = spawn("node", [viteBin, "--port", String(port), "--strictPort"], {
    cwd: templateDir,
    env: { ...env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  devServer.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim() !== "") {
        log("vite", { line: line.trim() });
      }
    }
  });
  devServer.stderr?.on("data", (chunk: Buffer) => {
    log("vite-stderr", { line: chunk.toString().trim() });
  });
  log("devServerSpawned", { templateDir });
}

async function waitForDevServer(): Promise<void> {
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`${devOrigin}/__ignifx_editor__/`);
      if (response.ok) {
        log("devServerReachable", { sinceSpawnMs: Date.now() - devServerSpawnEpoch });
        return;
      }
    } catch {
      // not listening yet
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => setTimeout(done, 25));
  }
}

function policy(): string {
  // The packaged game policy from @ignifx/electron with frame-src opened to the dev server.
  return cspFor().replace("frame-src 'none'", `frame-src ${frameSrc}`);
}

/**
 * none:         no CSP at all (baseline).
 * engine:       @ignifx/electron's installCspHeader(session, cspFor()) exactly as createGameWindow does.
 * session-wide: installCspHeader with the frame-src-widened policy; still rewrites *every* response.
 * scoped:       the widened policy, set only on responses from the editor's own origin.
 */
function installCsp(session: Session): void {
  if (cspMode === "none") {
    return;
  }
  if (cspMode === "engine") {
    installCspHeader(session, cspFor());
    log("csp", { policy: cspFor(), scope: "session" });
    return;
  }
  if (cspMode === "session-wide") {
    installCspHeader(session, policy());
    log("csp", { policy: policy(), scope: "session" });
    return;
  }
  const value = policy();
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(`${editorOrigin}/`)) {
      callback({});
      return;
    }
    const headers: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(details.responseHeaders ?? {})) {
      if (name.toLowerCase() !== "content-security-policy") {
        headers[name] = values;
      }
    }
    headers["Content-Security-Policy"] = [value];
    callback({ responseHeaders: headers });
  });
  log("csp", { policy: value, scope: `${editorOrigin}/* only` });
}

function installNavigationLock(contents: WebContents): void {
  if (lockMode === "off") {
    return;
  }
  if (lockMode === "engine") {
    lockNavigation(contents, editorOrigin);
    return;
  }
  // Frame-aware: the top frame stays on the editor origin; sub-frames may only go to the dev server.
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (details) => {
    if (!details.url.startsWith(`${editorOrigin}/`)) {
      details.preventDefault();
    }
  });
  contents.on("will-frame-navigate", (details) => {
    const allowed = details.isMainFrame ? [editorOrigin] : [devOrigin, playOrigin];
    let origin = "";
    try {
      origin = details.url.startsWith("ignifx://") ? editorOrigin : new URL(details.url).origin;
    } catch {
      origin = "";
    }
    if (!allowed.includes(origin)) {
      log("frameNavigationBlocked", { url: details.url, isMainFrame: details.isMainFrame });
      details.preventDefault();
    }
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

let firstFrameEpoch = 0;
let firstFrameCount = 0;
let lastFirstFrameEpoch = 0;
let window: BrowserWindow | null = null;
const hotReloads: Record<string, unknown>[] = [];
// S0.2: every renderer message, an RPC relay, and the iframe's box in the window.
const inbox: Record<string, unknown>[] = [];
let nextRpcId = 1;
const rpcWaiting = new Map<number, (message: Record<string, unknown>) => void>();
let iframeRect = { left: 0, top: 0, width: 0, height: 0 };

function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const id = nextRpcId;
  nextRpcId += 1;
  return new Promise((resolveRpc) => {
    rpcWaiting.set(id, resolveRpc);
    window?.webContents.send("spike:rpc", { id, method, params });
  });
}

function describeFrames(contents: WebContents): unknown[] {
  return contents.mainFrame.framesInSubtree.map((frame) => {
    try {
      return {
        url: frame.url,
        origin: frame.origin,
        osProcessId: frame.osProcessId,
        processId: frame.processId,
        isMain: frame === contents.mainFrame,
      };
    } catch (error) {
      return { disposed: String(error) };
    }
  });
}

async function screenshot(contents: WebContents): Promise<void> {
  const image = await contents.capturePage();
  const size = image.getSize();
  const png = image.toPNG();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "s0.1-screenshot.png"), png);
  // Pixel stats over the iframe area (below the 24 px bar), BGRA.
  const bitmap = image.toBitmap();
  const scale = image.getScaleFactors?.()[0] ?? 1;
  const top = Math.round(30 * scale);
  const colors = new Set<number>();
  let nonDark = 0;
  let total = 0;
  for (let y = top; y < size.height * scale; y += 4) {
    for (let x = 0; x < size.width * scale; x += 4) {
      const offset = (y * Math.round(size.width * scale) + x) * 4;
      const b = bitmap[offset] ?? 0;
      const g = bitmap[offset + 1] ?? 0;
      const r = bitmap[offset + 2] ?? 0;
      colors.add((r << 16) | (g << 8) | b);
      if (r + g + b > 60) {
        nonDark += 1;
      }
      total += 1;
    }
  }
  log("screenshot", {
    path: join(outDir, "s0.1-screenshot.png"),
    bytes: png.byteLength,
    size,
    distinctColorsSampled: colors.size,
    nonDarkFraction: total === 0 ? 0 : nonDark / total,
  });
}

async function hmrRuns(): Promise<void> {
  const file = join(templateDir, "src/scripts/beacon.ts");
  const original = readFileSync(file, "utf8");
  try {
    for (let run = 1; run <= 3; run += 1) {
      const before = hotReloads.length;
      const framesBefore = firstFrameCount;
      const editEpoch = Date.now();
      // A behaviour change, not a comment: the beacon's radius default.
      writeFileSync(file, original.replace("radius: f32(1.6)", `radius: f32(${String(1.6 + run / 10)})`));
      log("hmrEdit", { run, editEpoch });
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((done) => {
        const timer = setInterval(() => {
          if (hotReloads.length > before || firstFrameCount > framesBefore || Date.now() - editEpoch > 20000) {
            clearInterval(timer);
            done();
          }
        }, 5);
      });
      const report = hotReloads[before];
      const reloaded = firstFrameCount > framesBefore;
      log("hmrResult", {
        run,
        outcome: report !== undefined ? "hotReload" : reloaded ? "pageReload" : "nothing",
        pageReloadToFirstFrameMs: reloaded ? lastFirstFrameEpoch - editEpoch : null,
        hostReportLatencyMs: report === undefined ? null : Number(report["hostEpochMs"]) - editEpoch,
        mainReceiptLatencyMs: report === undefined ? null : Number(report["mainEpochMs"]) - editEpoch,
        report: report ?? null,
      });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => setTimeout(done, 2500));
    }
  } finally {
    writeFileSync(file, original);
  }
}

async function afterFirstFrame(): Promise<void> {
  if (window === null) {
    return;
  }
  const contents = window.webContents;
  if (env["SPIKE_S02"] !== undefined) {
    try {
      await runS02({ contents, rpc, inbox, iframeRect, log, outDir, mode: env["SPIKE_S02"], query: env["SPIKE_QUERY"] ?? "" });
    } catch (error) {
      log("s02Failed", { error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
    }
    writeFileSync(join(outDir, `s0.2-result-${env["SPIKE_S02"]}-${String(Date.now())}.json`), JSON.stringify(result, null, 2));
    setTimeout(() => {
      app.quit();
    }, holdMs);
    return;
  }
  await new Promise((done) => setTimeout(done, 1500));
  log("frames", { frames: describeFrames(contents) });
  const metrics = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName ?? null,
    workingSetKB: metric.memory.workingSetSize,
    peakWorkingSetKB: metric.memory.peakWorkingSetSize,
  }));
  log("appMetrics", { metrics });
  await screenshot(contents);
  if (env["SPIKE_HMR"] === "1") {
    await hmrRuns();
  }
  if (env["SPIKE_CRASH"] === "1") {
    // Kill the scene view's renderer and check the editor's own frame still answers.
    const view = contents.mainFrame.framesInSubtree.find((frame) => frame.url.includes("__ignifx_editor__"));
    const mainPid = contents.mainFrame.osProcessId;
    if (view !== undefined && view.osProcessId !== mainPid) {
      process.kill(view.osProcessId, "SIGKILL");
      log("killedSceneView", { pid: view.osProcessId, mainPid });
      await new Promise((done) => setTimeout(done, 1000));
      const alive = (await contents.executeJavaScript("document.title + ' / ' + document.querySelectorAll('iframe').length")) as string;
      log("editorAfterCrash", { alive, frames: describeFrames(contents), mainFrameCrashed: contents.isCrashed() });
    }
  }
  writeFileSync(join(outDir, `s0.1-result-${String(Date.now())}.json`), JSON.stringify(result, null, 2));
  setTimeout(() => {
    app.quit();
  }, holdMs);
}

ipcMain.on("spike:report", (event, message: Record<string, unknown>) => {
  // Only the editor's own top frame may report.
  if (!(event.senderFrame?.url ?? "").startsWith(`${editorOrigin}/`)) {
    log("refusedSender", { url: event.senderFrame?.url ?? null });
    return;
  }
  const kind = String(message["kind"]);
  inbox.push({ ...message, mainEpochMs: Date.now() });
  if (kind === "rpcResult") {
    const waiting = rpcWaiting.get(Number(message["rpcId"]));
    rpcWaiting.delete(Number(message["rpcId"]));
    waiting?.(message);
    return;
  }
  if (kind === "firstFrame" && message["iframeRect"] !== undefined) {
    iframeRect = message["iframeRect"] as typeof iframeRect;
  }
  if (kind === "firstFrame") {
    firstFrameCount += 1;
    lastFirstFrameEpoch = Date.now();
  }
  const line: Record<string, unknown> = { renderer: message };
  if (kind === "firstFrame" && firstFrameEpoch === 0) {
    firstFrameEpoch = Date.now();
    line["devServerSpawnToFirstFrameMs"] = devServerSpawnEpoch === 0 ? null : firstFrameEpoch - devServerSpawnEpoch;
    line["processStartToFirstFrameMs"] = firstFrameEpoch - processStartEpoch;
    void afterFirstFrame();
  }
  if (kind === "hotReloaded") {
    const params = (message["params"] ?? {}) as Record<string, unknown>;
    hotReloads.push({ ...params, mainEpochMs: Date.now() });
  }
  log(`renderer:${kind}`, line);
});

app.whenReady().then(
  async () => {
    log("appReady");
    if (env["SPIKE_SPAWN"] !== "0") {
      spawnDevServer();
    }
    serveIgnifxProtocol(join(here, "../renderer"));
    const base = windowOptionsFor({ entry: "index.html", preload: join(here, "../preload/index.cjs") });
    window = new BrowserWindow({
      ...base,
      width: 1280,
      height: 760,
      show: true,
      webPreferences: {
        ...base.webPreferences,
        additionalArguments: [`--spike-dev-origin=${devOrigin}`, `--spike-query=${env["SPIKE_QUERY"] ?? ""}`, ...(env["SPIKE_PLAY"] === "1" ? ["--spike-play", `--spike-play-origin=${playOrigin}`] : [])],
      },
    });
    log("webPreferences", { webPreferences: { ...base.webPreferences, preload: "(path)" } });
    installCsp(window.webContents.session);
    restrictPermissions(window.webContents.session);
    installNavigationLock(window.webContents);
    window.webContents.on("console-message", (details) => {
      log("console", { level: details.level, message: details.message.slice(0, 2000), frame: details.frame?.url ?? null });
    });
    window.webContents.on("did-fail-provisional-load", (_event, code, description, url, isMainFrame) => {
      log("didFailProvisionalLoad", { code, description, url, isMainFrame });
    });
    window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      log("didFailLoad", { code, description, url, isMainFrame });
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      log("renderProcessGone", { details });
    });
    app.on("child-process-gone", (_event, details) => {
      log("childProcessGone", { details });
    });
    await window.loadURL(`${editorOrigin}/index.html`);
    log("editorLoaded");
    await waitForDevServer();
    window.webContents.send("spike:server-ready");
    setTimeout(() => {
      if (firstFrameEpoch === 0) {
        log("timeout", { frames: window === null ? [] : describeFrames(window.webContents) });
        writeFileSync(join(outDir, `s0.1-result-${String(Date.now())}.json`), JSON.stringify(result, null, 2));
        app.quit();
      }
    }, Number(env["SPIKE_TIMEOUT_MS"] ?? "60000"));
  },
  (error: unknown) => {
    process.stderr.write(`spike failed: ${String(error)}\n`);
    app.exit(1);
  },
);

app.on("will-quit", () => {
  devServer?.kill();
});
