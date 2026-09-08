// oxlint-disable no-underscore-dangle -- `window.__ignifxGameplay` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import type { Run } from "./run.js";
import type { Shrine } from "./scripts/shrine.js";
import type { App, Entity } from "@ignifx/core";

/**
 * A **test-only** hook for the gameplay half of `tests/visual/tests/templates.spec.ts`, installed
 * only when the page is opened with `?probe=1`. A shipped game never sees it: nothing below runs
 * without the flag, and the flag is not something a player types.
 *
 * What it exposes is what the top-down tests have to assert on as *numbers* rather than as pixels:
 * where the character is, so "W walks north" is a measurement; which shrines are lit and what the
 * run scores, so "standing on the pad lights it" does not depend on reading the HUD's font; and
 * where the camera ended up, so the dead zone and the follow damping can be checked against the
 * character they are following.
 */

/** A point in the world, in metres. */
export interface ProbePoint {
  /** The x coordinate. */
  readonly x: number;
  /** The y coordinate. */
  readonly y: number;
}

/** What one gameplay reading contains. */
export interface GameplaySnapshot {
  /** The character's world position, in metres. Its origin is at its feet. */
  readonly position: ProbePoint;
  /** Where the camera is, in metres. */
  readonly camera: ProbePoint;
  /** The ids of the shrines that are lit. */
  readonly lit: readonly string[];
  /** How many shrines are lit. */
  readonly score: number;
  /** How many shrines the level has. */
  readonly shrines: number;
  /** `app.time.paused`. */
  readonly paused: boolean;
}

/** The hook the template spec drives. */
export interface GameplayProbe {
  /**
   * Reads the character, the camera and the run.
   *
   * @returns The current reading.
   */
  snapshot(): GameplaySnapshot;
}

declare global {
  interface Window {
    /** The test hook, present only under `?probe=1`. */
    __ignifxGameplay?: GameplayProbe;
  }
}

/**
 * Installs the probe on `window.__ignifxGameplay`.
 *
 * @param app - The running app.
 * @param player - The character entity.
 * @param camera - The camera entity.
 * @param shrines - Every shrine the objects layer spawned.
 * @param run - The run the shrines are scored in.
 */
export function installGameplayProbe(
  app: App,
  player: Entity,
  camera: Entity,
  shrines: readonly Shrine[],
  run: Run,
): void {
  window.__ignifxGameplay = {
    snapshot(): GameplaySnapshot {
      const here = player.transform.position2D;
      const eye = camera.transform.position2D;
      return {
        position: { x: here.x, y: here.y },
        camera: { x: eye.x, y: eye.y },
        lit: shrines.filter((shrine: Shrine): boolean => shrine.isLit).map((shrine: Shrine): string => shrine.id),
        score: run.score(),
        shrines: run.shrineCount,
        paused: app.time.paused,
      };
    },
  };
}
