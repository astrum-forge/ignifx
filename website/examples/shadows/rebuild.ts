/**
 * What a shadow setting can and cannot change while a game is running, and the two-frame rebuild
 * that makes the changeable half land.
 *
 * @remarks
 * **Only `shadows.enabled` is live.** Everything else in a `Light`'s `shadows` record — the
 * technique, the map size, the depth and normal biases, the darkness, the cascade count and the
 * shadow distance — is read exactly once, when the component builds its generator:
 * `packages/core/src/render/gpu/light-shadows.ts` maps the record onto Babylon Lite's configuration
 * at that moment and never looks at it again, and `Light.sync` only compares whether casting is
 * wanted against whether a generator is attached. Writing `shadows.mapSize = 2048` on a light
 * that is already casting therefore changes nothing at all, silently.
 *
 * So a graphics menu that offers shadow quality has to drop the generator and build another, which
 * is what {@link ShadowRebuild} does.
 *
 * ## The technique is the exception, and it needs a reload
 *
 * A renderable bakes the shadow bind group's **layout** when the scene's material groups are built
 * — a single 2D depth texture for PCF, a float colour texture for ESM, a four-layer depth array for
 * CSM — and `rebuildSceneRenderables` does not re-pick it. So dropping the generator and building
 * one of a different kind binds the new texture to the old layout. Measured on 2026-09-08 in
 * Chromium: PCF to ESM binds an `RGBA16Float` map where the shader declares `Depth`, and PCF to CSM
 * binds a four-layer array view where it declares a single 2D view, after which the frame is black.
 * Each technique is correct when it is the one the scene started with, so the technique is chosen
 * per page load, through `?technique=`, and everything else is changed in place.
 */

import { Light, Script, SHADOW_TECHNIQUES, u32 } from "ignifx";
import type { ScriptCallbacks, ShadowTechniqueName } from "ignifx";

/** The query parameter the technique is carried in, so a reload keeps it. */
const TECHNIQUE_PARAM = "technique";

/**
 * The shadow technique this page load was asked for.
 *
 * @param fallback - The technique to use when the query names none, or names one Lite has not got.
 * @returns The technique.
 *
 * @example
 * ```ts
 * light.shadows.technique = readTechnique("pcf");
 * ```
 */
export function readTechnique(fallback: ShadowTechniqueName): ShadowTechniqueName {
  const asked = new URLSearchParams(window.location.search).get(TECHNIQUE_PARAM);
  return SHADOW_TECHNIQUES.find((name: ShadowTechniqueName) => name === asked) ?? fallback;
}

/**
 * Reloads the frame with a different shadow technique, which is the only way to change one.
 *
 * @remarks
 * The module comment says why. The rest of the query is kept, so a capture opened at
 * `?static=1&nopanel=1&seed=1` stays a capture.
 *
 * @param technique - The technique to load with.
 *
 * @example
 * ```ts
 * select("Technique", labels, { value: label, change: () => { loadWithTechnique("esm"); } });
 * ```
 */
export function loadWithTechnique(technique: ShadowTechniqueName): void {
  const url = new URL(window.location.href);
  url.searchParams.set(TECHNIQUE_PARAM, technique);
  window.location.assign(url.toString());
}

/**
 * Re-attaches its light's shadow generator, which is the only way a changed shadow setting lands.
 *
 * @remarks
 * Put it on the light's own entity; it finds the `Light` itself. Every panel row that writes into
 * `shadows` calls {@link ShadowRebuild.request}, and the script then waits `quietFrames` frames
 * with no further request before it drops the generator — so dragging a slider costs one rebuild at
 * the end of the drag rather than one per pointer event, which matters when the map is 4096 texels
 * of depth texture. The rebuild itself takes two frames: `enabled = false` in the first, which is
 * what makes `Light.sync` release the generator, and `enabled = true` in the second, which builds a
 * new one from whatever the record now says.
 *
 * @example
 * ```ts
 * const rebuild = lightEntity.addComponent(ShadowRebuild);
 * light.shadows.mapSize = 2048;
 * rebuild.request();
 * ```
 */
export class ShadowRebuild extends Script.define({ quietFrames: u32(8) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "shadows/ShadowRebuild";

  #light: Light | null = null;

  /** Frames left to wait before dropping the generator; `-1` when nothing is pending. */
  #countdown = -1;

  /** Whether the next frame should build the new generator. */
  #isReattaching = false;

  /** Whether the visitor wants shadows at all; a rebuild must not switch them back on. */
  #isCasting = true;

  /** How many generators have been built since the page loaded. */
  #rebuilds = 0;

  /**
   * How many shadow generators this light has built, which is the number the panel reports.
   *
   * @returns The count, starting at zero for the one the scene was authored with.
   */
  get rebuilds(): number {
    return this.#rebuilds;
  }

  /** Finds the light this script rebuilds the generator of. */
  awake(): void {
    this.#light = this.entity.getComponent(Light);
  }

  /** Asks for a rebuild once the panel has stopped changing things. */
  request(): void {
    this.#countdown = this.quietFrames;
  }

  /**
   * Switches casting on or off, which is the one shadow field that *is* live.
   *
   * @param casting - Whether the light should cast.
   */
  setCasting(casting: boolean): void {
    this.#isCasting = casting;
    this.#countdown = -1;
    this.#isReattaching = false;
    const light = this.#light;
    if (light !== null) {
      light.shadows.enabled = casting;
    }
  }

  /** Runs the two-frame rebuild, once the requests have gone quiet. */
  update(): void {
    const light = this.#light;
    if (light === null || !this.#isCasting) {
      return;
    }
    if (this.#isReattaching) {
      this.#isReattaching = false;
      light.shadows.enabled = true;
      this.#rebuilds += 1;
      return;
    }
    if (this.#countdown < 0) {
      return;
    }
    this.#countdown -= 1;
    if (this.#countdown < 0) {
      light.shadows.enabled = false;
      this.#isReattaching = true;
    }
  }
}
