import {
  addToScene,
  createDirectionalLight,
  createHemisphericLight,
  createPointLight,
  createSpotLight,
  removeFromScene,
  type DirectionalLight,
  type HemisphericLight,
  type LightBase,
  type PointLight,
  type SceneContext,
  type SpotLight,
} from "@babylonjs/lite";
import { assertNever } from "../errors/ignifx-error.js";
import { degToRad } from "../math/math-utils.js";

/**
 * Light half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.2): the four Lite
 * light kinds a `Light` component can own, each of them **unparented** and posed in world space.
 *
 * Everything here is `@internal`. Colours arrive **linear**: the sRGB decode that the component's
 * `color` field performs belongs to the component layer, not to the adapter.
 *
 * ## Why an ignifx light is never parented in Lite
 *
 * A Lite light is an `IParentable` with a world matrix (`LightBase`, `index.d.ts` 6589), so
 * parenting it under the entity's node looks like the obvious mirror of what `Camera` and
 * `MeshRenderer` do. It is wrong, and the visual suite caught it:
 *
 * - Lite composes a light's world matrix as `parentWorld × localMatrixFromDirection(direction,
 *   position)` (`lib/light/directional-light.js` 8-10, `lib/light/light-matrix.js`), and the shader
 *   reads the **third column of that world matrix** as the light direction
 *   (`lib/light/directional-light.js` 20-22 copies `w[8]`, `w[9]`, `w[10]`; the spot light also
 *   takes its position from `w[12..14]`, `lib/light/spot-light.js` 28-30). Writing the entity's
 *   **world** forward into `direction` while the light is **also** parented applies the entity's
 *   rotation twice, so the light shades from a direction that is neither the local nor the world
 *   one.
 * - The shadow frustum does not go through the world matrix at all:
 *   `computeDirectionalLightMatrix` fits it from `light.direction` and `light.position` directly
 *   (`lib/shadow/shadow-base.js` 54-55). A parented light therefore shades from one direction and
 *   casts along another.
 *
 * One pose, written once, is the only arrangement in which shading, the lights UBO, and the shadow
 * frustum agree: the adapter creates every light with `parent = null` and the component writes the
 * entity's **world** direction and position into the light's own observables with
 * {@link syncLightWorldPose} in each frame the entity moved. With no parent, `worldMatrix` is the
 * local matrix, whose third column is exactly the direction that was written.
 *
 * ## The lights uniform buffer only follows the light's own observables
 *
 * It is re-uploaded when the summed `_lightVersion` of the scene's lights changes
 * (`lib/render/lights-ubo.js`, `refreshSceneLightsUBO`), and that counter is bumped by writes to the
 * light's **own** observable vectors (`lib/light/light-base.js`, `onDirty`). `ObservableVec3.set`
 * fires its dirty hook unconditionally (`lib/math/observable-vec3.js`), so {@link syncLightWorldPose}
 * re-marks the light as a side effect of posing it, and {@link markLightTransformDirty} is the
 * allocation-free nudge for a caller that has nothing new to write.
 *
 * ## Two more things Lite spells its own way
 *
 * - Include/exclude lists are sets of `Mesh.id` **strings**, not mesh references
 *   (`lib/render/lights-ubo.js`, `affectsMesh`), and a mesh with no `id` is never excluded.
 * - Hemispheric lights spell their colours `diffuseColor`/`specularColor`, not `diffuse`/`specular`
 *   (`index.d.ts` 6286) — `docs/architecture/07-rendering.md` §2.2 says "`diffuse`/`specular`" for
 *   every type, which is wrong for this one.
 */

/**
 * The Lite light kinds an ignifx `Light` component can own, re-exported under an ignifx name so
 * feature code can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4,
 * coding standards §4). The barrel exports it as `LiteLight`, the name `Light.lite.light` reads by.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type AdapterLight = DirectionalLight | PointLight | SpotLight | HemisphericLight;

/**
 * A light that has a range: the two punctual kinds with distance falloff.
 *
 * @internal
 */
export type RangedLight = PointLight | SpotLight;

/**
 * Creates a directional light in world space, pointing along `+Z` until it is posed.
 *
 * @remarks
 * `parent` is left `null` on purpose; see the module note. The component poses it every frame the
 * entity moves with {@link syncLightWorldPose}.
 *
 * @param intensity - The initial intensity.
 * @returns The light. Add it to a scene with {@link addLightToScene}.
 *
 * @example
 * ```ts
 * const sun = createDirectionalLightInWorld(3);
 * syncLightWorldPose(sun, 0, -1, 0, 0, 0, 1, 0, 10, 0);
 * addLightToScene(scene, sun);
 * ```
 *
 * @internal
 */
export function createDirectionalLightInWorld(intensity: number): DirectionalLight {
  return createDirectionalLight([0, 0, 1], intensity);
}

/**
 * Creates a point light at the world origin.
 *
 * @param intensity - The initial intensity.
 * @returns The light.
 *
 * @internal
 */
export function createPointLightInWorld(intensity: number): PointLight {
  return createPointLight([0, 0, 0], intensity);
}

/**
 * Creates a spot light at the world origin pointing along `+Z`.
 *
 * @param angleDegrees - The full cone angle, in degrees.
 * @param exponent - The falloff exponent; higher is sharper.
 * @param intensity - The initial intensity.
 * @returns The light.
 *
 * @internal
 */
export function createSpotLightInWorld(angleDegrees: number, exponent: number, intensity: number): SpotLight {
  return createSpotLight([0, 0, 0], [0, 0, 1], degToRad(angleDegrees), exponent, intensity);
}

/**
 * Creates a hemispheric light whose sky direction is `+Y`.
 *
 * @param intensity - The initial intensity.
 * @returns The light.
 *
 * @internal
 */
export function createHemisphericLightInWorld(intensity: number): HemisphericLight {
  return createHemisphericLight([0, 1, 0], intensity);
}

/**
 * Poses an unparented light in **world** space: the axis it shines along and the point it shines
 * from, in the one place every consumer reads them.
 *
 * @remarks
 * The light's world matrix is its local matrix (there is no parent), so `worldMatrix[8..10]` — what
 * the shader reads as the direction — is exactly what was written to `direction`,
 * `worldMatrix[12..14]` — what a spot light reports as its position — is exactly `position`, and
 * `computeDirectionalLightMatrix` fits the shadow frustum from the same two vectors.
 *
 * Each kind is written only what it uses, and each kind reads a different axis of the entity:
 *
 * | Kind | Direction | Position |
 * | --- | --- | --- |
 * | `directional`, `spot` | the entity's world **forward** | yes |
 * | `point` | — | yes |
 * | `hemispheric` | the entity's world **up**: it is a sky direction, not a beam | — |
 *
 * Both writes fire `ObservableVec3`'s dirty hook, so the lights uniform buffer re-uploads without a
 * separate {@link markLightTransformDirty}.
 *
 * @param light - The light to pose.
 * @param forwardX - The entity's world-space forward x.
 * @param forwardY - The entity's world-space forward y.
 * @param forwardZ - The entity's world-space forward z.
 * @param upX - The entity's world-space up x.
 * @param upY - The entity's world-space up y.
 * @param upZ - The entity's world-space up z.
 * @param positionX - The entity's world-space position x.
 * @param positionY - The entity's world-space position y.
 * @param positionZ - The entity's world-space position z.
 *
 * @internal
 */
export function syncLightWorldPose(
  light: AdapterLight,
  forwardX: number,
  forwardY: number,
  forwardZ: number,
  upX: number,
  upY: number,
  upZ: number,
  positionX: number,
  positionY: number,
  positionZ: number,
): void {
  switch (light.lightType) {
    case "directional":
    case "spot":
      light.direction.set(forwardX, forwardY, forwardZ);
      light.position.set(positionX, positionY, positionZ);
      break;
    case "point":
      light.position.set(positionX, positionY, positionZ);
      break;
    case "hemispheric":
      light.direction.set(upX, upY, upZ);
      break;
    default:
      assertNever(light, "light type");
  }
}

/**
 * Sets a light's diffuse and specular colour from one **linear** RGB triple.
 *
 * @param light - The light to colour.
 * @param r - The linear red component.
 * @param g - The linear green component.
 * @param b - The linear blue component.
 *
 * @internal
 */
export function setLightColor(light: AdapterLight, r: number, g: number, b: number): void {
  switch (light.lightType) {
    case "directional":
    case "point":
    case "spot": {
      const diffuse = light.diffuse;
      diffuse[0] = r;
      diffuse[1] = g;
      diffuse[2] = b;
      const specular = light.specular;
      specular[0] = r;
      specular[1] = g;
      specular[2] = b;
      break;
    }
    case "hemispheric": {
      const diffuse = light.diffuseColor;
      diffuse[0] = r;
      diffuse[1] = g;
      diffuse[2] = b;
      const specular = light.specularColor;
      specular[0] = r;
      specular[1] = g;
      specular[2] = b;
      break;
    }
    default:
      assertNever(light, "light type");
  }
  markLightDirty(light);
}

/**
 * Sets the ground colour of a hemispheric light, in **linear** RGB.
 *
 * @param light - The hemispheric light.
 * @param r - The linear red component.
 * @param g - The linear green component.
 * @param b - The linear blue component.
 *
 * @internal
 */
export function setHemisphericGroundColor(light: HemisphericLight, r: number, g: number, b: number): void {
  const ground = light.groundColor;
  ground[0] = r;
  ground[1] = g;
  ground[2] = b;
  markLightDirty(light);
}

/**
 * Sets a light's intensity.
 *
 * @param light - The light to change.
 * @param intensity - The new intensity.
 *
 * @internal
 */
export function setLightIntensity(light: AdapterLight, intensity: number): void {
  light.intensity = intensity;
  markLightDirty(light);
}

/**
 * Sets the distance at which a point or spot light's contribution reaches zero.
 *
 * @param light - The point or spot light.
 * @param range - The range, in metres.
 *
 * @internal
 */
export function setLightRange(light: RangedLight, range: number): void {
  light.range = range;
  markLightDirty(light);
}

/**
 * Sets a spot light's full cone angle.
 *
 * @param light - The spot light.
 * @param angleDegrees - The full cone angle, in degrees.
 *
 * @internal
 */
export function setSpotAngle(light: SpotLight, angleDegrees: number): void {
  light.angle = degToRad(angleDegrees);
  markLightDirty(light);
}

/**
 * Sets a spot light's falloff exponent.
 *
 * @param light - The spot light.
 * @param exponent - The exponent; higher values give a sharper edge.
 *
 * @internal
 */
export function setSpotExponent(light: SpotLight, exponent: number): void {
  light.exponent = exponent;
  markLightDirty(light);
}

/**
 * Restricts a light to a set of mesh ids, or lifts the restriction.
 *
 * @remarks
 * Lite matches on `Mesh.id`, a string a loader or the adapter assigns; the include list wins over
 * the exclude list when both are present (`lib/render/lights-ubo.js`, `affectsMesh`).
 *
 * @param light - The light to restrict.
 * @param meshIds - The mesh ids that may be lit, or `null` to light everything.
 *
 * @internal
 */
export function setLightIncludedMeshIds(light: LightBase, meshIds: ReadonlySet<string> | null): void {
  if (meshIds === null) {
    delete light.includedOnlyMeshIds;
  } else {
    light.includedOnlyMeshIds = meshIds;
  }
}

/**
 * Excludes a set of mesh ids from a light, or lifts the exclusion.
 *
 * @param light - The light to restrict.
 * @param meshIds - The mesh ids that must not be lit, or `null` to light everything.
 *
 * @internal
 */
export function setLightExcludedMeshIds(light: LightBase, meshIds: ReadonlySet<string> | null): void {
  if (meshIds === null) {
    delete light.excludedMeshIds;
  } else {
    light.excludedMeshIds = meshIds;
  }
}

/**
 * Tells Lite that a light's row in the lights uniform buffer is stale, without changing its pose.
 *
 * @remarks
 * Lite bumps a light's version only when the light's own `direction`/`position` are written
 * (`lib/light/light-base.js`), so anything that changes what the light contributes *without*
 * touching those vectors — a colour, an intensity, a cone angle — has to say so. This re-sets the
 * light's own vector to the value it already holds, which fires `ObservableVec3`'s dirty hook
 * unconditionally and costs no allocation. A pose change goes through {@link syncLightWorldPose}
 * instead, which marks the light as a side effect of writing it.
 *
 * @param light - The light whose uniform row is stale.
 *
 * @internal
 */
export function markLightTransformDirty(light: AdapterLight): void {
  markLightDirty(light);
}

/**
 * Adds a light to a render scene.
 *
 * @param scene - The render scene.
 * @param light - The light to add.
 *
 * @internal
 */
export function addLightToScene(scene: SceneContext, light: LightBase): void {
  addToScene(scene, light);
}

/**
 * Removes a light from a render scene, disposing its shadow generator when it has one.
 *
 * @remarks
 * `removeFromScene` also detaches the light from its parent and recursively removes its `children`
 * (`lib/scene/scene-remove.js`), which is harmless here because the adapter never puts anything in
 * a light's `children` array.
 *
 * @param scene - The render scene.
 * @param light - The light to remove.
 *
 * @internal
 */
export function removeLightFromScene(scene: SceneContext, light: LightBase): void {
  removeFromScene(scene, light);
}

/**
 * Bumps a light's change counter so the next frame re-uploads the lights uniform buffer.
 *
 * @param light - The light to mark.
 */
function markLightDirty(light: AdapterLight): void {
  switch (light.lightType) {
    case "directional":
    case "spot":
    case "hemispheric": {
      const direction = light.direction;
      direction.set(direction.x, direction.y, direction.z);
      break;
    }
    case "point": {
      const position = light.position;
      position.set(position.x, position.y, position.z);
      break;
    }
    default:
      assertNever(light, "light type");
  }
}
