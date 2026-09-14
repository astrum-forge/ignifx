/**
 * The two meshes the scatter draws, built in code with `MeshAsset.fromData` so the example ships
 * no model files: a crossed grass card and a small conifer.
 *
 * Both are authored with their origin **at the base**, because a `TerrainScatter` places an
 * instance at the ground and turns it about Y there. The conifer reads one 64x64 atlas whose top
 * half is leaf and whose bottom half is bark, so one material and one draw call cover a whole
 * forest. The engine's texture loader defaults to `invertY: true`, so `v = 1` is the image's top
 * row — which is why the leaf band below is the high `v` and not the low one.
 */

import { MeshAsset } from "ignifx";
import type { App, AssetHandle } from "ignifx";

/** The `v` of the trunk's root: the bottom row of the atlas, kept off the very edge. */
const BARK_ROOT_V = 0.03;

/** The `v` of the trunk's top, which is the middle of the atlas. */
const BARK_TOP_V = 0.46;

/** The `v` of a canopy's lower rim: just above the middle of the atlas. */
const LEAF_RIM_V = 0.54;

/** The `v` of a canopy's apex: the top row of the atlas. */
const LEAF_APEX_V = 0.97;

/**
 * Builds a crossed grass card: two quads at right angles, rooted at the origin.
 *
 * @param app - The app whose asset service registers the mesh.
 * @param name - The asset name.
 * @param quads - How many quads to cross; `1` is the flat card the LOD partner uses.
 * @returns The handle, with one holder — the caller.
 */
export function grassCard(app: App, name: string, quads: number): AssetHandle<MeshAsset> {
  const positions = new Float32Array(quads * 12);
  const normals = new Float32Array(quads * 12);
  const uvs = new Float32Array(quads * 8);
  const indices = new Uint32Array(quads * 6);
  for (let quad = 0; quad < quads; quad += 1) {
    const angle = (Math.PI * quad) / quads;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const corners = [
      [-dx, 0, -dz],
      [dx, 0, dz],
      [dx, 1, dz],
      [-dx, 1, -dz],
    ];
    for (let corner = 0; corner < 4; corner += 1) {
      const at = (quad * 4 + corner) * 3;
      const point = corners[corner] ?? [0, 0, 0];
      positions[at] = point[0] ?? 0;
      positions[at + 1] = point[1] ?? 0;
      positions[at + 2] = point[2] ?? 0;
      // Straight up, not out of the card's face: a blade lit by its own plane goes black side-on,
      // and grass reads as a lit surface rather than as paper this way.
      normals[at + 1] = 1;
    }
    const uvAt = quad * 8;
    // `v = 0` is the card's root: the loader's `invertY` puts the image's bottom row there, and
    // the generated card draws the blade's root at its bottom.
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], uvAt);
    const base = quad * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], quad * 6);
  }
  return MeshAsset.fromData(app, name, { positions, normals, indices, uvs });
}

/** One mesh under construction: three growing lists and the writer below. */
interface Builder {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

/**
 * Appends one triangle with a flat normal.
 *
 * @param out - The mesh being built.
 * @param a - The first corner, as `[x, y, z, u, v]`.
 * @param b - The second corner.
 * @param c - The third corner.
 */
function triangle(out: Builder, a: readonly number[], b: readonly number[], c: readonly number[]): void {
  const ux = (b[0] ?? 0) - (a[0] ?? 0);
  const uy = (b[1] ?? 0) - (a[1] ?? 0);
  const uz = (b[2] ?? 0) - (a[2] ?? 0);
  const vx = (c[0] ?? 0) - (a[0] ?? 0);
  const vy = (c[1] ?? 0) - (a[1] ?? 0);
  const vz = (c[2] ?? 0) - (a[2] ?? 0);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  for (const corner of [a, b, c]) {
    out.indices.push(out.positions.length / 3);
    out.positions.push(corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0);
    out.normals.push(nx / length, ny / length, nz / length);
    out.uvs.push(corner[3] ?? 0, corner[4] ?? 0);
  }
}

/**
 * Builds a small conifer: a faceted trunk and two stacked cones of foliage.
 *
 * @param app - The app whose asset service registers the mesh.
 * @param name - The asset name.
 * @param sides - Faces around the trunk and each cone; `4` is the LOD partner, `7` the near mesh.
 * @returns The handle, with one holder — the caller.
 */
export function conifer(app: App, name: string, sides: number): AssetHandle<MeshAsset> {
  const out: Builder = { positions: [], normals: [], uvs: [], indices: [] };
  const trunkRadius = 0.16;
  const trunkHeight = 1.5;
  for (let side = 0; side < sides; side += 1) {
    const a = (side / sides) * Math.PI * 2;
    const b = ((side + 1) / sides) * Math.PI * 2;
    const ax = Math.cos(a) * trunkRadius;
    const az = Math.sin(a) * trunkRadius;
    const bx = Math.cos(b) * trunkRadius;
    const bz = Math.sin(b) * trunkRadius;
    const u0 = side / sides;
    const u1 = (side + 1) / sides;
    triangle(out, [ax, 0, az, u0, BARK_ROOT_V], [bx, 0, bz, u1, BARK_ROOT_V], [bx, trunkHeight, bz, u1, BARK_TOP_V]);
    triangle(
      out,
      [ax, 0, az, u0, BARK_ROOT_V],
      [bx, trunkHeight, bz, u1, BARK_TOP_V],
      [ax, trunkHeight, az, u0, BARK_TOP_V],
    );
  }
  const skirts = [
    { base: 1.1, top: 3.1, radius: 1.35 },
    { base: 2.4, top: 4.3, radius: 0.85 },
  ];
  for (const skirt of skirts) {
    for (let side = 0; side < sides; side += 1) {
      const a = (side / sides) * Math.PI * 2;
      const b = ((side + 1) / sides) * Math.PI * 2;
      triangle(
        out,
        [Math.cos(a) * skirt.radius, skirt.base, Math.sin(a) * skirt.radius, side / sides, LEAF_RIM_V],
        [Math.cos(b) * skirt.radius, skirt.base, Math.sin(b) * skirt.radius, (side + 1) / sides, LEAF_RIM_V],
        [0, skirt.top, 0, (side + 0.5) / sides, LEAF_APEX_V],
      );
    }
  }
  return MeshAsset.fromData(app, name, {
    positions: new Float32Array(out.positions),
    normals: new Float32Array(out.normals),
    indices: new Uint32Array(out.indices),
    uvs: new Float32Array(out.uvs),
  });
}
