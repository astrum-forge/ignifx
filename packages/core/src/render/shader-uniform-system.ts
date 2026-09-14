import { entityInternals } from "../entity/internals.js";
import { readWorldMatrix } from "../lite/node.js";
import { Color } from "../math/color.js";
import { Light } from "./light.js";
import { RENDER_SYNC_ORDER } from "./render-sync-system.js";
import { rendererInternals } from "./renderer.js";
import { shaderSupport } from "./shader-support.js";
import type { App, System, SystemContext } from "../app/types.js";
import type { World } from "../world/world.js";

/**
 * The `PreRender` system that writes the ignifx-provided uniforms of every live shader material
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * Lite's shader materials get transforms, the camera position, the screen size and the alpha cutoff
 * for free and nothing else — no clock, no lights, no shadows (`index.d.ts` 11432) — so a file that
 * declares `// @ignifx system time, mainLightDirection` gets those from here.
 *
 * It runs at `RENDER_SYNC_ORDER - 10`, so a material rebuilt by `setDefine` or a hot reload is
 * written before `RenderSyncSystem` hands the new Lite material to the meshes wearing it, and it
 * allocates nothing per frame (coding standards §7).
 *
 * The clock is accumulated here rather than read from `app.time.time` because a system keeps running
 * with a non-zero `dt` while the app is paused and has to check `time.paused` itself
 * (`docs/architecture/01-lifecycle-and-time.md` §7); that is what freezes `time` under
 * `app.pause()` and resumes it without a jump.
 */

/**
 * Where the shader uniform writer sits inside `PreRender`: just before the render sync
 * (`src/render/render-sync-system.ts`).
 *
 * @internal
 */
export const SHADER_UNIFORM_ORDER: number = RENDER_SYNC_ORDER - 10;

/** How many elements a 4x4 matrix has. */
const MATRIX_LENGTH = 16;

/** Where the world-space forward axis starts inside a column-major world matrix. */
const FORWARD_COLUMN = 8;

/** Where `mainLightDirection` starts inside the frame buffer. */
const DIRECTION_OFFSET = 0;

/** Where `mainLightColor` starts inside the frame buffer. */
const COLOR_OFFSET = 3;

/** Where `ambientColor` starts inside the frame buffer. */
const AMBIENT_OFFSET = 6;

/** How many floats the per-frame light buffer holds: direction, colour, ambient. */
const FRAME_FLOATS = 9;

/**
 * Writes `time`, `unscaledTime`, `deltaTime`, `mainLightDirection`, `mainLightColor`, and
 * `ambientColor` onto every shader material that declares them, once per frame.
 *
 * @internal
 */
export class ShaderUniformSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/shader-uniforms";

  readonly #app: App;

  /** Direction, linear colour times intensity, and ambient — the nine floats a material compares. */
  readonly #frame = new Float32Array(FRAME_FLOATS);

  readonly #matrix = new Float64Array(MATRIX_LENGTH);

  readonly #ambient = new Float32Array(3);

  /** Scaled seconds accumulated in the frames where the app was not paused. */
  #time = 0;

  /** Unscaled seconds accumulated in the frames where the app was not paused. */
  #unscaledTime = 0;

  /**
   * Creates the system.
   *
   * @param app - The app whose shader materials it writes.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * Writes this frame's uniforms.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    const time = ctx.time;
    const isPaused = time.paused;
    if (!isPaused) {
      this.#time += time.deltaTime;
      this.#unscaledTime += time.unscaledDeltaTime;
    }
    const support = shaderSupport();
    if (support === null) {
      return;
    }
    const materials = support.shaderMaterialsOf(this.#app).animated;
    if (materials.length === 0) {
      return;
    }
    const hasLight = this.#readMainLight(ctx.world);
    this.#readAmbient();
    const delta = isPaused ? 0 : time.deltaTime;
    for (let index = 0; index < materials.length; index += 1) {
      materials[index]?.writeFrameUniforms(this.#time, this.#unscaledTime, delta, this.#frame, hasLight);
    }
  }

  /**
   * Finds the highest-intensity enabled directional light and writes its world direction and its
   * linear colour times its intensity into the frame buffer.
   *
   * @remarks
   * The direction is the entity's world forward axis, read out of the world matrix's third column —
   * the same axis `Light` itself writes onto the Lite light
   * (`docs/architecture/07-rendering.md` §2.2) — and normalised, which the plan's §3.1 promises and
   * a scaled light entity would otherwise break. Lite's own PBR normalises in WGSL, so the two
   * agree.
   *
   * @param world - The world being rendered.
   * @returns `true` when a light supplied the values; `false` after zeroing them.
   */
  #readMainLight(world: World): boolean {
    const lights = world.components(Light);
    let best: Light | null = null;
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined || light.type !== "directional" || !light.isEnabledInHierarchy) {
        continue;
      }
      if (best === null || light.intensity > best.intensity) {
        best = light;
      }
    }
    const frame = this.#frame;
    if (best === null) {
      frame[DIRECTION_OFFSET] = 0;
      frame[DIRECTION_OFFSET + 1] = 0;
      frame[DIRECTION_OFFSET + 2] = 0;
      frame[COLOR_OFFSET] = 0;
      frame[COLOR_OFFSET + 1] = 0;
      frame[COLOR_OFFSET + 2] = 0;
      return false;
    }
    // `worldMatrix` recomputes up the parent chain on read, so a light whose parent moved this
    // frame reports the pose Lite is about to read.
    const matrix = readWorldMatrix(entityInternals(best.entity).node, this.#matrix);
    const x = matrix[FORWARD_COLUMN] ?? 0;
    const y = matrix[FORWARD_COLUMN + 1] ?? 0;
    const z = matrix[FORWARD_COLUMN + 2] ?? 1;
    // The plan promises a unit vector, and a scaled light entity leaves the column scaled.
    const length = Math.sqrt(x * x + y * y + z * z);
    const scale = length > 0 ? 1 / length : 0;
    frame[DIRECTION_OFFSET] = x * scale;
    frame[DIRECTION_OFFSET + 1] = y * scale;
    frame[DIRECTION_OFFSET + 2] = z * scale;
    const color = best.color;
    const intensity = best.intensity;
    frame[COLOR_OFFSET] = Color.srgbToLinear(color.r) * intensity;
    frame[COLOR_OFFSET + 1] = Color.srgbToLinear(color.g) * intensity;
    frame[COLOR_OFFSET + 2] = Color.srgbToLinear(color.b) * intensity;
    return true;
  }

  /**
   * Writes the installed environment's ambient irradiance into the frame buffer, or zeros.
   *
   * @remarks
   * The value is the `L00` band of the environment's diffuse spherical harmonics, which is the same
   * number a shader can read directly as `scene.vSphericalL00.rgb`. Reaching it needs one Babylon
   * Lite field `index.d.ts` does not declare; `src/lite/gpu/shader-material.ts` records why. A world
   * with no environment, and a headless app, upload zeros.
   */
  #readAmbient(): void {
    const frame = this.#frame;
    const module = shaderSupport()?.shaderMaterialAdapter() ?? null;
    const ambient = this.#ambient;
    const read = module !== null && module.readSceneAmbient(rendererInternals(this.#app.renderer).scene, ambient);
    if (read) {
      frame.set(ambient, AMBIENT_OFFSET);
    } else {
      frame.fill(0, AMBIENT_OFFSET, AMBIENT_OFFSET + 3);
    }
  }
}
