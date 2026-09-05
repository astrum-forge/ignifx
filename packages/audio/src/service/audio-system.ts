import type { AudioService } from "./audio-service.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The `PreRender` system that advances everything time-based in the audio subsystem
 * (`docs/architecture/01-lifecycle-and-time.md` §3 step 10, `10-audio.md` §3).
 *
 * In a browser its most visible job is the one Babylon Lite names: pumping `updateSpatialAudio`
 * (`index.d.ts` 13351), which re-reads the world matrix of every attached source and of the
 * listener. Lite offers to do that from its own `requestAnimationFrame` loop instead
 * (`setSpatialAutoUpdate`, `index.d.ts` 11001), and ignifx switches that off: a second loop would
 * read transforms at an undefined point relative to the frame, and `CONSTITUTION.md` §3.2 gives
 * ignifx exactly one loop.
 *
 * Everything else the system does is backend-independent, which is why it is one system and not
 * two: fades advance, pending stops come due, `app.pause()` takes effect, simulated playback moves
 * on, `onEnded` is raised, and the diagnostics counters are sampled — all from `ctx.dt`.
 */

/**
 * Where the audio pump sits inside `PreRender`.
 *
 * @remarks
 * After physics interpolation (`-500`, `04-extensions.md` §1) so that a source attached to an
 * interpolated body is heard from its display pose, and well before the render sync (`900`,
 * `packages/core/src/render/render-sync-system.ts`) so that nothing audio does can disturb what is
 * drawn. Extensions use `[1001, 9999]` by convention for systems that must follow every core one;
 * audio has to interleave with core's own ordering instead, which is what the negative number says.
 *
 * @public
 */
export const AUDIO_PUMP_ORDER = -400;

/**
 * Advances the audio subsystem once per frame.
 *
 * @internal
 */
export class AudioSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/audio-pump";

  readonly #service: AudioService;

  /**
   * Creates the system.
   *
   * @param service - The service to pump.
   */
  constructor(service: AudioService) {
    this.#service = service;
  }

  /**
   * Runs one frame of audio.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    this.#service.pump(ctx.dt);
  }
}
