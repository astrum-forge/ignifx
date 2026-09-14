/**
 * The one moving part of this example: the script that decays the hit flash.
 *
 * @remarks
 * A game's damage response is exactly this — a uniform driven to 1 at the moment of the hit and
 * eased back to 0 over a fifth of a second — and it is a `Script` rather than a tween because
 * `app.tweens` moves *fields on an object*, and a surface shader's uniforms live inside the host
 * material's uniform block and are reached through {@link SurfaceShaderBinding.set}.
 *
 * Writing a value is the cheap path: it re-uploads the host material's uniform block and recompiles
 * nothing. Toggling `enabled` or binding a texture is the expensive one — both change Babylon
 * Lite's pipeline cache key — which is why the panel's per-shader toggles are settings and this is
 * a per-frame animation.
 *
 * `update` is not called while `app.pause()` holds and is called with `dt === 0` under `?static=1`,
 * so a capture always shows the flash at rest.
 */

import { f32, Script } from "ignifx";
import type { ScriptCallbacks, SurfaceShaderBinding } from "ignifx";

/** Drives one surface shader's `flash` uniform from 1 back down to 0. */
export class HitFlash
  extends Script.define({
    seconds: f32(0.32, { min: 0.05, tooltip: "How long the flash takes to fade out." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "ignifx-example/HitFlash";

  /** The shader whose `flash` uniform this drives. Assigned after `addComponent`. */
  binding: SurfaceShaderBinding | null = null;

  /** The uniform's name, as the `.surface.wgsl` file declares it. */
  uniform = "flash";

  /** How much of the flash is left, `1` at the moment of the hit. */
  #level = 0;

  /** Starts a flash, or restarts one already in flight. */
  hit(): void {
    this.#level = 1;
    this.#write();
  }

  /**
   * Eases the level back to zero.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`.
   */
  update(dt: number): void {
    if (this.#level <= 0) {
      return;
    }
    this.#level = Math.max(0, this.#level - dt / Math.max(this.seconds, 0.05));
    this.#write();
  }

  /** Writes the current level onto the shader, squared so the tail is short and the head is bright. */
  #write(): void {
    this.binding?.set(this.uniform, this.#level * this.#level);
  }
}
