// THROWAWAY spike S0.1 — not for merge. The page module of /__ignifx_editor__/: creates an app from the
// project's own @ignifx/core with the project's extensions and scripts, loads a scene file, renders,
// and answers JSON-RPC over a MessagePort handed in by the parent (the editor renderer).
import { Component, createApp, VERSION } from "@ignifx/core";
import { coreVersion, corePackagePath, extensions, scene } from "virtual:ignifx-editor-spike/project";
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import type { App, HotReloadReport } from "@ignifx/core";

interface RpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: number | string;
  readonly method: string;
  readonly params?: unknown;
}

/** Milestones in ms since this document's navigation start (performance.timeOrigin). */
const marks: Record<string, number> = { moduleEvaluated: performance.now() };
let port: MessagePort | null = null;
let parentOrigin: string | null = null;
let appRef: App | null = null;
const pending: object[] = [];

function send(message: object): void {
  if (port === null) {
    pending.push(message);
    return;
  }
  port.postMessage(message);
}

function notify(method: string, params: unknown): void {
  send({ jsonrpc: "2.0", method, params });
}

function status(): object {
  const app = appRef;
  return {
    engineVersion: coreVersion,
    coreVERSIONConstant: VERSION,
    appVersion: app?.version ?? null,
    corePackagePath,
    timeOrigin: performance.timeOrigin,
    marks,
    frameCount: app?.time.frameCount ?? 0,
    drawCalls: app?.renderer.drawCalls ?? 0,
    gpu: typeof navigator.gpu !== "undefined",
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    origin: window.location.origin,
    parentOrigin,
  };
}

function handle(request: RpcRequest): void {
  if (request.method === "ping") {
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: { pong: true, hostNow: performance.now(), hostEpochMs: Date.now(), ...status() },
    });
    return;
  }
  if (request.method === "status") {
    send({ jsonrpc: "2.0", id: request.id ?? null, result: status() });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32601, message: `no method ${request.method}` } });
}

// Installed before any await, so a port posted at the iframe's `load` event cannot be missed.
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type !== "ignifx-editor/connect" || event.ports.length !== 1 || port !== null) {
    return;
  }
  parentOrigin = event.origin;
  marks["portReceived"] = performance.now();
  port = event.ports[0] ?? null;
  if (port === null) {
    return;
  }
  port.onmessage = (portEvent: MessageEvent): void => {
    handle(portEvent.data as RpcRequest);
  };
  for (const message of pending.splice(0)) {
    port.postMessage(message);
  }
});

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const canvas = document.querySelector("#scene-view");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("editor host spike: no #scene-view canvas");
  }
  // One copy of core: every project script must extend *this* module's Component.
  const foreign = scripts.filter((type) => !(type.prototype instanceof Component)).map((type) => type.typeId);
  marks["createAppStart"] = performance.now();
  const app = await createApp({
    canvas,
    settings: import.meta.env.IGNIFX_CONFIG,
    assets: { manifest },
    extensions: extensions(),
  });
  appRef = app;
  marks["appCreated"] = performance.now();
  app.registerComponents(scripts);
  acceptHotReload(app);
  app.hotReload.onApplied.connect((report: HotReloadReport) => {
    notify("hotReloaded", {
      hostEpochMs: Date.now(),
      kind: report.kind,
      typeIds: report.typeIds,
      instances: report.instances,
      durationMs: report.durationMs,
      errors: report.errors.length,
    });
  });
  app.onError.connect((error) => {
    notify("error", { message: String(error) });
  });
  const instance = await app.world.loadScene(scene);
  marks["sceneLoaded"] = performance.now();
  await app.start();
  marks["started"] = performance.now();
  await nextFrame();
  await nextFrame();
  marks["firstFrame"] = performance.now();
  notify("firstFrame", {
    hostEpochMs: Date.now(),
    scene: instance.name,
    beacon: app.world.findByName("Beacon")?.components.map((c) => (c.constructor as { typeId?: string }).typeId) ?? null,
    scripts: scripts.map((type) => type.typeId),
    foreignScripts: foreign,
    settingsInjected: import.meta.env.IGNIFX_CONFIG !== undefined,
    ...status(),
  });
}

main().catch((error: unknown) => {
  marks["failed"] = performance.now();
  notify("failed", { message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
  throw error;
});
