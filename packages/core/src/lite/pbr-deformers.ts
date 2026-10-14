import { isPbrMaterial } from "@babylonjs/lite";
import type { SceneContext } from "@babylonjs/lite";

/**
 * Which kinds of vertex deformation the PBR meshes of a scene use (`docs/architecture/07-rendering.md`
 * §2.2).
 *
 * Everything here is `@internal`.
 *
 * ## Why the render layer has to know (verified against `@babylonjs/lite@1.27.0`)
 *
 * Lite registers the PBR skinning and morph-target shader fragments only inside a full build of
 * the PBR group, and only when that build contains a skinned or morphed mesh (`buildPbrRenderables`,
 * `lib/material/pbr/pbr-renderable.js` 114-117). A mesh added after `registerScene` to a PBR group
 * that already exists is built at once by the group's `rebuildSingle` instead
 * (`processMaterialSwaps`, `lib/scene/scene-material-swap.js` 22-45), and that never registers
 * them. ignifx's warm-up builds the PBR group at start whenever the scene has a light (ADR-0014).
 *
 * So the first skinned model a page adds after `app.start()` is composed without its skinning
 * fragment, and Lite caches that bind-group layout under a key that does not say which fragments
 * were registered (`getOrCreatePbrBindings`, `lib/material/pbr/pbr-pipeline.js` 33-36). The next
 * renderable rebuild registers the fragment, reuses the cached layout, and builds a bind group with
 * one more entry than it: WebGPU rejects every frame from then on ("Binding entry sampler not set",
 * group 1, entries[3]) and the canvas stays black. The fragments are registered process-wide, so
 * every later app in the page was fine.
 *
 * The render sync system compares what this reports with what a full build has already composed,
 * and clears Lite's layout caches before the rebuild that first sees a new kind. Until that
 * rebuild, one frame after the mesh arrives, a skinned mesh draws in its bind pose; a morphed one
 * gets a shader that does not compile, so WebGPU rejects that frame or two.
 */

/**
 * The deformation kinds, as bits of the mask {@link readPbrDeformers} returns.
 *
 * @internal
 */
export const PBR_DEFORMER = {
  /** A mesh skinned by a skeleton. */
  skin: 1,
  /** A mesh with morph targets. */
  morph: 2,
} as const;

/**
 * Reads which deformation kinds the scene's PBR meshes use.
 *
 * @param scene - The scene, or anything with its mesh list.
 * @returns A mask of {@link PBR_DEFORMER} bits; `0` when no PBR mesh deforms.
 *
 * @internal
 */
export function readPbrDeformers(scene: Pick<SceneContext, "meshes">): number {
  let kinds = 0;
  for (const mesh of scene.meshes) {
    if (!isPbrMaterial(mesh.material)) {
      continue;
    }
    if (mesh.skeleton) {
      kinds |= PBR_DEFORMER.skin;
    }
    if (mesh.morphTargets) {
      kinds |= PBR_DEFORMER.morph;
    }
  }
  return kinds;
}
