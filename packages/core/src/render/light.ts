import { Component } from "../component/component.js";
import { entityInternals } from "../entity/internals.js";
import { assertNever } from "../errors/ignifx-error.js";
import {
  addLightToScene,
  createDirectionalLightInWorld,
  createHemisphericLightInWorld,
  createPointLightInWorld,
  createSpotLightInWorld,
  removeLightFromScene,
  setHemisphericGroundColor,
  setLightColor,
  setLightExcludedMeshIds,
  setLightIncludedMeshIds,
  setLightIntensity,
  setLightRange,
  setSpotAngle,
  setSpotExponent,
  syncLightWorldPose,
} from "../lite/light.js";
import { readWorldMatrix, worldMatrixVersion } from "../lite/node.js";
import { SHADOW_TECHNIQUES } from "../lite/shadow.js";
import { Color } from "../math/color.js";
import { array, bool, color, entityRef, enumOf, f32, record, u32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { attachShadows, detachShadows, setShadowCasterMeshes } from "./gpu/light-shadows.js";
import { rendererInternals } from "./renderer.js";
import type { RendererImpl } from "./renderer.js";
import type { ComponentHooks } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { AdapterLight, RangedLight } from "../lite/light.js";
import type { LiteShadowGenerator } from "../lite/shadow.js";
import type { ColorLike } from "../math/types.js";
import type { Schema } from "../schema/types.js";

/**
 * Sync lights from entity world poses without parenting the Lite light, so lighting and shadows
 * use the same direction (ADR-0002). Directional and spot lights use forward; hemispheric lights use up.
 *
 * Include/exclude lists use entity mesh ids. Spot shadows use PCF regardless of the requested technique.
 * Shadows require the rendering feature; otherwise the request logs a warning and draws no shadows.
 */

/**
 * Supported light kinds.
 *
 * @public
 */
export const LIGHT_TYPES = ["directional", "point", "spot", "hemispheric"] as const;

/**
 * The union of the light kinds.
 *
 * @public
 */
export type LightType = (typeof LIGHT_TYPES)[number];

/**
 * The union of the shadow techniques a directional light can use.
 *
 * @public
 */
export type ShadowTechniqueName = (typeof SHADOW_TECHNIQUES)[number];

/**
 * The `shadows` record a `Light` declares (`docs/architecture/07-rendering.md` §2.2).
 *
 * @public
 */
export interface LightShadowSettings {
  /** Whether this light casts shadows. */
  enabled: boolean;
  /** The technique; spot lights ignore it and always use PCF, the only one Lite offers them. */
  technique: ShadowTechniqueName;
  /** Shadow map resolution, in texels per side. */
  mapSize: number;
  /** Depth bias applied while sampling. */
  bias: number;
  /** Offset along the surface normal, PCF only. */
  normalBias: number;
  /** How dark a fully shadowed texel is: `0` is black, `1` is unshadowed. */
  darkness: number;
  /** Cascade count, CSM only; Lite clamps it to four. */
  cascades: number;
  /** The distance beyond which nothing is shadowed, in metres; `0` takes Lite's default. */
  maxDistance: number;
}

/** How many elements a 4x4 matrix has. */
const MATRIX_LENGTH = 16;

/** Where the world-space up axis starts inside a column-major world matrix. */
const UP_COLUMN = 4;

/** Where the world-space forward axis starts inside a column-major world matrix. */
const FORWARD_COLUMN = 8;

/** Where the world-space translation starts inside a column-major world matrix. */
const TRANSLATION_COLUMN = 12;

/**
 * A light source (`docs/architecture/07-rendering.md` §2.2).
 *
 * @remarks
 * The entity's transform defines the light: a directional or spot light points along the entity's
 * local `+Z`, a point light sits at its origin, and a hemispheric light's sky direction is its local
 * `+Y`.
 *
 * @example
 * ```ts
 * const sun = world.createEntity("Sun");
 * sun.transform.lookAt({ x: 0, y: 0, z: 0 });
 * sun.addComponent(Light, { type: "directional", intensity: 3, shadows: { enabled: true } });
 * ```
 *
 * @public
 */
export class Light extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Light";

  /** At most one light per entity: two lights from one transform want two entities. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = lightSchema();

  declare type: LightType;

  declare color: ColorLike;

  declare intensity: number;

  declare range: number;

  declare spotAngle: number;

  declare spotExponent: number;

  declare groundColor: ColorLike;

  declare shadows: LightShadowSettings;

  declare includeOnly: (Entity | null)[];

  declare exclude: (Entity | null)[];

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Light.schema));
  }

  readonly #worldMatrix = new Float64Array(MATRIX_LENGTH);

  #light: AdapterLight | null = null;

  #generator: LiteShadowGenerator | null = null;

  #appliedType: LightType | null = null;

  #appliedColor = "";

  #appliedGroundColor = "";

  #appliedIntensity = Number.NaN;

  #appliedRange = Number.NaN;

  #appliedSpotAngle = Number.NaN;

  #appliedSpotExponent = Number.NaN;

  #appliedShadows = false;

  #appliedIncludeSize = -1;

  #appliedExcludeSize = -1;

  #entityVersion = -1;

  #hasWarnedAboutShadows = false;

  /**
   * The Babylon Lite light this component owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The light and its shadow generator, either of which may be `null`.
   */
  get lite(): { readonly light: AdapterLight | null; readonly shadowGenerator: LiteShadowGenerator | null } {
    return { light: this.#light, shadowGenerator: this.#generator };
  }

  /**
   * Whether this light currently casts shadows — which needs the `shadows` rendering feature, a
   * light kind Lite can shadow, and `shadows.enabled`.
   *
   * @returns `true` when a shadow generator is attached.
   */
  get isCastingShadows(): boolean {
    return this.#generator !== null;
  }

  /** Records that the component exists; the Lite light is built on the first sync. */
  onAttach(): void {
    this.#appliedType = null;
  }

  /** Removes the light from the scene and releases its shadow generator. */
  onDetach(): void {
    this.#teardown(rendererInternals(this.app.renderer));
  }

  /**
   * Writes every field that changed onto the Lite light, keeps the lights uniform buffer honest for
   * a moving parent, and re-fits a shadow frustum that follows one. The `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the scene and the feature flags.
   * @returns `true` when the call changed the scene's light topology, which the system coalesces
   * into one `rebuildSceneRenderables`.
   *
   * @internal
   */
  sync(renderer: RendererImpl): boolean {
    let topologyChanged = this.#ensureLight(renderer);
    const light = this.#light;
    if (light === null) {
      return topologyChanged;
    }
    this.#applyColors(light);
    this.#applyScalars(light);
    this.#applyFilters(light);
    topologyChanged = this.#applyShadows(renderer) || topologyChanged;
    this.#followEntity(light);
    return topologyChanged;
  }

  /**
   * Replaces the meshes this light renders into its shadow map.
   *
   * @remarks
   * Lite keys the caster list by array identity and re-preloads the shadow pipeline every time a
   * **new** array arrives, parking the generator until that finishes (`src/lite/shadow.ts`). The
   * `PreRender` system therefore builds one array per frame in which the caster set actually
   * changed, and hands the same array to every casting light.
   *
   * @param casters - The meshes that cast into it.
   *
   * @internal
   */
  setShadowCasters(casters: readonly LiteMesh[]): void {
    const generator = this.#generator;
    if (generator !== null) {
      setShadowCasterMeshes(generator, casters);
    }
  }

  /**
   * Builds the Lite light, replacing it when `type` changed.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when a light was added to or removed from the scene.
   */
  #ensureLight(renderer: RendererImpl): boolean {
    const type: LightType = this.type;
    if (this.#appliedType === type && this.#light !== null) {
      return false;
    }
    this.#teardown(renderer);
    const light = createLightOfType(type, this.intensity);
    this.#light = light;
    this.#appliedType = type;
    this.#appliedColor = "";
    this.#appliedGroundColor = "";
    this.#appliedIntensity = this.intensity;
    this.#appliedRange = Number.NaN;
    this.#appliedSpotAngle = Number.NaN;
    this.#appliedSpotExponent = Number.NaN;
    this.#entityVersion = -1;
    addLightToScene(renderer.scene, light);
    return true;
  }

  /**
   * Writes the sRGB colour fields onto the light, decoded to linear.
   *
   * @param light - The Lite light.
   */
  #applyColors(light: AdapterLight): void {
    const key = colorKey(this.color);
    if (key !== this.#appliedColor) {
      this.#appliedColor = key;
      setLightColor(
        light,
        Color.srgbToLinear(this.color.r),
        Color.srgbToLinear(this.color.g),
        Color.srgbToLinear(this.color.b),
      );
    }
    if (light.lightType !== "hemispheric") {
      return;
    }
    const ground = colorKey(this.groundColor);
    if (ground !== this.#appliedGroundColor) {
      this.#appliedGroundColor = ground;
      setHemisphericGroundColor(
        light,
        Color.srgbToLinear(this.groundColor.r),
        Color.srgbToLinear(this.groundColor.g),
        Color.srgbToLinear(this.groundColor.b),
      );
    }
  }

  /**
   * Writes the numeric fields that apply to this light kind.
   *
   * @param light - The Lite light.
   */
  #applyScalars(light: AdapterLight): void {
    if (this.#appliedIntensity !== this.intensity) {
      this.#appliedIntensity = this.intensity;
      setLightIntensity(light, this.intensity);
    }
    if (isRanged(light) && this.#appliedRange !== this.range) {
      this.#appliedRange = this.range;
      setLightRange(light, this.range);
    }
    if (light.lightType !== "spot") {
      return;
    }
    if (this.#appliedSpotAngle !== this.spotAngle) {
      this.#appliedSpotAngle = this.spotAngle;
      setSpotAngle(light, this.spotAngle);
    }
    if (this.#appliedSpotExponent !== this.spotExponent) {
      this.#appliedSpotExponent = this.spotExponent;
      setSpotExponent(light, this.spotExponent);
    }
  }

  /**
   * Rebuilds the include and exclude mesh-id sets when either list changed length.
   *
   * @remarks
   * Length is the change signal rather than a deep compare: the lists are inspector-edited entity
   * references, they are short, and a swap that keeps the length is rare enough that costing a
   * `Set` rebuild per frame to catch it would be the wrong trade (coding standards §7).
   *
   * @param light - The Lite light.
   */
  #applyFilters(light: AdapterLight): void {
    if (this.#appliedIncludeSize !== this.includeOnly.length) {
      this.#appliedIncludeSize = this.includeOnly.length;
      setLightIncludedMeshIds(light, this.includeOnly.length === 0 ? null : toMeshIds(this.includeOnly));
    }
    if (this.#appliedExcludeSize !== this.exclude.length) {
      this.#appliedExcludeSize = this.exclude.length;
      setLightExcludedMeshIds(light, this.exclude.length === 0 ? null : toMeshIds(this.exclude));
    }
  }

  /**
   * Attaches or detaches the shadow generator the `shadows` record asks for.
   *
   * @param renderer - The rendering service, for the engine and the feature flags.
   * @returns `true` when a generator was attached or detached.
   */
  #applyShadows(renderer: RendererImpl): boolean {
    const light = this.#light;
    const wanted = this.shadows.enabled && renderer.features.shadows && !renderer.isHeadless;
    if (light === null || wanted === this.#appliedShadows) {
      this.#warnAboutShadows(renderer);
      return false;
    }
    this.#appliedShadows = wanted;
    if (!wanted) {
      this.#releaseGenerator(renderer);
      return true;
    }
    this.#generator = attachShadows(renderer.engine, light, this.shadows);
    return true;
  }

  /**
   * Says once, at warning level, that a light asked for shadows the project did not enable.
   *
   * @param renderer - The rendering service, for the feature flags and the log.
   */
  #warnAboutShadows(renderer: RendererImpl): void {
    // Headless does **not** suppress this: "the project forgot the opt-in" is a configuration
    // problem, and a headless test is exactly where a project should find out about it.
    if (this.#hasWarnedAboutShadows || !this.shadows.enabled || renderer.features.shadows) {
      return;
    }
    this.#hasWarnedAboutShadows = true;
    renderer.app.log.warn(
      "{entity} asks for shadows, but the rendering.features.shadows opt-in is off, so it casts none.",
      this.entity.name,
    );
  }

  /**
   * Writes the entity's world pose onto the unparented Lite light, in any frame in which the entity
   * moved.
   *
   * @remarks
   * Unconditional — not only for a caster. The shader, the lights uniform buffer, and the shadow
   * frustum all read this one pose, so skipping it for a light that does not cast would leave the
   * light shading from wherever it was last posed.
   *
   * @param light - The Lite light.
   */
  #followEntity(light: AdapterLight): void {
    const node = entityInternals(this.entity).node;
    const version = worldMatrixVersion(node);
    if (version === this.#entityVersion) {
      return;
    }
    this.#entityVersion = version;
    const matrix = readWorldMatrix(node, this.#worldMatrix);
    syncLightWorldPose(
      light,
      matrix[FORWARD_COLUMN] ?? 0,
      matrix[FORWARD_COLUMN + 1] ?? 0,
      matrix[FORWARD_COLUMN + 2] ?? 1,
      matrix[UP_COLUMN] ?? 0,
      matrix[UP_COLUMN + 1] ?? 1,
      matrix[UP_COLUMN + 2] ?? 0,
      matrix[TRANSLATION_COLUMN] ?? 0,
      matrix[TRANSLATION_COLUMN + 1] ?? 0,
      matrix[TRANSLATION_COLUMN + 2] ?? 0,
    );
  }

  /**
   * Releases the shadow generator, when there is one.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #releaseGenerator(renderer: RendererImpl): void {
    const generator = this.#generator;
    const light = this.#light;
    this.#generator = null;
    if (generator !== null) {
      detachShadows(renderer.scene, light, generator);
    }
  }

  /**
   * Removes the light and its generator from the scene.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #teardown(renderer: RendererImpl): void {
    this.#releaseGenerator(renderer);
    const light = this.#light;
    this.#light = null;
    this.#appliedType = null;
    this.#appliedShadows = false;
    if (light !== null) {
      removeLightFromScene(renderer.scene, light);
    }
  }
}

/**
 * Builds the Lite light of one kind, unparented and at the world origin.
 *
 * @param type - The declared kind.
 * @param intensity - The initial intensity.
 * @returns The light. `Light.sync` poses it from the entity on the same frame.
 */
function createLightOfType(type: LightType, intensity: number): AdapterLight {
  switch (type) {
    case "directional":
      return createDirectionalLightInWorld(intensity);
    case "point":
      return createPointLightInWorld(intensity);
    case "spot":
      return createSpotLightInWorld(45, 2, intensity);
    case "hemispheric":
      return createHemisphericLightInWorld(intensity);
    default:
      return assertNever(type, "light type");
  }
}

/**
 * Whether a light has a distance falloff.
 *
 * @param light - The Lite light.
 * @returns `true` for point and spot lights.
 */
function isRanged(light: AdapterLight): light is RangedLight {
  return light.lightType === "point" || light.lightType === "spot";
}

/**
 * The set of mesh ids a list of entity references restricts a light to.
 *
 * @remarks
 * A `MeshRenderer` names its clone with the owning entity's uid, so the id set is the uid set.
 *
 * @param entities - The referenced entities; `null` entries are references the file could not
 * resolve and are skipped.
 * @returns The ids.
 */
function toMeshIds(entities: readonly (Entity | null)[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    if (entity !== null && entity !== undefined) {
      ids.add(entity.uid);
    }
  }
  return ids;
}

/**
 * A colour's change key: four channels joined, which is cheaper to compare than four fields and
 * allocates one small string only when a colour actually changed.
 *
 * @param value - The colour.
 * @param value.r - The red channel.
 * @param value.g - The green channel.
 * @param value.b - The blue channel.
 * @param value.a - The alpha channel.
 * @returns The key.
 */
function colorKey(value: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): string {
  return `${String(value.r)},${String(value.g)},${String(value.b)},${String(value.a)}`;
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function lightSchema(): Schema {
  return defineSchema({
    type: enumOf(LIGHT_TYPES, "directional", { tooltip: "Which kind of light this is." }),
    color: color("#ffffff", { tooltip: "The light's sRGB colour." }),
    intensity: f32(1, { min: 0, tooltip: "How bright the light is." }),
    range: f32(10, { min: 0, tooltip: "Distance at which a point or spot light reaches zero." }),
    spotAngle: f32(45, { min: 0, max: 180, tooltip: "A spot light's full cone angle, in degrees." }),
    spotExponent: f32(2, { min: 0, tooltip: "A spot light's falloff exponent; higher is sharper." }),
    groundColor: color("#000000", { tooltip: "A hemispheric light's sRGB colour from below." }),
    shadows: record(
      {
        enabled: bool(false, { tooltip: "Whether this light casts shadows." }),
        technique: enumOf(SHADOW_TECHNIQUES, "pcf", { tooltip: "Directional lights only; spot lights use PCF." }),
        mapSize: u32(1024, { min: 16, tooltip: "Shadow map resolution, in texels per side." }),
        bias: f32(0.00005, { tooltip: "Depth bias applied while sampling." }),
        normalBias: f32(0, { tooltip: "Offset along the surface normal, PCF only." }),
        darkness: f32(0, { min: 0, max: 1, tooltip: "How dark a fully shadowed texel is." }),
        cascades: u32(4, { min: 1, max: 4, tooltip: "Cascade count, CSM only." }),
        maxDistance: f32(0, { min: 0, tooltip: "Shadow distance in metres; 0 takes Lite's default." }),
      },
      { tooltip: "Shadow casting; point and hemispheric lights cannot cast (IGX-0703)." },
    ),
    includeOnly: array(entityRef<Entity>(), [], { tooltip: "Light only these entities' renderers." }),
    exclude: array(entityRef<Entity>(), [], { tooltip: "Never light these entities' renderers." }),
  });
}
