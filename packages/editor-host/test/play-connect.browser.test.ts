import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_CONNECT_MESSAGE_TYPE, PlayMethod } from "../src/protocol/index.js";
import { EDITOR_PLAY_CONTROLS_EXPORT, playControlsModuleSource } from "../src/vite/modules.js";
import { EditorPeer } from "./support/editor.js";
import type { App } from "@ignifx/core";

/**
 * `virtual:ignifx/editor` in a real page (engine ask E24): the generated development module is
 * evaluated as a game's `main.ts` would import it, the editor posts its port to the real `window`
 * before the game has called `attachEditorPlayControls(app)`, and the handshake still completes,
 * once, on that first port.
 */

// `src/vite/modules.ts` takes four ids from the Vite plugin, a Node package, for the scene view's
// entry; the play controls' module uses none of them.
vi.mock("@ignifx/vite-plugin", () => ({
  ASSET_CHANGED_EVENT: "ignifx:asset-changed",
  IGNIFX_CONFIG_DEFINE_KEY: "IGNIFX_CONFIG",
  MANIFEST_MODULE_ID: "virtual:ignifx/manifest",
  SCRIPTS_MODULE_ID: "virtual:ignifx/scripts",
}));

/** What the generated module exports. */
type AttachEditorPlayControls = (app: App) => () => void;

const cleanups: (() => void)[] = [];

/** A dynamic `import()` Vite does not rewrite, for a `blob:` URL it cannot serve. */
// oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- the import must not be rewritten.
const importUrl = new Function("url", "return import(url);") as (url: string) => Promise<unknown>;

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/**
 * Evaluates the generated development module, with its `@ignifx/editor-host` import pointed at
 * this package's source, the way Vite serves it to a game page.
 *
 * @param editorOrigin - The origin the plugin was given.
 * @returns The module's `attachEditorPlayControls`.
 */
async function evaluatePlayControlsModule(editorOrigin: string): Promise<AttachEditorPlayControls> {
  const host = new URL("../src/play-controls.ts", import.meta.url).href;
  const source = playControlsModuleSource({
    editorOrigin,
    engineVersion: "0.9.0",
    heartbeatIntervalMs: 60_000,
    hot: true,
  }).replace('"@ignifx/editor-host"', JSON.stringify(host));
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    // Imported past Vite's transform, as the browser itself imports a module Vite has served.
    const loaded: unknown = await importUrl(url);
    const attach: unknown = Reflect.get(loaded as object, EDITOR_PLAY_CONTROLS_EXPORT);
    if (typeof attach !== "function") {
      throw new Error(`The generated module exports no ${EDITOR_PLAY_CONTROLS_EXPORT}.`);
    }
    return attach as AttachEditorPlayControls;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Posts the editor's connect message to this page's window, as the editor does on the view's
 * `load` event, and waits until the window has dispatched it.
 *
 * @param origin - The origin to target, which is also the origin the message arrives from.
 * @returns The editor's end of the new channel.
 */
async function postConnect(origin: string): Promise<EditorPeer> {
  const channel = new MessageChannel();
  const delivered = new Promise<void>((resolve) => {
    window.addEventListener(
      "message",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  window.postMessage({ type: EDITOR_CONNECT_MESSAGE_TYPE }, origin, [channel.port2]);
  await delivered;
  return new EditorPeer(channel.port1);
}

/**
 * Waits for a few event-loop turns, so any message still in flight arrives.
 *
 * @param ms - How long to wait.
 */
async function settle(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("virtual:ignifx/editor in a page", () => {
  it("keeps a port posted before attachEditorPlayControls and completes the handshake on it once", async () => {
    // A same-window post arrives from this page's own origin, which plays the editor's here.
    const editorOrigin = window.location.origin;
    const attach = await evaluatePlayControlsModule(editorOrigin);

    // The editor connects while the game still awaits createApp.
    const peer = await postConnect(editorOrigin);
    cleanups.push(() => {
      peer.close();
    });
    const app = await createApp({ headless: true });
    cleanups.push(() => {
      app.dispose();
    });
    const detach = attach(app);
    cleanups.push(detach);
    const answers: unknown[] = [];
    peer.port.addEventListener("message", (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === "object" && data !== null && "id" in data) {
        answers.push(data);
      }
    });

    const ready = await peer.hello();
    expect(ready["result"]).toMatchObject({ hostKind: "play", capabilities: ["heartbeat", "playControls"] });
    expect((await peer.request(PlayMethod.playState))["result"]).toEqual({ state: "stopped", frameCount: 0, time: 0 });

    // One answer for each request: no second channel answered the hello.
    await settle();
    expect(answers).toHaveLength(2);
  });

  it("ignores a port posted from any other origin", async () => {
    const attach = await evaluatePlayControlsModule("ignifx://app");
    const peer = await postConnect(window.location.origin);
    cleanups.push(() => {
      peer.close();
    });
    const app = await createApp({ headless: true });
    cleanups.push(() => {
      app.dispose();
    });
    cleanups.push(attach(app));

    let answered = false;
    void peer.hello().then(() => {
      answered = true;
    });
    await settle(100);
    expect(answered).toBe(false);
  });
});
