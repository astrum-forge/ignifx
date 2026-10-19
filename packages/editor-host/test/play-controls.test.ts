import { createApp, Script } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { listenForEditorPlayControls, startEditorPlayControls } from "../src/play-controls.js";
import { PlayNotification, RpcErrorCode } from "../src/protocol/index.js";
import { connect, CountingTarget, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorPlayControls } from "../src/play-controls.js";
import type { EditorPeer } from "./support/editor.js";
import type { App } from "@ignifx/core";

/**
 * The play view's controls (`docs/architecture/17-editor-host.md` §5): the game keeps its app, and
 * the editor plays, pauses, steps and stops it over the same handshake as the scene view.
 */

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/**
 * Builds a headless game with play controls and a connected, handshaken editor.
 *
 * @param handshake - Whether to send `hello` first.
 * @returns The app, the controls, and the editor's end.
 */
async function playView(
  handshake = true,
  heartbeatIntervalMs?: number,
): Promise<{ app: App; controls: EditorPlayControls; peer: EditorPeer }> {
  const app = await createApp({ headless: true });
  const target = new EventTarget();
  const controls = startEditorPlayControls(app, {
    editorOrigin: EDITOR_ORIGIN,
    messageTarget: target,
    ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
  });
  const peer = connect(target);
  cleanups.push(() => {
    peer.close();
    controls.dispose();
    app.dispose();
  });
  if (handshake) {
    await peer.hello();
  }
  return { app, controls, peer };
}

/**
 * Waits until the host has closed its end of a channel. Node reports a closed peer a little later
 * than the next turn of the event loop.
 *
 * @param peer - The editor's end.
 */
async function closed(peer: EditorPeer): Promise<void> {
  for (let turn = 0; turn < 100 && !peer.isClosed; turn += 1) {
    // One short wait at a time, until the close arrives.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  expect(peer.isClosed).toBe(true);
}

describe("startEditorPlayControls", () => {
  it("answers hello as the play view", async () => {
    const { peer } = await playView(false);

    expect((await peer.hello())["result"]).toMatchObject({
      hostKind: "play",
      capabilities: ["heartbeat", "playControls"],
    });
  });

  it("refuses play controls before the handshake", async () => {
    const { peer } = await playView(false);

    expect((await peer.request("play"))["error"]).toMatchObject({ code: RpcErrorCode.notReady });
  });

  it("plays and pauses the game", async () => {
    const { app, peer } = await playView();

    expect((await peer.request("play"))["result"]).toEqual({ isRunning: true, isPaused: false, frameCount: 0 });
    expect((await peer.request("pause"))["result"]).toMatchObject({ isRunning: true, isPaused: true });
    expect(app.time.paused).toBe(true);
    expect((await peer.request("play"))["result"]).toMatchObject({ isPaused: false });
  });

  it("steps exactly one frame and leaves the game paused", async () => {
    const { app, peer } = await playView();
    await peer.request("play");

    expect((await peer.request("step"))["result"]).toEqual({ isRunning: false, isPaused: true, frameCount: 1 });
    expect((await peer.request("step", { deltaSeconds: 0.5 }))["result"]).toMatchObject({ frameCount: 2 });
    expect(app.time.unscaledDeltaTime).toBeCloseTo(app.time.maximumDeltaTime);
  });

  it("leaves the game out of edit mode, so its scripts update on a step", async () => {
    let updates = 0;
    class Mover extends Script {
      static typeId = "test/Mover";
      update(): void {
        updates += 1;
      }
    }
    const { app, peer } = await playView();
    app.world.createEntity("Probe").addComponent(Mover);
    await peer.request("step");

    expect(app.isEditMode).toBe(false);
    expect(updates).toBe(1);
  });

  it("refuses a step with a bad delta", async () => {
    const { peer } = await playView();

    const response = await peer.request("step", { deltaSeconds: -1 });
    expect(response["error"]).toMatchObject({ code: RpcErrorCode.invalidParams });
  });

  it("stops the game", async () => {
    const { peer } = await playView();
    await peer.request("play");

    expect((await peer.request("stop"))["result"]).toMatchObject({ isRunning: false });
  });

  it("reports an engine error as internalError with its code", async () => {
    const { app, peer } = await playView();
    app.dispose();

    const response = await peer.request("step");
    expect(response["error"]).toMatchObject({ code: RpcErrorCode.internalError, data: { code: "IGX-0106" } });
  });

  it("leaves the app alone when disposed", async () => {
    const { app, controls, peer } = await playView();
    await peer.request("play");

    controls.dispose();
    controls[Symbol.dispose]();
    expect(controls.isConnected).toBe(false);
    expect(app.isRunning).toBe(true);
  });
});

describe("playState and playStateChanged (engine ask E24)", () => {
  it("reads the game's state without changing it", async () => {
    const { app, peer } = await playView();

    expect((await peer.request("playState"))["result"]).toEqual({ state: "stopped", frameCount: 0, time: 0 });
    await peer.request("play");
    expect((await peer.request("playState"))["result"]).toEqual({ state: "playing", frameCount: 0, time: 0 });
    await peer.request("pause");
    expect((await peer.request("playState"))["result"]).toMatchObject({ state: "paused" });
    await peer.request("step", { deltaSeconds: 0.02 });
    expect((await peer.request("playState"))["result"]).toEqual({ state: "paused", frameCount: 1, time: 0.02 });
    await peer.request("stop");
    expect((await peer.request("playState"))["result"]).toMatchObject({ state: "stopped", frameCount: 1 });
    expect(app.time.frameCount).toBe(1);
  });

  it("refuses playState before the handshake", async () => {
    const { peer } = await playView(false);

    expect((await peer.request("playState"))["error"]).toMatchObject({ code: RpcErrorCode.notReady });
  });

  it("sends playStateChanged after the answer, once for each change", async () => {
    const { peer } = await playView();

    const play = await peer.request("play");
    expect((await peer.next())["params"]).toEqual({ state: "playing", frameCount: 0, time: 0 });
    expect(play["result"]).toMatchObject({ isRunning: true });
    await peer.request("pause");
    expect(await peer.nextNotification(PlayNotification.playStateChanged)).toEqual({
      jsonrpc: "2.0",
      method: "playStateChanged",
      params: { state: "paused", frameCount: 0, time: 0 },
    });
    // Pausing a paused game changes nothing, so the next change reported is the stop.
    await peer.request("pause");
    await peer.request("stop");
    expect((await peer.nextNotification(PlayNotification.playStateChanged))["params"]).toMatchObject({
      state: "stopped",
    });
  });

  it("reports a change the game makes itself within a heartbeat", async () => {
    const { app, peer } = await playView(true, 5);
    await peer.request("play");
    await peer.nextNotification(PlayNotification.playStateChanged);

    app.time.paused = true;
    expect((await peer.nextNotification(PlayNotification.playStateChanged))["params"]).toMatchObject({
      state: "paused",
    });
    app.stop();
    app.time.paused = false;
    expect((await peer.nextNotification(PlayNotification.playStateChanged))["params"]).toMatchObject({
      state: "stopped",
    });
  });

  it("sends nothing before the handshake, and takes the state at the handshake as known", async () => {
    const { app, peer } = await playView(false, 5);
    await app.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await peer.hello();

    // Already playing at the handshake: the first change reported is the pause.
    await peer.request("pause");
    expect((await peer.nextNotification(PlayNotification.playStateChanged))["params"]).toMatchObject({
      state: "paused",
    });
  });
});

describe("listenForEditorPlayControls (engine ask E24)", () => {
  it("keeps a port that arrives before the app, and handshakes on it once attached", async () => {
    const target = new EventTarget();
    const connector = listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN, messageTarget: target });
    const peer = connect(target);
    expect(connector.hasPendingPort).toBe(true);
    const app = await createApp({ headless: true });
    cleanups.push(() => {
      peer.close();
      connector.dispose();
      app.dispose();
    });

    const controls = connector.attach(app);
    expect(connector.hasPendingPort).toBe(false);
    expect(controls.isConnected).toBe(true);
    expect((await peer.hello())["result"]).toMatchObject({ hostKind: "play" });
    expect((await peer.request("playState"))["result"]).toMatchObject({ state: "stopped" });
  });

  it("keeps only the newest port and closes the one it replaces", async () => {
    const target = new EventTarget();
    const connector = listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN, messageTarget: target });
    const first = connect(target);
    const second = connect(target);
    const app = await createApp({ headless: true });
    cleanups.push(() => {
      first.close();
      second.close();
      connector.dispose();
      app.dispose();
    });

    connector.attach(app);
    await closed(first);
    expect((await second.hello())["result"]).toMatchObject({ hostKind: "play" });
  });

  it("ignores a port from any other origin", () => {
    const target = new EventTarget();
    const connector = listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN, messageTarget: target });
    const peer = connect(target, "http://evil.example");
    cleanups.push(() => {
      peer.close();
      connector.dispose();
    });

    expect(connector.hasPendingPort).toBe(false);
  });

  it("hands its window over to the controls, and serves later ports there", async () => {
    const target = new CountingTarget();
    const connector = listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN, messageTarget: target });
    expect(target.listeners).toBe(1);
    const app = await createApp({ headless: true });
    const controls = connector.attach(app);
    expect(target.listeners).toBe(1);
    expect(controls.isConnected).toBe(false);
    const peer = connect(target);
    cleanups.push(() => {
      peer.close();
      app.dispose();
    });

    expect((await peer.hello())["result"]).toMatchObject({ hostKind: "play" });
    connector.dispose();
    connector[Symbol.dispose]();
    expect(controls.isConnected).toBe(false);
    expect(target.listeners).toBe(0);
  });

  it("closes a waiting port when disposed, and attaches untracked controls after", async () => {
    const target = new CountingTarget();
    const connector = listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN, messageTarget: target });
    const peer = connect(target);
    connector.dispose();
    await closed(peer);
    expect(target.listeners).toBe(0);

    const app = await createApp({ headless: true });
    const controls = connector.attach(app);
    cleanups.push(() => {
      controls.dispose();
      app.dispose();
    });
    expect(target.listeners).toBe(1);
  });

  it("checks its options before it listens", () => {
    expect(() => listenForEditorPlayControls({ editorOrigin: "*" })).toThrow(/IGX-1801|not an origin/u);
    expect(() => listenForEditorPlayControls({ editorOrigin: EDITOR_ORIGIN })).toThrow(/window/u);
  });
});
