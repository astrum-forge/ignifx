import { createApp, defineExtension } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorPlayControls } from "../src/play-controls.js";
import { PlayMethod } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { App } from "@ignifx/core";

/**
 * Play after Step in a game that renders to a real WebGPU canvas: `step` stops the loop, and the
 * `play` after it restarts that loop without running the extensions' `onStart` again. Running it
 * again made physics register its diagnostics group twice (`IGX-1503`), so the game never resumed.
 */

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup();
  }
});

/**
 * Waits for the browser to present some frames.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

/** An extension whose `onStart` registers a diagnostics group, as the physics extension does. */
const countersOnStart = defineExtension(() => ({
  name: "game/counters",
  version: "1.0.0",
  register: () => undefined,
  onStart(app: App): void {
    app.diagnostics.registerGroup("physics", ["bodies"]);
  },
}));

describe("play after step", () => {
  it("resumes the game's frame loop without starting it again", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    cleanups.push(() => {
      canvas.remove();
    });
    const app = await createApp({ canvas, extensions: [countersOnStart()] });
    cleanups.push(() => {
      app.dispose();
    });
    const errors: unknown[] = [];
    app.onError.connect((report) => {
      errors.push(report);
    });
    await app.start();
    const target = new EventTarget();
    const controls = startEditorPlayControls(app, {
      editorOrigin: EDITOR_ORIGIN,
      messageTarget: target,
      heartbeatIntervalMs: 60_000,
    });
    const peer = connect(target);
    cleanups.push(() => {
      peer.close();
      controls.dispose();
    });
    await peer.hello();
    await frames(3);

    const stepped = await peer.request(PlayMethod.step);
    expect(stepped["error"]).toBeUndefined();
    expect(app.isRunning).toBe(false);
    const atStep = app.time.frameCount;

    const played = await peer.request(PlayMethod.play);
    expect(played["error"]).toBeUndefined();
    expect(played["result"]).toMatchObject({ isRunning: true, isPaused: false });
    await frames(5);
    expect(app.time.frameCount).toBeGreaterThan(atStep);
    expect(errors).toEqual([]);
  });
});
