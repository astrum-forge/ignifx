/**
 * The grass tuft the scatter draws, built with `MeshAsset.fromData` so the example ships no model
 * file.
 *
 * `MeshAsset.plane` would be the shorter road and the wrong one: its quad is centred on its origin,
 * and a `TerrainScatter` plants an instance **at the ground**, so half of every blade would be
 * underground. This card is rooted at `y = 0` and one metre tall.
 */

import { MeshAsset } from "ignifx";
import type { App, AssetHandle } from "ignifx";

/**
 * Builds a crossed grass card rooted at its origin.
 *
 * @param app - The app whose asset service registers the mesh.
 * @returns The handle, with one holder — the caller.
 */
export function grassTuft(app: App): AssetHandle<MeshAsset> {
  const quads = 2;
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
      // Straight up rather than out of the card's face, so a blade seen edge-on is still lit.
      normals[at + 1] = 1;
    }
    // `v = 0` is the card's root: the texture loader's `invertY` puts the image's bottom row there.
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], quad * 8);
    const base = quad * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], quad * 6);
  }
  return MeshAsset.fromData(app, "sculpt/grass-tuft", { positions, normals, indices, uvs });
}
