import { Camera, DEG_TO_RAD, f32, RAD_TO_DEG, Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Widens the camera's vertical field of view on a portrait screen, so a phone held upright sees as
 * much of the world across as a square window does.
 *
 * `Camera.fov` is vertical. On a 16:9 screen 55 degrees frames the character with room on both
 * sides; on a 390 x 844 phone the same 55 degrees is only 27 degrees across, and the character and
 * the companion fill the frame. Below a 1:1 aspect this keeps the horizontal view at what `fov` gives
 * on a square screen, up to `maxFov`.
 */
export class PortraitFov
  extends Script.define({
    /** The vertical field of view at a 1:1 aspect or wider, in degrees. */
    fov: f32(55, { min: 1, max: 179 }),
    /** The widest vertical field of view a tall screen may get, in degrees. */
    maxFov: f32(90, { min: 1, max: 179 }),
  })
  implements ScriptCallbacks
{
  static typeId = "third-person/PortraitFov";

  /** Keeps following the screen while a menu has paused the game, so the title screen frames too. */
  static updateWhenPaused = true;

  #camera: Camera | null = null;

  awake(): void {
    this.#camera = this.entity.getComponent(Camera);
  }

  update(): void {
    const camera = this.#camera;
    const canvas = this.app.renderer.surface;
    if (camera === null || canvas === null || canvas.width === 0 || canvas.height === 0) {
      return;
    }
    const aspect = canvas.width / canvas.height;
    const fov = aspect >= 1 ? this.fov : this.#portraitFov(aspect);
    // Written only on a change: the camera rebuilds its projection when `fov` differs.
    if (camera.fov !== fov) {
      camera.fov = fov;
    }
  }

  /**
   * The vertical field of view that keeps a square screen's horizontal view at this aspect.
   *
   * @param aspect - Width over height, below 1.
   * @returns The field of view, in degrees, capped at `maxFov`.
   */
  #portraitFov(aspect: number): number {
    const halfTan = Math.tan((this.fov * DEG_TO_RAD) / 2) / aspect;
    return Math.min(this.maxFov, 2 * Math.atan(halfTan) * RAD_TO_DEG);
  }
}
