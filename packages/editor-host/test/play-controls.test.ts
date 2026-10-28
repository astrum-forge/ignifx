import { createApp, Script } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { CLIPPED_MARKER } from "../src/app-reports.js";
import { listenForEditorPlayControls, startEditorPlayControls } from "../src/play-controls.js";
import {
  HOST_TEXT_MAX_LENGTH,
  isAppErrorData,
  isHostErrorParams,
  isHotReloadedParams,
  isLogParams,
  PlayNotification,
  RpcErrorCode,
} from "../src/protocol/index.js";
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
      capabilities: ["heartbeat", "playControls", "logRelay"],
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

describe("playStats (engine ask E25)", () => {
  it("averages the newest second of frames, and counts every scene's entities", async () => {
    const { app, peer } = await playView();
    const parent = app.world.createEntity("Parent");
    app.world.createEntity("Child", { parent });
    app.world.createEntity("Kept", { scene: app.world.createScene("hud", { persistent: true }) });

    expect((await peer.request("playStats"))["result"]).toEqual({
      fps: 0,
      frameTimeMs: 0,
      entityCount: 3,
      frameCount: 0,
    });
    // A headless app has no loop: once started, each step is one frame of the given delta.
    await app.start();
    for (let frame = 0; frame < 30; frame += 1) {
      app.step(0.1);
    }
    for (let frame = 0; frame < 50; frame += 1) {
      app.step(0.02);
    }
    parent.destroyImmediate();
    // The newest 50 frames fill the second; the older, slower ones are left out.
    expect((await peer.request("playStats"))["result"]).toEqual({
      fps: 50,
      frameTimeMs: 20,
      entityCount: 1,
      frameCount: 80,
    });
    // Paused game time still renders frames.
    app.time.paused = true;
    app.step(0.02);
    expect((await peer.request("playStats"))["result"]).toMatchObject({ fps: 50, frameCount: 81 });
  });

  it("reports no rate once the loop is stopped, and changes nothing", async () => {
    const { app, peer } = await playView();
    await peer.request("step", { deltaSeconds: 0.02 });

    expect((await peer.request("playStats"))["result"]).toEqual({
      fps: 0,
      frameTimeMs: 0,
      entityCount: 0,
      frameCount: 1,
    });
    expect(app.isRunning).toBe(false);
    expect(app.time.paused).toBe(true);
  });

  it("refuses playStats before the handshake", async () => {
    const { peer } = await playView(false);

    expect((await peer.request("playStats"))["error"]).toMatchObject({ code: RpcErrorCode.notReady });
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

describe("the play view's reports (HostCapability.logRelay)", () => {
  /** A script that fails in `update`, on purpose. */
  class Faulty extends Script {
    static typeId = "test/Faulty";
    update(): void {
      throw new Error("Faulty.update: boom.");
    }
  }

  it("relays the game's log lines, with the Error a line carries", async () => {
    const { app, peer } = await playView();

    app.log.warn("low on ammo", new RangeError("ammo < 0"));
    const log = await peer.nextNotification(PlayNotification.log);
    expect(isLogParams(log["params"])).toBe(true);
    expect(log["params"]).toMatchObject({
      level: "warn",
      scope: null,
      message: "low on ammo",
      error: { message: "ammo < 0", code: null },
    });
    const logged = isLogParams(log["params"]) ? log["params"].error : undefined;
    expect(logged?.stack).toContain("RangeError: ammo < 0");
  });

  it("relays an error a script throws, with its entity, component, phase and stack", async () => {
    const { app, peer } = await playView();
    const probe = app.world.createEntity("Probe");
    probe.addComponent(Faulty);
    // Stepped by the game itself: a request's answer would skip the notification on the way.
    app.step(1 / 60);

    const error = await peer.nextNotification(PlayNotification.hostError);
    const params = error["params"];
    expect(isHostErrorParams(params)).toBe(true);
    expect(params).toMatchObject({ code: null, message: "Faulty.update: boom." });
    const data = isHostErrorParams(params) ? params.data : null;
    expect(isAppErrorData(data)).toBe(true);
    expect(data).toMatchObject({
      source: "lifecycle",
      phaseName: "Update",
      entity: probe.uid,
      entityName: "Probe",
      component: "test/Faulty",
    });
    expect(isAppErrorData(data) ? data.stack : null).toContain("Faulty.update: boom.");
  });

  it("clips an oversized log line, its Error's message and stack, so the editor keeps it", async () => {
    const { app, peer } = await playView();
    const huge = "m".repeat(HOST_TEXT_MAX_LENGTH + 10);

    app.log.warn(huge, new RangeError(huge));
    const log = await peer.nextNotification(PlayNotification.log);
    const params = log["params"];
    expect(isLogParams(params)).toBe(true);
    const message = isLogParams(params) ? params.message : "";
    expect(message).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(message.endsWith(`m${CLIPPED_MARKER}`)).toBe(true);
    const logged = isLogParams(params) ? params.error : undefined;
    expect(logged?.message).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(logged?.stack?.startsWith("RangeError: mmm")).toBe(true);
    expect(logged?.stack).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(logged?.stack?.endsWith(CLIPPED_MARKER)).toBe(true);
  });

  it("clips an oversized script error's message and stack, so the editor keeps it", async () => {
    const { app, peer } = await playView();
    const huge = "e".repeat(HOST_TEXT_MAX_LENGTH * 2);
    class Loud extends Script {
      static typeId = "test/Loud";
      update(): void {
        throw new Error(huge);
      }
    }
    app.world.createEntity("Probe").addComponent(Loud);
    app.step(1 / 60);

    const error = await peer.nextNotification(PlayNotification.hostError);
    const params = error["params"];
    expect(isHostErrorParams(params)).toBe(true);
    const data = isHostErrorParams(params) ? params.data : null;
    expect(isAppErrorData(data)).toBe(true);
    expect(isHostErrorParams(params) ? params.message : "").toHaveLength(HOST_TEXT_MAX_LENGTH);
    const stack = isAppErrorData(data) ? data.stack : null;
    expect(stack?.startsWith("Error: eee")).toBe(true);
    expect(stack).toHaveLength(HOST_TEXT_MAX_LENGTH);
    expect(stack?.endsWith(CLIPPED_MARKER)).toBe(true);
  });

  it("relays hot reloads with their errors' stacks", async () => {
    const { app, peer } = await playView();
    class Mover extends Script {
      static typeId = "test/Mover";
    }
    app.registerComponents([Mover]);
    app.world.createEntity("Probe").addComponent(Mover);
    class MoverV2 extends Mover {
      static onHotReload(): void {
        throw new Error("MoverV2.onHotReload: cannot migrate.");
      }
    }
    app.hotReload.apply([{ types: [MoverV2] }]);

    const reloaded = await peer.nextNotification(PlayNotification.hotReloaded);
    expect(isHotReloadedParams(reloaded["params"])).toBe(true);
    expect(reloaded["params"]).toMatchObject({
      report: {
        typeIds: ["test/Mover"],
        errors: [{ message: "MoverV2.onHotReload: cannot migrate.", code: null }],
      },
    });
    const params = reloaded["params"];
    const [failure] = isHotReloadedParams(params) ? params.report.errors : [];
    expect(failure?.stack).toContain("MoverV2.onHotReload: cannot migrate.");
  });

  it("keeps what the game reports before the handshake and sends it right after ready", async () => {
    const { app, peer } = await playView(false);
    for (let line = 0; line < 300; line += 1) {
      app.log.info(`line ${String(line)}`);
    }
    await peer.hello();

    // The newest 256 lines, oldest first.
    const first = await peer.nextNotification(PlayNotification.log);
    expect(first["params"]).toMatchObject({ message: "line 44" });
    let last = first;
    for (let count = 1; count < 256; count += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one notification at a time
      last = await peer.nextNotification(PlayNotification.log);
    }
    expect(last["params"]).toMatchObject({ message: "line 299" });
  });

  it("stops relaying once disposed", async () => {
    const { app, controls, peer } = await playView();
    controls.dispose();
    app.log.warn("after dispose");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(peer.takeNotification(PlayNotification.log)).toBeNull();
  });
});
