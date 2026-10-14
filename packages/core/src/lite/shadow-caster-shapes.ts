import type { Mesh } from "@babylonjs/lite";

/**
 * Notices a shadow caster that changed shape without moving, so its shadow map can be redrawn
 * (`docs/architecture/07-rendering.md` §2.2).
 *
 * Every Babylon Lite 1.27.0 shadow pass skips drawing unless a caster's world matrix, the light, or
 * the camera moved (`casterVersionSum`, `lib/shadow/shadow-base.js` 138, read by
 * `lib/shadow/pcf-shadow-task-hooks.js` 135, `esm-directional-shadow-generator.js` 179 and
 * `csm-shadow-task-hooks.js` 180). Two kinds of caster change shape in place, and that check misses
 * both:
 *
 * - **A skinned mesh.** Its skeleton poses the vertices; the mesh itself stays put. Lite's
 *   `enableSkeletonShadows` (`index.d.ts` 4569) helps only when the pose's bounding box changes
 *   (`lib/shadow/deformable-shadow-casters.js` 15-29, 111-115), so a pose that moves inside the
 *   same box — a subtle idle, a hand closing — would still leave the map stale. Lite keeps no
 *   counter for a new pose: the animation controller, the weighted mixer and bone control all
 *   rewrite `skeleton.boneMatrices` in place and upload it (`lib/skeleton/skeleton-updater.js`
 *   266-280, `lib/animation/weighted-gltf-mixer.js` 371, `lib/skeleton/skeleton-pose.js` 84-104).
 *   So this compares the bone matrices themselves with the ones the map was last drawn with.
 * - **A shader material.** Its vertex stage may move vertices by a uniform such as `time`, and its
 *   fragment stage may discard by one. Lite bumps the material's `_uniformVersion` whenever a custom
 *   uniform's value really changes, and `_resourceVersion` whenever a texture or storage buffer is
 *   swapped (`lib/material/shader/shader-material.js` 216-217, 239, 259). ignifx writes `time` and
 *   the other engine uniforms through the same call (`writeShaderUniform`), so watching those two
 *   counters covers them.
 *
 * Both checks are exact: an unchanged pose or unchanged uniforms never cause a redraw, and any
 * change does. The one change neither can see is a storage buffer rewritten in place under the same
 * handle; the shader skill's gotchas name it.
 *
 * Everything here is `@internal`.
 */

/** The fields of a Lite material this reads. Absent from `index.d.ts`. */
interface ShadowCasterMaterial {
  /** A material drawn in this one's place in shadow passes (`resolveShadowCasterMaterial`). */
  readonly _shadowCasterMaterial?: ShadowCasterMaterial;
  /** The material family's builder; `"shader"` for a shader material. */
  readonly _buildGroup?: { readonly _materialFamily?: string };
  /** Bumped when a custom uniform's value changes. Shader materials only. */
  readonly _uniformVersion?: number;
  /** Bumped when a texture or storage buffer is swapped. Shader materials only. */
  readonly _resourceVersion?: number;
}

/**
 * Tracks the bone poses and shader uniforms of one shadow generator's casters.
 *
 * @remarks
 * Call {@link ShadowCasterShapes.watch} whenever the generator starts drawing a new caster list,
 * then {@link ShadowCasterShapes.hasChanged} once per frame. PCF and CSM build a new shadow task
 * state whenever a caster's material changes, and the render sync system hands ESM a new caster list
 * when one does, so watching per state follows material swaps too. Only `watch` allocates.
 *
 * Morph targets would need the same treatment, but ignifx has no morph-target support yet.
 *
 * @internal
 */
export class ShadowCasterShapes {
  /** The skinned casters. */
  readonly #skinned: Mesh[] = [];

  /** Each skinned caster's bone matrices when the map was last drawn, by the same index. */
  readonly #poses: Float32Array[] = [];

  /** The shader materials the casters draw their shadows with. */
  readonly #shaders: ShadowCasterMaterial[] = [];

  /** Each shader material's uniform and resource versions, summed, by the same index. */
  readonly #shaderVersions: number[] = [];

  /**
   * Starts tracking a new caster list.
   *
   * @param casters - The meshes the generator draws.
   */
  watch(casters: readonly Mesh[]): void {
    this.#skinned.length = 0;
    this.#poses.length = 0;
    this.#shaders.length = 0;
    this.#shaderVersions.length = 0;
    for (const mesh of casters) {
      const bones = mesh.skeleton?.boneMatrices;
      if (bones !== undefined) {
        this.#skinned.push(mesh);
        this.#poses.push(bones.slice());
      }
      const shader = shadowShaderMaterial(mesh);
      if (shader !== null && !this.#shaders.includes(shader)) {
        this.#shaders.push(shader);
        this.#shaderVersions.push(shaderVersion(shader));
      }
    }
  }

  /**
   * Whether any tracked caster changed shape since the last call (or since {@link watch}).
   *
   * @returns `true` when a bone pose or a shader material's uniforms changed.
   */
  hasChanged(): boolean {
    let changed = false;
    for (let index = 0; index < this.#skinned.length; index += 1) {
      const bones = this.#skinned[index]?.skeleton?.boneMatrices;
      const pose = this.#poses[index];
      if (bones === undefined || pose === undefined || hasSameValues(pose, bones)) {
        continue;
      }
      if (pose.length === bones.length) {
        pose.set(bones);
      } else {
        this.#poses[index] = bones.slice();
      }
      changed = true;
    }
    for (let index = 0; index < this.#shaders.length; index += 1) {
      const shader = this.#shaders[index];
      if (shader === undefined) {
        continue;
      }
      const version = shaderVersion(shader);
      if (version !== this.#shaderVersions[index]) {
        this.#shaderVersions[index] = version;
        changed = true;
      }
    }
    return changed;
  }
}

/**
 * The shader material a caster's shadow is drawn with, if it is one.
 *
 * @param mesh - A caster.
 * @returns The material, or `null` when the caster's shadow is not drawn by a shader material.
 */
function shadowShaderMaterial(mesh: Mesh): ShadowCasterMaterial | null {
  // Boundary assertion (coding standards §5.2): every Lite 1.27.0 material is a plain object that
  // carries `_buildGroup`, and a shader material also carries the two version counters.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  let material = mesh.material as ShadowCasterMaterial | undefined;
  // Lite draws the end of this chain into the map (`lib/shadow/pcf-shadow-task-hooks.js` 110-116).
  // oxlint-disable-next-line no-underscore-dangle
  while (material?._shadowCasterMaterial !== undefined) {
    // oxlint-disable-next-line no-underscore-dangle
    material = material._shadowCasterMaterial;
  }
  // oxlint-disable-next-line no-underscore-dangle
  return material?._buildGroup?._materialFamily === "shader" ? material : null;
}

/**
 * A number that grows whenever a shader material's uniforms or bound resources change.
 *
 * @param material - A shader material.
 * @returns The sum of its two version counters; both only ever grow.
 */
function shaderVersion(material: ShadowCasterMaterial): number {
  // oxlint-disable-next-line no-underscore-dangle
  return (material._uniformVersion ?? 0) + (material._resourceVersion ?? 0);
}

/**
 * Whether two arrays hold the same values.
 *
 * @param a - One array.
 * @param b - The other.
 * @returns `true` when both have the same length and elements.
 */
function hasSameValues(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
