import { hashToUnit, pcg3d } from "../emitter/pcg3d.js";

// The positional noise both evaluators add (`docs/plan/2026-09-terrain-particles-shaders.md` §4.1):
// classic lattice gradient noise with a quintic fade, hashed per corner with `pcg3d`. The WGSL in
// `src/gpu/wgsl.ts` is the same code, and negative cells hash the same on both hosts.

/** The offset of the second noise channel. */
const OFFSET_Y: readonly number[] = Object.freeze([31.4, 47.2, 12.9]);

/** The offset of the third noise channel. */
const OFFSET_Z: readonly number[] = Object.freeze([-17.3, 8.6, 53.1]);

/**
 * The quintic fade both hosts blend with.
 *
 * @param t - The fraction inside the cell.
 * @returns The eased fraction.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * The dot product of a corner's hashed gradient with the offset from that corner.
 *
 * @param ix - The corner's lattice X.
 * @param iy - The corner's lattice Y.
 * @param iz - The corner's lattice Z.
 * @param dx - The offset from the corner.
 * @param dy - The offset from the corner.
 * @param dz - The offset from the corner.
 * @param scratch - Three words of scratch space.
 * @returns The corner's contribution before blending.
 */
function corner(ix: number, iy: number, iz: number, dx: number, dy: number, dz: number, scratch: Uint32Array): number {
  pcg3d(ix >>> 0, iy >>> 0, iz >>> 0, scratch);
  const gx = hashToUnit(scratch[0] ?? 0) * 2 - 1;
  const gy = hashToUnit(scratch[1] ?? 0) * 2 - 1;
  const gz = hashToUnit(scratch[2] ?? 0) * 2 - 1;
  return gx * dx + gy * dy + gz * dz;
}

/**
 * One scalar of lattice gradient noise at a point.
 *
 * @param x - The sample position.
 * @param y - The sample position.
 * @param z - The sample position.
 * @param scratch - Three words of scratch space.
 * @returns The noise value, in roughly `[-1, 1]`.
 *
 * @beta
 */
export function gradientNoise(x: number, y: number, z: number, scratch: Uint32Array): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const c000 = corner(ix, iy, iz, fx, fy, fz, scratch);
  const c100 = corner(ix + 1, iy, iz, fx - 1, fy, fz, scratch);
  const c010 = corner(ix, iy + 1, iz, fx, fy - 1, fz, scratch);
  const c110 = corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz, scratch);
  const c001 = corner(ix, iy, iz + 1, fx, fy, fz - 1, scratch);
  const c101 = corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1, scratch);
  const c011 = corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1, scratch);
  const c111 = corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1, scratch);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

/**
 * Three decorrelated noise channels at a point, summed over one or two octaves.
 *
 * @param x - The sample position.
 * @param y - The sample position.
 * @param z - The sample position.
 * @param octaves - `1` or `2`.
 * @param scratch - Three words of scratch space.
 * @param out - Receives the three channels.
 * @returns `out`.
 *
 * @beta
 */
export function noise3(
  x: number,
  y: number,
  z: number,
  octaves: number,
  scratch: Uint32Array,
  out: Float32Array,
): Float32Array {
  let nx = gradientNoise(x, y, z, scratch);
  let ny = gradientNoise(x + (OFFSET_Y[0] ?? 0), y + (OFFSET_Y[1] ?? 0), z + (OFFSET_Y[2] ?? 0), scratch);
  let nz = gradientNoise(x + (OFFSET_Z[0] ?? 0), y + (OFFSET_Z[1] ?? 0), z + (OFFSET_Z[2] ?? 0), scratch);
  if (octaves >= 2) {
    const x2 = x * 2;
    const y2 = y * 2;
    const z2 = z * 2;
    nx += 0.5 * gradientNoise(x2, y2, z2, scratch);
    ny += 0.5 * gradientNoise(x2 + (OFFSET_Y[0] ?? 0), y2 + (OFFSET_Y[1] ?? 0), z2 + (OFFSET_Y[2] ?? 0), scratch);
    nz += 0.5 * gradientNoise(x2 + (OFFSET_Z[0] ?? 0), y2 + (OFFSET_Z[1] ?? 0), z2 + (OFFSET_Z[2] ?? 0), scratch);
  }
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  return out;
}
