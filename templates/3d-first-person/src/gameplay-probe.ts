// oxlint-disable no-underscore-dangle -- `window.__ignifxGameplay` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import type { FirstPersonController } from "@ignifx/3d";
import type { App, Entity } from "@ignifx/core";

/**
 * A **test-only** hook for the gameplay half of `tests/visual/tests/templates.spec.ts`, installed
 * only when the page is opened with `?probe=1`. A shipped game never sees it: nothing below runs
 * without the flag, and the flag is not something a player types. It is the same pattern as the
 * third-person template's `src/desktop-probe.ts`, for the same reason — a test needs to read state
 * a game has no business exposing.
 *
 * What it exposes is what the look tests have to assert on: the body's yaw and the head's pitch, so
 * "an unlocked mouse crossing the canvas does not turn the view" is a number rather than a
 * screenshot; the character's position, so "W walks forward" is likewise; and the pointer-lock
 * state, because whether the browser grants a lock in a headless run is exactly the thing under
 * test.
 */

/** What one gameplay reading contains. */
export interface GameplaySnapshot {
  /** The body's yaw, in degrees. */
  readonly yaw: number;
  /** The head's pitch, in degrees; negative is up. */
  readonly pitch: number;
  /** The character's world position, in metres. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** The head's local height above the capsule's centre, in metres — the head bob, live. */
  readonly headHeight: number;
  /** `app.input.pointerLock.locked`. */
  readonly pointerLocked: boolean;
  /** `app.time.paused`. */
  readonly paused: boolean;
}

/** The hook the template spec drives. */
export interface GameplayProbe {
  /**
   * Reads the character, the head and the pointer lock.
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
 * @param player - The character's body, which carries the controller.
 * @param head - The entity that pitches, which carries the camera.
 * @param controller - The first-person controller.
 */
export function installGameplayProbe(app: App, player: Entity, head: Entity, controller: FirstPersonController): void {
  window.__ignifxGameplay = {
    snapshot(): GameplaySnapshot {
      const here = player.transform.position;
      return {
        yaw: controller.yaw,
        pitch: controller.pitch,
        position: { x: here.x, y: here.y, z: here.z },
        headHeight: head.transform.localPosition.y,
        pointerLocked: app.input.pointerLock.locked,
        paused: app.time.paused,
      };
    },
  };
}
