// oxlint-disable no-underscore-dangle -- `window.__ignifxGameplay` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import type { ThirdPersonCamera } from "@ignifx/3d";
import type { App, Entity } from "@ignifx/core";

/**
 * A **test-only** hook for the gameplay half of `tests/visual/tests/templates.spec.ts`, installed
 * only when the page is opened with `?probe=1`. A shipped game never sees it: nothing below runs
 * without the flag, and the flag is not something a player types. It is the same pattern as
 * `src/desktop-probe.ts`, for the same reason — a test needs to read state a game has no business
 * exposing — and both are installed from the one `?probe=1` branch in `src/main.ts`.
 *
 * What it exposes is what the camera tests have to assert on: the orbit angles, so "an unlocked
 * mouse crossing the canvas does not swing the camera" is a number rather than a screenshot; the
 * character's position and the camera's, so "W walks forward" and "the character does not judder
 * against the camera" are likewise; and the pointer-lock state, because whether the browser grants
 * a lock in a headless run is exactly the thing under test.
 */

/** What one gameplay reading contains. */
export interface GameplaySnapshot {
  /** The camera's orbit yaw, in degrees. */
  readonly yaw: number;
  /** The camera's orbit pitch, in degrees; positive is raised and aimed down. */
  readonly pitch: number;
  /** Where the boom currently ends, in metres, after the collision sweep has shortened it. */
  readonly boom: number;
  /** The character's world position, in metres. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** The camera's world position, in metres — the damped pose, after the boom was applied. */
  readonly camera: { readonly x: number; readonly y: number; readonly z: number };
  /** `app.input.pointerLock.locked`. */
  readonly pointerLocked: boolean;
  /** `app.time.paused`. */
  readonly paused: boolean;
}

/** The hook the template spec drives. */
export interface GameplayProbe {
  /**
   * Reads the camera, the character and the pointer lock.
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
 * @param camera - The orbit rig.
 */
export function installGameplayProbe(app: App, player: Entity, camera: ThirdPersonCamera): void {
  window.__ignifxGameplay = {
    snapshot(): GameplaySnapshot {
      const here = player.transform.position;
      const eye = camera.entity.transform.position;
      return {
        yaw: camera.yaw,
        pitch: camera.pitch,
        boom: camera.currentDistance,
        position: { x: here.x, y: here.y, z: here.z },
        camera: { x: eye.x, y: eye.y, z: eye.z },
        pointerLocked: app.input.pointerLock.locked,
        paused: app.time.paused,
      };
    },
  };
}
