import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorPlayControls } from "../src/play-controls.js";
import { isPlayStats, PlayMethod } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { PlayStats } from "../src/protocol/index.js";

/**
 * `playStats` on a game that renders to a real WebGPU canvas (engine ask E25): the rate and the
 * frame time come from the frames the render loop recorded in `app.diagnostics`, whether or not game
 * time is paused, and stop with the loop; the entity count is the world's.
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

describe("playStats in a rendering game (E25)", () => {
  it("reports the render loop's rate and the world's entities, and no rate once stopped", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    cleanups.push(() => {
      canvas.remove();
    });
    const app = await createApp({ canvas });
    cleanups.push(() => {
      app.dispose();
    });
    const before = app.world.scenes.reduce((count, scene) => count + scene.roots.length, 0);
    const level = app.world.createEntity("Level");
    app.world.createEntity("Player", { parent: level });
    app.world.createEntity("Crate", { parent: level });
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
    await frames(20);

    const read = async (): Promise<PlayStats> => {
      const result: unknown = (await peer.request(PlayMethod.playStats))["result"];
      if (!isPlayStats(result)) {
        throw new Error(`playStats answered ${JSON.stringify(result)}.`);
      }
      return result;
    };
    const playing = await read();
    expect(playing.fps).toBeGreaterThan(0);
    expect(playing.frameTimeMs).toBeGreaterThan(0);
    expect(playing.fps).toBeCloseTo(1000 / playing.frameTimeMs, 0);
    expect(playing.entityCount).toBe(before + 3);
    expect(playing.frameCount).toBeGreaterThanOrEqual(20);
    expect(playing.frameCount).toBeLessThanOrEqual(app.time.frameCount);

    // Paused game time still renders frames, and the count follows the world.
    await peer.request(PlayMethod.pause);
    level.destroyImmediate();
    await frames(5);
    const paused = await read();
    expect(paused.fps).toBeGreaterThan(0);
    expect(paused.entityCount).toBe(before);
    expect(paused.frameCount).toBeGreaterThan(playing.frameCount);

    await peer.request(PlayMethod.stop);
    const stopped = await read();
    expect(stopped).toEqual({ fps: 0, frameTimeMs: 0, entityCount: before, frameCount: app.time.frameCount });
  });
});
