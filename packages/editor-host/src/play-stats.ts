/**
 * `playStats`: the game's frame rate and frame time from the frame history `app.diagnostics` keeps,
 * and the number of entities its world holds (`docs/architecture/17-editor-host.md` §5).
 */

import { createFrameSample } from "@ignifx/core";
import type { PlayStats } from "./protocol/index.js";
import type { App, Entity, FrameSample, SceneInstance } from "@ignifx/core";

/** How much of the frame history the rate is averaged over, in milliseconds of rendered frames. */
export const PLAY_STATS_WINDOW_MS = 1000;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Counts the entities of a scene instance, members of instanced scenes included.
 *
 * @param scene - The instance.
 * @returns How many entities it holds, destroyed ones left out.
 */
export function countEntities(scene: SceneInstance): number {
  let count = 0;
  const pending: Entity[] = [...scene.roots];
  for (let entity = pending.pop(); entity !== undefined; entity = pending.pop()) {
    if (!entity.isDestroyed) {
      count += 1;
      pending.push(...entity.children);
    }
  }
  return count;
}

/**
 * Rounds a rate for the wire: two decimals are more than the stats strip shows.
 *
 * @param value - The value.
 * @returns It, to the nearest hundredth.
 */
function hundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reads a game's stats, with the one frame sample it reads the history into. */
export class PlayStatsReader {
  readonly #app: App;

  readonly #sample: FrameSample = createFrameSample();

  /**
   * Binds a reader to the game's app.
   *
   * @param app - The game's app.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * Reads the stats now.
   *
   * @returns The mean frame time and rate over the newest second of the frame history (both `0`
   * while the frame loop does not run), the world's entity count, and `app.time.frameCount`.
   */
  read(): PlayStats {
    const app = this.#app;
    const diagnostics = app.diagnostics;
    let frames = 0;
    let elapsedMs = 0;
    // A stopped or stepped game has no loop: its history is the past, not a rate.
    if (app.isRunning) {
      for (let offset = 0; offset < diagnostics.historyLength && elapsedMs < PLAY_STATS_WINDOW_MS; offset += 1) {
        elapsedMs += diagnostics.readFrame(offset, this.#sample).rawDeltaMs;
        frames += 1;
      }
    }
    const frameTimeMs = frames > 0 && elapsedMs > 0 ? elapsedMs / frames : 0;
    let entityCount = 0;
    for (const scene of app.world.scenes) {
      entityCount += countEntities(scene);
    }
    return {
      fps: frameTimeMs > 0 ? hundredths(MILLISECONDS_PER_SECOND / frameTimeMs) : 0,
      frameTimeMs: hundredths(frameTimeMs),
      entityCount,
      frameCount: app.time.frameCount,
    };
  }
}
