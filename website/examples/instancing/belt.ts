/**
 * The asteroid belt's geometry: where the 20,000 rocks sit, and the matrix slab that says so.
 *
 * @remarks
 * Split out of `main.ts` because none of it is a lesson about instancing — it is a seeded ring of
 * placements and the sixteen floats each one becomes. What *is* worth reading here is the layout
 * rule the slab obeys, because getting it wrong is the usual first failure: **sixteen floats per
 * instance, column-major**, the same order `Transform.worldMatrix` and Babylon Lite's `Mat4` already
 * use, with the translation in elements 12, 13 and 14.
 *
 * The slab is written once, in `setup`, and never again: nothing here animates. A belt that turned
 * would mutate this same array in place and call `markDirty()`, which is the point of the component
 * handing Lite the caller's memory rather than copying it.
 */

/** How many floats one instance matrix occupies. */
const FLOATS_PER_MATRIX = 16;

/** The shot the example opens on. */
export const SHOT = {
  fov: 40,
  yaw: 18,
  pitch: 27,
  distance: 104,
  target: { x: 0, y: 0, z: 0 },
} as const;

/** The near-black of space the frame is cleared to. */
export const CLEAR_COLOR = { r: 0.008, g: 0.009, b: 0.014, a: 1 } as const;

/** How many rocks the slab holds, and the renderer's capacity. */
export const CAPACITY = 20_000;

/** The belt's shape, in metres. */
export const BELT = {
  /** The radius the ring is centred on. */
  radius: 44,
  /** How far in and out of that radius a rock may scatter. */
  spread: 13,
  /** How far above and below the plane a rock may scatter. */
  thickness: 3.4,
  /** The smallest rock's diameter. */
  minSize: 0.22,
  /** The largest rock's diameter. */
  maxSize: 1.15,
} as const;

/** The prototype mesh, and the coarse partner drawn past {@link LOD.distance}. */
export const MESH = { segments: 10, lodSegments: 4, diameter: 1 } as const;

/** Where an instance switches to the coarse mesh, and how wide the dither window is. */
export const LOD = { distance: 46, band: 12 } as const;

/**
 * Fills a matrix slab with a seeded ring of rocks.
 *
 * @remarks
 * The composition is a **ring**, not a disc, because a disc at this count reads as noise: a torus
 * of rocks has a near edge, a far edge and a hole, which is what makes 20,000 of something legible.
 * Each rock gets a scale, a yaw and a pitch, so the same low-poly sphere never appears twice at the
 * same orientation.
 *
 * @param slab - The array to fill; at least `count * 16` floats.
 * @param count - How many instances to write.
 * @param random - The kit's seeded generator, so the same seed lays out the same belt.
 */
export function layOutBelt(slab: Float32Array, count: number, random: () => number): void {
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    // The square root is what spreads the rocks evenly through the annulus: without it they pile up
    // against the inner edge, because a ring's area grows with its radius.
    const radius = BELT.radius + (Math.sqrt(random()) - 0.5) * 2 * BELT.spread;
    const height = (random() - 0.5) * 2 * BELT.thickness;
    const size = BELT.minSize + random() * (BELT.maxSize - BELT.minSize);
    writeMatrix(
      slab,
      index,
      Math.cos(angle) * radius,
      height,
      Math.sin(angle) * radius,
      size,
      random() * Math.PI * 2,
      random() * Math.PI * 2,
    );
  }
}

/**
 * Writes one instance's sixteen column-major floats: a uniform scale, a yaw, a pitch, a position.
 *
 * @param slab - The array to write into.
 * @param index - Which instance.
 * @param x - Metres along X.
 * @param y - Metres along Y.
 * @param z - Metres along Z.
 * @param scale - The uniform scale.
 * @param yaw - Rotation about Y, in radians.
 * @param pitch - Rotation about X, in radians.
 */
function writeMatrix(
  slab: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  yaw: number,
  pitch: number,
): void {
  const base = index * FLOATS_PER_MATRIX;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // R = Ry(yaw) * Rx(pitch), scaled, written column by column.
  slab[base] = cy * scale;
  slab[base + 1] = 0;
  slab[base + 2] = -sy * scale;
  slab[base + 3] = 0;
  slab[base + 4] = sy * sp * scale;
  slab[base + 5] = cp * scale;
  slab[base + 6] = cy * sp * scale;
  slab[base + 7] = 0;
  slab[base + 8] = sy * cp * scale;
  slab[base + 9] = -sp * scale;
  slab[base + 10] = cy * cp * scale;
  slab[base + 11] = 0;
  slab[base + 12] = x;
  slab[base + 13] = y;
  slab[base + 14] = z;
  slab[base + 15] = 1;
}
