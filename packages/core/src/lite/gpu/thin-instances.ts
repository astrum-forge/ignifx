import {
  clearThinInstanceLodPartner as liteClearThinInstanceLodPartner,
  enableThinInstanceDynamicDrawCount as liteEnableThinInstanceDynamicDrawCount,
  enableThinInstanceGpuCulling as liteEnableThinInstanceGpuCulling,
  enableThinInstanceWorldBounds as liteEnableThinInstanceWorldBounds,
  flushThinInstances as liteFlushThinInstances,
  setThinInstanceColors as liteSetThinInstanceColors,
  setThinInstanceCount as liteSetThinInstanceCount,
  setThinInstanceDrawCount as liteSetThinInstanceDrawCount,
  setThinInstanceLodPartner as liteSetThinInstanceLodPartner,
  setThinInstances as liteSetThinInstances,
} from "@babylonjs/lite";
import type { Mesh } from "@babylonjs/lite";

/**
 * Thin-instance half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.3,
 * `docs/plan/2026-09-terrain-particles-shaders.md` §3.5). Everything here is `@internal` and needs a
 * WebGPU device, so the browser project is what covers it.
 *
 * Lite fixes the order these must be called in, and both the culling opt-in and the LOD pairing only
 * take effect through the renderable `registerScene` compiles:
 *
 * 1. {@link setThinInstances} — its `count` argument becomes `_capacity`, and the GPU buffer is
 *    sized `_capacity * 64` bytes for the life of the mesh, so pass the **capacity** here once and
 *    lower the active count with {@link setThinInstanceCount} straight afterwards.
 * 2. {@link enableThinInstanceWorldBounds} — gives the scene AABB the cloud rather than the
 *    prototype. It does not fix a shadow frustum: `computeDirectionalLightMatrix` reads
 *    `boundMin`/`boundMax` directly (`lib/shadow/shadow-base.js` 54).
 * 3. {@link enableThinInstanceGpuCulling} — compute-based, opaque only.
 * 4. {@link enableThinInstanceDynamicDrawCount} — indirect draw arguments, so a later count change
 *    keeps the cached bundle valid.
 * 5. {@link setThinInstanceLodPartner} — needs both meshes instanced already and stamps both
 *    `_clone`, so neither can be cloned afterwards.
 * 6. `addMeshToScene`, and only then `registerScene`.
 *
 * Moving instances costs three different amounts (`lib/mesh/thin-instance.js`):
 * {@link flushThinInstances} re-uploads the whole active range and is the only sub-range-free path
 * Lite exposes; {@link setThinInstanceCount} re-uploads as well; {@link setThinInstanceDrawCount}
 * uploads nothing but throws until the pool has completed one GPU synchronisation, which is private
 * state — {@link trySetThinInstanceDrawCount} asks by trying.
 */

/**
 * Points a mesh at a matrix slab and fixes its capacity.
 *
 * @remarks
 * The `capacity` argument is written straight to Lite's `_capacity`, which sizes the GPU buffer
 * (`_capacity * 64` bytes) once and for good. Only the first `count` matrices are ever read from
 * `matrices`, and Lite clamps its dirty range to the active count
 * (`lib/mesh/thin-instance-gpu.js`), so a slab shorter than `capacity * 16` floats is safe as long
 * as the active count is lowered with {@link setThinInstanceCount} before the next frame.
 *
 * Lite keeps the array by reference and never copies it: the caller owns it, and mutating it is the
 * intended way to move instances, followed by {@link flushThinInstances}.
 *
 * @param mesh - The mesh to instance.
 * @param matrices - 16 floats per instance, column-major, caller-owned.
 * @param capacity - The largest instance count this mesh will ever draw.
 *
 * @internal
 */
export function setThinInstances(mesh: Mesh, matrices: Float32Array, capacity: number): void {
  liteSetThinInstances(mesh, matrices, capacity);
}

/**
 * Sets how many instances draw, re-uploading the active range.
 *
 * @remarks
 * Prefer {@link trySetThinInstanceDrawCount} for a per-frame change: this one marks `[0, count)`
 * dirty as well, so it costs a `count * 64`-byte upload.
 *
 * @param mesh - The instanced mesh.
 * @param count - The active count, at most the capacity.
 *
 * @internal
 */
export function setThinInstanceCount(mesh: Mesh, count: number): void {
  liteSetThinInstanceCount(mesh, count);
}

/**
 * Sets how many instances draw without re-uploading anything, when Lite accepts it.
 *
 * @remarks
 * Lite requires the pool to have completed one full-capacity GPU synchronisation first and throws
 * otherwise (`lib/mesh/thin-instance.js`, `ThrowLiteError(369)`); the state it checks — the matrix
 * buffer's existence and its version — is private, so the only way to ask is to call. The throw
 * happens before anything is mutated, so a refusal leaves the mesh untouched and the caller can
 * fall back to {@link setThinInstanceCount}.
 *
 * @param mesh - The instanced mesh.
 * @param count - The active count, at most the capacity.
 * @returns `true` when the count was changed, `false` when Lite is not ready for a bare count
 * change yet.
 *
 * @internal
 */
export function trySetThinInstanceDrawCount(mesh: Mesh, count: number): boolean {
  try {
    liteSetThinInstanceDrawCount(mesh, count);
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks the whole active matrix range dirty, after the caller mutated the slab in place.
 *
 * @param mesh - The instanced mesh.
 *
 * @internal
 */
export function flushThinInstances(mesh: Mesh): void {
  liteFlushThinInstances(mesh);
}

/**
 * Installs, replaces, or removes the per-instance RGBA colours.
 *
 * @remarks
 * Lite exports no way to *remove* colours: `setThinInstanceColors` only assigns, and the colour
 * version counters that drive the upload are private. `ThinInstanceData.colors` is declared
 * optional and mutable (`index.d.ts` 12985), so clearing is a direct field write —
 * which is enough, because `syncThinInstanceGpuData` skips the colour upload entirely while
 * `colors` is null, and the renderable rebuild the caller triggers is what drops
 * `useThinInstanceColors` from the compiled pipeline.
 *
 * @param mesh - The instanced mesh.
 * @param colors - Four floats per instance (linear RGBA), or `null` to stop reading colours.
 *
 * @internal
 */
export function setThinInstanceColors(mesh: Mesh, colors: Float32Array | null): void {
  if (colors !== null) {
    liteSetThinInstanceColors(mesh, colors);
    return;
  }
  const data = mesh.thinInstances;
  if (data !== null && data !== undefined) {
    data.colors = null;
  }
}

/**
 * Turns compute-based GPU frustum culling on or off for an instanced mesh.
 *
 * @remarks
 * Opaque meshes only, and it must run after {@link setThinInstances} and before the scene is
 * registered.
 *
 * @param mesh - The instanced mesh.
 * @param enabled - Whether the culling compute pass runs.
 *
 * @internal
 */
export function enableThinInstanceGpuCulling(mesh: Mesh, enabled: boolean): void {
  liteEnableThinInstanceGpuCulling(mesh, enabled);
}

/**
 * Makes a mesh's world bounds the union of its instances' boxes rather than the prototype's own.
 *
 * @remarks
 * The hook it installs is `O(count)` per bounds computation, and it clamps to
 * `matrices.length / 16`, so a short slab cannot walk off the end. It is read by
 * `expandWorldAabbForMesh` — the scene camera's extent and PBR's scene-size probe — and **not** by
 * the directional shadow fit; see the module note.
 *
 * @param mesh - The instanced mesh.
 *
 * @internal
 */
export function enableThinInstanceWorldBounds(mesh: Mesh): void {
  liteEnableThinInstanceWorldBounds(mesh);
}

/**
 * Opts a fixed-capacity pool into indirect draw arguments, so a later count change keeps the
 * cached render bundle valid.
 *
 * @param mesh - The instanced mesh.
 *
 * @internal
 */
export function enableThinInstanceDynamicDrawCount(mesh: Mesh): void {
  liteEnableThinInstanceDynamicDrawCount(mesh);
}

/**
 * Where a LOD pairing switches, and how softly.
 *
 * @internal
 */
export interface ThinInstanceLodOptions {
  /** The camera distance, in world units, at which an in-frustum instance switches to the partner. */
  readonly distance: number;
  /** The width of the per-instance threshold dither window centred on `distance`; `0` is a hard cut. */
  readonly band: number;
}

/**
 * Pairs a GPU-culled instanced mesh with a lower-detail partner.
 *
 * @remarks
 * Both meshes must already carry thin instances, and the partner may reference the very same matrix
 * slab. While paired the partner draws **only** the far bucket, and the pairing switches its own
 * GPU culling on. Lite refuses the pairing when either mesh has more than one thin-instance owner,
 * when the partner is already paired, or when the partner carries colours the full mesh does not
 * (`ThrowLiteError(375)`, `(377)`, `(379)`). Calling it again with the same pair re-sets `distance`
 * and `band` live.
 *
 * @param fullMesh - The near mesh, which owns the culling pass.
 * @param lodMesh - The far mesh.
 * @param options - Where the switch happens, and how softly.
 *
 * @internal
 */
export function setThinInstanceLodPartner(fullMesh: Mesh, lodMesh: Mesh, options: ThinInstanceLodOptions): void {
  liteSetThinInstanceLodPartner(fullMesh, lodMesh, { distance: options.distance, band: options.band });
}

/**
 * Dissolves a LOD pairing, returning both meshes to independent rendering.
 *
 * @remarks
 * A no-op when the mesh is not paired, so it is safe on the teardown path.
 *
 * @param fullMesh - The near mesh of the pair.
 *
 * @internal
 */
export function clearThinInstanceLodPartner(fullMesh: Mesh): void {
  liteClearThinInstanceLodPartner(fullMesh);
}

/**
 * How many instances a mesh is currently drawing, as Lite sees it.
 *
 * @remarks
 * The browser tests assert against Lite's own state rather than against the component's copy of it,
 * which is the only way to prove the two agree.
 *
 * @param mesh - The mesh to read.
 * @returns The active count, or `0` when the mesh carries no thin instances.
 *
 * @internal
 */
export function thinInstanceCount(mesh: Mesh): number {
  return mesh.thinInstances?.count ?? 0;
}
