import { createPrimitiveMeshAsset, MESH_ASSET_TYPE } from "../mesh-asset.js";
import { MESH_FILE_EXTENSION, readMeshFile } from "../mesh-file.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";
import type { MeshAsset } from "../mesh-asset.js";

/**
 * Builds the `mesh` loader: `.mesh.json` to `MeshAsset` (ADR-0029).
 *
 * @remarks
 * The file names a primitive and its options, and the loader builds it exactly as the matching
 * `MeshAsset` factory would. The mesh is named after the file's `name`, or its address. A headless
 * app builds no GPU geometry. A file that is not a mesh file fails the load with `IGX-0709`, a
 * format version other than 1 with `IGX-0603`, and an unknown primitive or a bad option with
 * `IGX-0507`. The same `mesh` type still holds the in-memory meshes the factories publish; the
 * loader's `unload` frees both kinds.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createMeshLoader());
 * ```
 *
 * @public
 */
export function createMeshLoader(): AssetLoader<MeshAsset> {
  return {
    type: MESH_ASSET_TYPE,
    extensions: [MESH_FILE_EXTENSION],
    async load(ctx: LoaderContext): Promise<MeshAsset> {
      const file = readMeshFile(await ctx.fetchJson(), ctx.address);
      return createPrimitiveMeshAsset(ctx.app, file.name ?? ctx.address, file.definition);
    },
    unload(value: MeshAsset): void {
      value.dispose();
    },
  };
}
