/**
 * The brush: one action map and one `Script` that turns a drag on the canvas into `setHeights`.
 *
 * Two things make this affordable. A pointer position is already in **backing-store pixels**, which
 * is the space `Camera.screenToRay` takes, so no DOM conversion is needed; and `Terrain.raycast`
 * marches the height field on the CPU, so the ground answers where the ray meets it without a
 * collider, a physics step, or a GPU readback.
 *
 * The brush is applied on a timer rather than every frame. One `setHeights` rewrites the positions
 * and normals of every chunk the rectangle touches, raises `onHeightsChanged`, and through that
 * signal rebuilds the collider and replaces the foliage — real work that a 240 Hz browser should
 * not do four times as often as a 60 Hz one.
 */

import { createRay, createTerrainHit, defineInputActions, f32, Script } from "ignifx";
import type { Camera, InputActionsDefinition, ScriptCallbacks, Terrain } from "ignifx";

/** The action map the brush reads. */
export const SCULPT_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: "Sculpt",
      actions: [
        { name: "sculptPress", bindings: [{ path: "<Pointer>/press" }] },
        { name: "sculptPosition", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
      ],
    },
  ],
});

/** What the brush does to the ground under it. */
export const SCULPT_MODES = ["Raise", "Lower", "Smooth"] as const;

/** One of {@link SCULPT_MODES}. */
export type SculptMode = (typeof SCULPT_MODES)[number];

/** How often the brush is applied while the pointer is down, in seconds. */
const APPLY_INTERVAL = 1 / 12;

/**
 * Raises, lowers and smooths the terrain under the pointer.
 *
 * @example
 * ```ts
 * const brush = app.world.createEntity("Brush").addComponent(Sculptor);
 * brush.ground = ground;
 * brush.camera = camera;
 * ```
 */
export class Sculptor
  extends Script.define({
    radius: f32(7, { min: 1, tooltip: "The brush's radius on the ground, in metres." }),
    strength: f32(6, { min: 0, tooltip: "Metres of height change per second at the brush's centre." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "terrain-sculpt/Sculptor";

  /** The ground to reshape. Assigned in code. */
  ground: Terrain | null = null;

  /** The camera the pointer ray comes from. Assigned in code. */
  camera: Camera | null = null;

  /** What the brush does. The panel writes it. */
  mode: SculptMode = "Raise";

  /** How many times the brush has been applied, for the panel's readout. */
  strokes = 0;

  /** Reused so a stroke allocates nothing after the first (coding standards §7). */
  readonly #ray = createRay();

  /** Where the ray met the ground. */
  readonly #hit = createTerrainHit();

  /** The sample grid the ray hit, as `[ix, iz]`. */
  readonly #sample = new Float32Array(2);

  /** The heights being written; grown when the brush does. */
  #patch = new Float32Array(0);

  /** Seconds left before the brush may apply again. */
  #cooldown = 0;

  /**
   * Applies the brush while the pointer is down.
   *
   * @param dt - Seconds since the previous frame.
   */
  update(dt: number): void {
    this.#cooldown -= dt;
    const ground = this.ground;
    const camera = this.camera;
    const press = this.app.input.actions.find("sculptPress");
    const at = this.app.input.actions.find("sculptPosition");
    if (ground === null || camera === null || press === null || at === null) {
      return;
    }
    // The UI overlay masks the pointer while a slider is being dragged, so a drag that started on
    // the panel never digs a hole in the ground.
    if (!press.isPressed || this.app.input.uiHasPointer || this.#cooldown > 0) {
      return;
    }
    if (camera.screenToRay(at.vector.x, at.vector.y, this.#ray) === null || !ground.raycast(this.#ray, this.#hit)) {
      return;
    }
    this.#cooldown = APPLY_INTERVAL;
    this.#apply(ground, APPLY_INTERVAL);
  }

  /**
   * Writes one stamp of the brush into the height field.
   *
   * @param ground - The terrain being reshaped.
   * @param seconds - How much of a second this stamp is worth.
   */
  #apply(ground: Terrain, seconds: number): void {
    ground.worldToSample(this.#hit.point.x, this.#hit.point.z, this.#sample);
    const spacing = ground.size.width / (ground.resolution - 1);
    const reach = Math.max(1, Math.round(this.radius / spacing));
    const centreX = Math.round(this.#sample[0] ?? 0);
    const centreZ = Math.round(this.#sample[1] ?? 0);
    const x0 = Math.max(0, centreX - reach);
    const z0 = Math.max(0, centreZ - reach);
    const x1 = Math.min(ground.resolution - 1, centreX + reach);
    const z1 = Math.min(ground.resolution - 1, centreZ + reach);
    const width = x1 - x0 + 1;
    const depth = z1 - z0 + 1;
    if (width <= 0 || depth <= 0) {
      return;
    }
    if (this.#patch.length < width * depth) {
      this.#patch = new Float32Array(width * depth);
    }
    const heights = ground.heights;
    const resolution = ground.resolution;
    const amount = this.strength * seconds;
    const sign = this.mode === "Lower" ? -1 : 1;
    for (let row = 0; row < depth; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const sx = x0 + column;
        const sz = z0 + row;
        const index = sz * resolution + sx;
        const here = heights[index] ?? 0;
        const distance = Math.hypot(sx - centreX, sz - centreZ) / reach;
        // A cosine falloff, so a stroke leaves a dome rather than a cylinder with a visible rim.
        const falloff = distance >= 1 ? 0 : 0.5 + 0.5 * Math.cos(distance * Math.PI);
        this.#patch[row * width + column] =
          this.mode === "Smooth"
            ? here + (average(heights, resolution, sx, sz) - here) * falloff
            : here + sign * amount * falloff;
      }
    }
    ground.setHeights(x0, z0, width, depth, this.#patch);
    this.strokes += 1;
  }
}

/**
 * The mean of a sample and its four neighbours, clamped at the field's edge.
 *
 * @param heights - The live height field.
 * @param resolution - Samples per side.
 * @param x - The sample column.
 * @param z - The sample row.
 * @returns The mean height, in metres.
 */
function average(heights: Float32Array, resolution: number, x: number, z: number): number {
  const last = resolution - 1;
  const left = heights[z * resolution + Math.max(0, x - 1)] ?? 0;
  const right = heights[z * resolution + Math.min(last, x + 1)] ?? 0;
  const back = heights[Math.max(0, z - 1) * resolution + x] ?? 0;
  const front = heights[Math.min(last, z + 1) * resolution + x] ?? 0;
  const here = heights[z * resolution + x] ?? 0;
  return (left + right + back + front + here) / 5;
}
