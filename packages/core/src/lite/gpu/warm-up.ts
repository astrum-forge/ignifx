import { addToScene, createMeshFromData, removeFromScene, setSubtreeVisible } from "@babylonjs/lite";
import type { EngineContext, Material, Mesh, SceneContext } from "@babylonjs/lite";

/**
 * Material warm-up (`docs/architecture/07-rendering.md` §1.1, ADR-0014). Spike S2.2 measured what
 * "warming up" has to mean in Babylon Lite; this module is the answer.
 *
 * Everything here is `@internal`, and it needs a device.
 *
 * ## What Lite compiles, and when (verified against `@babylonjs/lite@1.27.0`)
 *
 * A scene groups its meshes by `material._buildGroup` — a **per-family singleton**, one function
 * for every PBR material in the process, one for every Standard material, one for every Shader
 * material (`lib/material/pbr/pbr-material.js`, `lib/material/standard/create-standard-material.js`,
 * `lib/material/shader/shader-material.js`). `addToScene` looks the group up, and:
 *
 * - before `registerScene`, it queues a deferred builder that `buildScene` runs, which sets the
 *   group's `rebuildSingle` (`group.r`);
 * - after `registerScene`, `processMaterialSwaps` takes one of two paths
 *   (`lib/scene/scene-material-swap.js`). If `group.r` exists — the family was built at
 *   registration — the mesh is rebuilt **synchronously** inside the frame and draws on the next one.
 *   If it does not, the mesh goes to `scene-runtime-mesh-build.js`, which dynamically imports a
 *   module, runs the group builder from scratch and, for PBR, recompiles every PBR pipeline in the
 *   scene (`rebuildScenePbrPipelines`). That is the multi-frame stall.
 *
 * So warming up a *material* is the wrong unit: what has to exist at `registerScene` is one mesh
 * per material **family**. That is cheap — one hidden triangle each — and it is what
 * {@link warmUpMaterials} installs. Lite has no compile or precompile API to call instead; there is
 * no public way to await the runtime build either (`scene._runtimeBuilds` is private).
 *
 * Hiding is enough: `visible` is read when a renderable is drawn, not when it is built, so a hidden
 * probe still forces its family's group builder to run.
 */

/**
 * The three vertices of the probe triangle: small enough to be sub-pixel even if it were drawn. Each
 * probe gets its own copy rather than cloning a shared template, because `cloneTransformNode` is
 * typed to return a `SceneNode` and narrowing it back to a `Mesh` would need a type assertion for a
 * saving of three vertices.
 */
const PROBE_POSITIONS: readonly number[] = [0, 0, 0, 1e-6, 0, 0, 0, 1e-6, 0];

/** One outward normal per probe vertex. */
const PROBE_NORMALS: readonly number[] = [0, 0, -1, 0, 0, -1, 0, 0, -1];

/** The probe triangle's single face. */
const PROBE_INDICES: readonly number[] = [0, 1, 2];

/** One UV pair per probe vertex. */
const PROBE_UVS: readonly number[] = [0, 0, 1, 0, 0, 1];

/**
 * The hidden probes a warm-up installed, so they can be discarded later.
 *
 * @internal
 */
export interface MaterialWarmUp {
  /** One hidden probe per material, in the order the materials were given. */
  readonly probes: readonly Mesh[];
}

/**
 * Forces Lite to build a renderable group for every material family in `materials`, so that meshes
 * added after `registerScene` take the synchronous rebuild path instead of the runtime-build path.
 *
 * @remarks
 * Call **before** `registerRenderScene`. One probe per material is installed, which is more than
 * strictly needed — one per family would do — but it costs one degenerate triangle each, it is
 * exact about which feature combinations get compiled at registration, and it does not depend on
 * ignifx knowing how Lite partitions families.
 *
 * The probes are hidden, not removed: leaving them in the scene for the app's lifetime is the
 * intended steady state, because removing the last mesh of a family does **not** remove its group
 * from the scene, but keeping them makes that guarantee independent of Lite's internals.
 *
 * @param engine - The engine that owns the probe geometry.
 * @param scene - The scene to warm up.
 * @param materials - The materials whose families must be compiled at registration.
 * @returns The installed probes. Pass them to {@link discardMaterialWarmUp} to take them out.
 *
 * @example
 * ```ts
 * const warmUp = warmUpMaterials(engine, scene, bootMaterials);
 * await registerRenderScene(scene, { shadows });
 * // a mesh added now draws on the next frame instead of several frames later
 * ```
 *
 * @internal
 */
export function warmUpMaterials(
  engine: EngineContext,
  scene: SceneContext,
  materials: readonly Material[],
): MaterialWarmUp {
  const probes: Mesh[] = [];
  for (let i = 0; i < materials.length; i++) {
    const material = materials[i];
    if (material === undefined) {
      continue;
    }
    const probe = createMeshFromData(
      engine,
      "ignifx:warm-up",
      Float32Array.from(PROBE_POSITIONS),
      Float32Array.from(PROBE_NORMALS),
      Uint32Array.from(PROBE_INDICES),
      Float32Array.from(PROBE_UVS),
    );
    probe.material = material;
    probe.pickable = false;
    probe.receiveShadows = false;
    setSubtreeVisible(probe, false);
    addToScene(scene, probe);
    probes.push(probe);
  }
  return { probes };
}

/**
 * Removes a warm-up's probes and releases the geometry they shared.
 *
 * @remarks
 * The material groups the probes created stay on the scene — Lite never removes a group — so
 * discarding a warm-up does not undo it. This exists so a test can prove the probes are gone, and
 * so a long-lived app can reclaim the one triangle.
 *
 * @param scene - The scene the probes were added to.
 * @param warmUp - The handle {@link warmUpMaterials} returned.
 *
 * @internal
 */
export function discardMaterialWarmUp(scene: SceneContext, warmUp: MaterialWarmUp): void {
  const probes = warmUp.probes;
  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    if (probe !== undefined) {
      removeFromScene(scene, probe);
    }
  }
}
