import { readMeshBakeSurface } from "../../lite/gpu/mesh.js";
import { readWorldMatrix } from "../../lite/node.js";
import { Model } from "../model.js";
import type { AssetHandle } from "../../assets/types.js";
import type { Entity } from "../../entity/entity.js";
import type { MaterialAsset } from "../material-asset.js";

/**
 * The light-probe bake's reading of a `Model` under an app with a device
 * (`docs/architecture/07-rendering.md`, "Real scenes"): a device load keeps no file bytes
 * (`ModelAsset.sourceBytes`), so the bake reads the instance's own meshes, each through Lite's
 * `getMeshTriangles` at its world matrix.
 *
 * Device-only, for the same reason as `./model-instance.ts`: an instance only exists when the
 * container does. The root Vitest coverage config excludes `src/render/gpu/**`; the browser project
 * measures it (`test/render/light-probe-bake-model.browser.test.ts`).
 */

/** Where the bake collects triangles. */
interface TriangleSink {
  /**
   * Adds one mesh.
   *
   * @param positions - Three floats per vertex, in the space `matrix` maps from.
   * @param indices - Three indices per triangle.
   * @param matrix - A column-major world matrix.
   * @param rgb - The mesh's linear albedo.
   * @returns How many triangles it added.
   */
  add(
    positions: ArrayLike<number>,
    indices: ArrayLike<number>,
    matrix: ArrayLike<number>,
    rgb: readonly number[],
  ): number;
}

/** The albedo of a material override, as the bake reads materials. */
type MaterialAlbedo = (handle: AssetHandle<MaterialAsset> | null) => number[];

/** Records something the bake left out. */
type SkipRecorder = (entity: Entity, component: string, reason: string) => void;

/** The albedo of a mesh whose material says nothing usable. */
const MID_GREY: readonly number[] = Object.freeze([0.5, 0.5, 0.5]);

/**
 * Adds the triangles of a model's live instance, when the bake should read it: the asset kept no
 * file bytes and the instance exists. Each mesh is coloured by its material, or by the model's
 * override for that material's name.
 *
 * @param model - The model.
 * @param sink - Where the triangles go.
 * @param albedo - Reads an override's albedo.
 * @param skip - Records a mesh left out, or a model that gave nothing.
 * @param signal - Stops the collection between meshes.
 * @returns `null` when the model is read from its file instead (or has no instance to read), else
 * `1` when it gave no triangles at all and `0` when it gave some.
 *
 * @internal
 */
export function traceLiveModel(
  model: Model,
  sink: TriangleSink,
  albedo: MaterialAlbedo,
  skip: SkipRecorder,
  signal: AbortSignal | undefined,
): number | null {
  const handle = model.model;
  const asset = handle === null || handle.state !== "loaded" ? null : handle.value;
  const meshes = asset === null || asset.sourceBytes !== null ? null : model.instanceMeshes;
  if (asset === null || meshes === null) {
    return null;
  }
  const fileAlbedos = asset.bakeAlbedos;
  const matrix = Array.from({ length: 16 }, () => 0);
  let traced = 0;
  let reasons = 0;
  for (const mesh of meshes) {
    signal?.throwIfAborted();
    const surface = readMeshBakeSurface(mesh);
    if (surface === null) {
      reasons += 1;
      skip(model.entity, Model.typeId, `mesh "${mesh.name}" keeps no CPU triangles`);
      continue;
    }
    const override = surface.materialName === null ? undefined : model.materialOverrides[surface.materialName];
    // A model's override wins; else the file's colour for that material, which Lite bakes into a
    // texture the drawn material cannot be asked for; else what the drawn material says.
    const fromFile = surface.materialName === null ? undefined : fileAlbedos?.get(surface.materialName);
    const rgb =
      override !== undefined && override !== null ? albedo(override) : (fromFile ?? surface.albedo ?? MID_GREY);
    traced += sink.add(surface.positions, surface.indices, readWorldMatrix(mesh, matrix), rgb);
  }
  if (traced > 0) {
    return 0;
  }
  if (reasons === 0) {
    skip(model.entity, Model.typeId, "the model's instance draws no triangles");
  }
  return 1;
}
