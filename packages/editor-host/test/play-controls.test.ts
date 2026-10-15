import { createApp, Script } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorPlayControls } from "../src/play-controls.js";
import { RpcErrorCode } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
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
async function playView(handshake = true): Promise<{ app: App; controls: EditorPlayControls; peer: EditorPeer }> {
  const app = await createApp({ headless: true });
  const target = new EventTarget();
  const controls = startEditorPlayControls(app, { editorOrigin: EDITOR_ORIGIN, messageTarget: target });
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
