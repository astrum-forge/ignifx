/**
 * The two meshes this example builds in code, because both of them are *about* their vertices.
 *
 * @remarks
 * `MeshAsset.plane` is one quad and `MeshAsset.ground` lies in XZ, and a flag needs a grid that
 * stands up with a UV running from the hoist to the fly. `MeshAsset.fromData` takes the three
 * arrays a mesh actually is — positions, normals, indices — plus the UVs, and publishes them as an
 * asset like any primitive factory.
 *
 * The UV layout is the contract with the shaders beside this file, so it is written down here and
 * nowhere else: **`uv.x` runs from the anchored edge to the free one, and `uv.y` runs from the root
 * to the tip.** `flag.wgsl` multiplies its wave by `uv.x`, which pins the hoist; `grass.wgsl`
 * squares `uv.y`, which plants the root and tightens the bend towards the top.
 */

import { MeshAsset } from "ignifx";
import type { App, AssetHandle } from "ignifx";

/** How many floats a position or a normal holds. */
const VECTOR3 = 3;

/**
 * Builds a subdivided quad standing in the XY plane, facing `+Z`, with its anchored edge at `x = 0`.
 *
 * @param app - The app whose engine uploads the geometry.
 * @param width - How far the cloth reaches from the pole, in metres.
 * @param height - How tall it is, in metres.
 * @param columns - Quads along the length. The wave's smoothness is this number.
 * @param rows - Quads up the height.
 * @returns The handle, with one holder — the caller.
 */
export function createFlagMesh(
  app: App,
  width: number,
  height: number,
  columns: number,
  rows: number,
): AssetHandle<MeshAsset> {
  const vertices = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertices * VECTOR3);
  const normals = new Float32Array(vertices * VECTOR3);
  const uvs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(columns * rows * 6);
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const index = row * (columns + 1) + column;
      const u = column / columns;
      const v = row / rows;
      positions[index * VECTOR3] = u * width;
      positions[index * VECTOR3 + 1] = v * height;
      positions[index * VECTOR3 + 2] = 0;
      normals[index * VECTOR3 + 2] = 1;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }
  return MeshAsset.fromData(app, "vertex-animation/flag", { positions, normals, indices, uvs });
}

/**
 * Builds a tuft of grass blades: one quad each, scattered in a disc and turned to face any which
 * way, with `uv.y` running from root to tip.
 *
 * @remarks
 * One mesh, one draw call, and every blade bends on its own because `grass.wgsl` hashes the blade's
 * **world** position into the gust term. Real foliage at scale goes through `InstancedMeshRenderer`
 * or `TerrainScatter`; a tuft is small enough that one baked mesh is the honest answer.
 *
 * @param app - The app whose engine uploads the geometry.
 * @param blades - How many blades the tuft holds.
 * @param radius - The disc the roots are scattered over, in metres.
 * @param random - The kit's seeded generator, so the same seed grows the same tuft.
 * @returns The handle, with one holder — the caller.
 */
export function createGrassMesh(
  app: App,
  blades: number,
  radius: number,
  random: () => number,
): AssetHandle<MeshAsset> {
  const positions = new Float32Array(blades * 4 * VECTOR3);
  const normals = new Float32Array(blades * 4 * VECTOR3);
  const uvs = new Float32Array(blades * 4 * 2);
  const indices = new Uint32Array(blades * 6);
  for (let blade = 0; blade < blades; blade += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const rootX = Math.cos(angle) * distance;
    const rootZ = Math.sin(angle) * distance;
    const yaw = random() * Math.PI;
    const halfWidth = 0.055;
    const height = 0.3 + random() * 0.28;
    // The blade lies in the plane its yaw turns it into, so a tuft has depth from every angle.
    const dx = Math.cos(yaw) * halfWidth;
    const dz = Math.sin(yaw) * halfWidth;
    const corners: readonly (readonly [number, number, number, number, number])[] = [
      [rootX - dx, 0, rootZ - dz, 0, 0],
      [rootX + dx, 0, rootZ + dz, 1, 0],
      [rootX - dx, height, rootZ - dz, 0, 1],
      [rootX + dx, height, rootZ + dz, 1, 1],
    ];
    for (let corner = 0; corner < 4; corner += 1) {
      const source = corners[corner] ?? [0, 0, 0, 0, 0];
      const index = blade * 4 + corner;
      positions[index * VECTOR3] = source[0];
      positions[index * VECTOR3 + 1] = source[1];
      positions[index * VECTOR3 + 2] = source[2];
      // The quad's own normal, so `grass.wgsl`'s lambert term has a direction to work with.
      normals[index * VECTOR3] = -Math.sin(yaw);
      normals[index * VECTOR3 + 2] = Math.cos(yaw);
      uvs[index * 2] = source[3];
      uvs[index * 2 + 1] = source[4];
    }
    const base = blade * 4;
    indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], blade * 6);
  }
  return MeshAsset.fromData(app, "vertex-animation/grass", { positions, normals, indices, uvs });
}
