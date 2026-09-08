// oxlint-disable no-underscore-dangle -- `window.__ignifxGameplay` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { CharacterController2D } from "@ignifx/physics-2d";
import { PlatformerController } from "./scripts/platformer-controller.js";
import type { Run } from "./run.js";
import type { App, Entity } from "@ignifx/core";

/**
 * A **test-only** hook for the gameplay half of `tests/visual/tests/templates.spec.ts`, installed
 * only when the page is opened with `?probe=1`. A shipped game never sees it: nothing below runs
 * without the flag, and the flag is not something a player types.
 *
 * What it exposes is what the platformer tests have to assert on as *numbers* rather than as
 * pixels: where the character is and whether it is standing, so "the slope is climbed" and "a tap
 * and a hold reach different heights" are measurements; the score, so "walking over a coin scores
 * it" does not depend on reading the HUD's font; and the respawn point, so "falling into the pit
 * puts the character back on the lip it ran off" can be checked against the place the controller
 * actually chose.
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
  /** The velocity `PlatformerController` is carrying, in metres per second. */
  readonly velocity: ProbePoint;
  /** `CharacterController2D.isGrounded`. */
  readonly grounded: boolean;
  /** Where a fall out of the level would put the character back, in metres. */
  readonly respawn: ProbePoint;
  /** How many coins have been taken. */
  readonly score: number;
  /** How many coins the level has. */
  readonly coins: number;
  /** `app.time.paused`. */
  readonly paused: boolean;
}

/** The hook the template spec drives. */
export interface GameplayProbe {
  /**
   * Reads the character and the run.
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
 * @param run - The run the coins are scored in.
 */
export function installGameplayProbe(app: App, player: Entity, run: Run): void {
  const controller = player.getComponent(CharacterController2D);
  const platformer = player.getComponent(PlatformerController);

  window.__ignifxGameplay = {
    snapshot(): GameplaySnapshot {
      const here = player.transform.position2D;
      const velocity = platformer?.velocity ?? { x: 0, y: 0 };
      const respawn = platformer?.respawnPoint ?? here;
      return {
        position: { x: here.x, y: here.y },
        velocity: { x: velocity.x, y: velocity.y },
        grounded: controller?.isGrounded ?? false,
        respawn: { x: respawn.x, y: respawn.y },
        score: run.score(),
        coins: run.coinCount,
        paused: app.time.paused,
      };
    },
  };
}
