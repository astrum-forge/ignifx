/**
 * The light gizmos `lights` draws: the small unlit shapes that show where a light is, which way it
 * points, how far it reaches and how wide its cone is.
 *
 * @remarks
 * A light is invisible. That is the whole difficulty of a lighting example — you can see what a
 * light does and not what it is, so a slider moves and nothing on screen says *which* lamp moved.
 * Every editor answers that with gizmos, and this file is the handful of primitives that draw them,
 * built from `MeshAsset` factories in code so the example still loads no assets.
 *
 * ## Why the gizmos are `unlit`, not emissive
 *
 * A material's `emissive` is fixed when the material is built: `MaterialAsset` exposes
 * `setBaseColor`, `setMetallicRoughness` and `setAlpha`, and nothing for emissive. A gizmo has to
 * repaint itself whenever the visitor moves a colour picker, so it is `unlit: true` instead — an
 * unlit surface draws its base colour and nothing else, whatever the lights do, and `setBaseColor`
 * is one uniform write with no pipeline rebuild.
 *
 * ## The one rotation worth stating
 *
 * `MeshAsset.cylinder` stands along **+Y**, and a light points along its entity's **+Z**
 * (`skills/ignifx/references/concepts/rendering.md` §1). So every gizmo that has to lie along the
 * light's direction — the arrow and the cone — is parented to the light's entity and pitched by
 * {@link ALIGN_Y_TO_Z} about X, which maps the mesh's +Y onto the parent's +Z. ignifx is
 * left-handed, so that rotation is `+90` and not `-90`.
 */

import { createMaterialAsset, degToRad, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import type { App, AssetHandle, ColorLike, Entity, MaterialAsset } from "ignifx";

/** The X rotation, in degrees, that puts a `MeshAsset.cylinder`'s +Y axis along its parent's +Z. */
const ALIGN_Y_TO_Z = 90;

/** How much of an arrow's length is shaft; the rest is the head. */
const SHAFT_FRACTION = 0.72;

/** An arrow's shaft diameter, as a fraction of its length. */
const SHAFT_THICKNESS = 0.045;

/** An arrow's head diameter, as a fraction of its length. */
const HEAD_THICKNESS = 0.16;

/** How many radial segments a gizmo cone or disc is built from. Enough that no facet shows. */
const SEGMENTS = 24;

/** How opaque a spot light's cone is drawn. Low: it is a hint, and the subject is behind it. */
const CONE_ALPHA = 0.16;

/** The tube thickness of a range ring, in metres, before the entity's scale is applied. */
const RING_THICKNESS = 0.02;

/** How opaque a range ring is drawn: a hint on the floor, not a pipe around the scene. */
const RING_ALPHA = 0.5;

/** A hemispheric marker's ball, as a fraction of the marker's width. */
const SKY_BALL_FRACTION = 0.5;

/** How far the ball floats above the disc, as a fraction of the marker's width. */
const SKY_BALL_LIFT = 0.3;

/** The ground disc's thickness, as a fraction of the marker's width. */
const SKY_DISC_THICKNESS = 0.06;

/** A gizmo: some geometry under one entity, and one material the example repaints. */
export interface Gizmo {
  /** The gizmo's root entity, so an example can hide it with `active = false`. */
  readonly entity: Entity;
  /**
   * Repaints the gizmo, so it keeps matching the light it stands for.
   *
   * @param color - The new sRGB colour.
   */
  readonly setColor: (color: ColorLike) => void;
}

/** A range ring, which also follows its light's `range`. */
export interface RingGizmo extends Gizmo {
  /**
   * Resizes the ring.
   *
   * @param radius - The new radius, in metres.
   */
  readonly setRadius: (radius: number) => void;
}

/** A spot light's cone, which also follows its `spotAngle`. */
export interface ConeGizmo extends Gizmo {
  /**
   * Reshapes the cone.
   *
   * @param angleDegrees - The light's full cone angle, in degrees.
   */
  readonly setAngle: (angleDegrees: number) => void;
}

/** A hemispheric light's two-tone marker, which has a colour above and a colour below. */
export interface SkyGizmo {
  /** The marker's root entity. */
  readonly entity: Entity;
  /**
   * Repaints the upper disc.
   *
   * @param color - The light's sRGB sky colour.
   */
  readonly setSkyColor: (color: ColorLike) => void;
  /**
   * Repaints the lower disc.
   *
   * @param color - The light's sRGB ground colour.
   */
  readonly setGroundColor: (color: ColorLike) => void;
}

/** What the orb, arrow, ring and sky-marker factories take. */
export interface GizmoOptions {
  /** The entity the gizmo hangs under — the light's entity, so it inherits its pose. */
  readonly parent: Entity;
  /** The gizmo's size in metres: an orb's diameter, an arrow's length, a ring's radius. */
  readonly size: number;
  /** The colour it opens on, in sRGB. */
  readonly color: ColorLike;
}

/** What {@link createCone} takes. */
export interface ConeGizmoOptions {
  /** The spot light's entity. */
  readonly parent: Entity;
  /** How far down the beam the cone is drawn, in metres. */
  readonly length: number;
  /** The light's full cone angle, in degrees. */
  readonly angleDegrees: number;
  /** The colour it opens on, in sRGB. */
  readonly color: ColorLike;
}

/**
 * Builds one unlit material, which is what makes a gizmo read as a lamp rather than as an object.
 *
 * @param app - The app the material belongs to.
 * @param name - The material's name, which the devtools inspector shows.
 * @param color - The sRGB colour.
 * @param alpha - The opacity; below 1 the material is alpha-blended and double-sided.
 * @returns The material's handle.
 */
function unlitMaterial(app: App, name: string, color: ColorLike, alpha = 1): AssetHandle<MaterialAsset> {
  return createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name,
      baseColor: { r: color.r, g: color.g, b: color.b, a: alpha },
      metallic: 0,
      roughness: 1,
      unlit: true,
      alpha,
      // A cone is a hint drawn over the scene, so it blends and shows both of its faces; an orb or
      // an arrow is a solid object and neither.
      alphaMode: alpha < 1 ? "blend" : "opaque",
      doubleSided: alpha < 1,
    }),
    [],
  );
}

/**
 * Adds one gizmo mesh to an entity: never a caster, never a receiver, never pickable.
 *
 * @param entity - The entity to draw it on.
 * @param mesh - The geometry's handle.
 * @param material - The material's handle.
 */
function addGizmoMesh(entity: Entity, mesh: AssetHandle<MeshAsset>, material: AssetHandle<MaterialAsset>): void {
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
}

/**
 * A small glowing ball where a light sits: the gizmo for a point or spot light.
 *
 * @param app - The app the entities and assets belong to.
 * @param options - The parent, the diameter and the colour.
 * @returns The gizmo.
 *
 * @example
 * ```ts
 * const orb = createOrb(app, { parent: lamp, size: 0.18, color: { r: 1, g: 0.8, b: 0.5, a: 1 } });
 * orb.setColor({ r: 0.4, g: 0.7, b: 1, a: 1 });
 * ```
 */
export function createOrb(app: App, options: GizmoOptions): Gizmo {
  const material = unlitMaterial(app, "gizmo/orb", options.color);
  const entity = app.world.createEntity("Light Orb", { parent: options.parent });
  addGizmoMesh(entity, MeshAsset.sphere(app, { diameter: options.size, segments: 16 }), material);
  return {
    entity,
    setColor: (color: ColorLike): void => {
      material.value.setBaseColor(color);
    },
  };
}

/**
 * An arrow along its parent's forward axis: the gizmo for a directional light, which has a
 * direction and no position at all.
 *
 * @param app - The app the entities and assets belong to.
 * @param options - The parent, the total length and the colour.
 * @returns The gizmo.
 *
 * @example
 * ```ts
 * createArrow(app, { parent: sunEntity, size: 1.4, color: { r: 1, g: 0.95, b: 0.86, a: 1 } });
 * ```
 */
export function createArrow(app: App, options: GizmoOptions): Gizmo {
  const length = options.size;
  const material = unlitMaterial(app, "gizmo/arrow", options.color);
  // The root carries the one rotation this file exists to state: mesh +Y onto the parent's +Z.
  const entity = app.world.createEntity("Light Arrow", { parent: options.parent });
  entity.transform.localEulerAngles = { x: ALIGN_Y_TO_Z, y: 0, z: 0 };

  const shaft = app.world.createEntity("Arrow Shaft", { parent: entity });
  shaft.transform.localPosition.set(0, (length * SHAFT_FRACTION) / 2, 0);
  addGizmoMesh(
    shaft,
    MeshAsset.cylinder(app, {
      height: length * SHAFT_FRACTION,
      diameter: length * SHAFT_THICKNESS,
      tessellation: 10,
    }),
    material,
  );

  const head = app.world.createEntity("Arrow Head", { parent: entity });
  head.transform.localPosition.set(0, length * (1 - (1 - SHAFT_FRACTION) / 2), 0);
  addGizmoMesh(
    head,
    MeshAsset.cylinder(app, {
      height: length * (1 - SHAFT_FRACTION),
      diameterTop: 0,
      diameterBottom: length * HEAD_THICKNESS,
      tessellation: 12,
    }),
    material,
  );

  return {
    entity,
    setColor: (color: ColorLike): void => {
      material.value.setBaseColor(color);
    },
  };
}

/**
 * A horizontal ring at a light's `range`: the distance at which a point or spot light reaches zero.
 *
 * @remarks
 * The mesh is built at unit radius and the entity is **scaled**, so dragging the range slider
 * resizes the ring with one write and no new geometry. `MeshAsset.torus` lies in the XZ plane, and
 * `localScale` is applied before the entity's rotation, so scaling X and Z is scaling the radius.
 *
 * @param app - The app the entities and assets belong to.
 * @param options - The parent, the starting radius and the colour.
 * @returns The gizmo, with {@link RingGizmo.setRadius}.
 *
 * @example
 * ```ts
 * const ring = createRing(app, { parent: lamp, size: light.range, color: warm });
 * ring.setRadius(12);
 * ```
 */
export function createRing(app: App, options: GizmoOptions): RingGizmo {
  const material = unlitMaterial(app, "gizmo/ring", options.color, RING_ALPHA);
  const entity = app.world.createEntity("Range Ring", { parent: options.parent });
  // `diameter` is the ring's outer diameter, so 2 is a radius of 1 — the unit the scale multiplies.
  addGizmoMesh(
    entity,
    MeshAsset.torus(app, { diameter: 2, thickness: RING_THICKNESS, tessellation: SEGMENTS * 2 }),
    material,
  );
  const setRadius = (radius: number): void => {
    // Y is left at 1: a thicker tube would read as a change in the range, which it is not.
    entity.transform.localScale.set(radius, 1, radius);
  };
  setRadius(options.size);
  return {
    entity,
    setColor: (color: ColorLike): void => {
      material.value.setBaseColor(color);
    },
    setRadius,
  };
}

/**
 * The cone a spot light throws: apex at the lamp, opening along the light's forward axis.
 *
 * @remarks
 * Built at unit base radius over `length` metres, and reshaped by scaling X and Z to
 * `length × tan(spotAngle / 2)` — the radius the cone's mouth actually has at that distance. The
 * apex sits on the lamp because the mesh is pushed back half its length along the rotated axis; a
 * cone centred on the lamp instead of starting there points the wrong way half the time.
 *
 * @param app - The app the entities and assets belong to.
 * @param options - The parent, the cone's length, its starting angle and the colour.
 * @returns The gizmo, with {@link ConeGizmo.setAngle}.
 *
 * @example
 * ```ts
 * const cone = createCone(app, { parent: lamp, length: 4, angleDegrees: 34, color: warm });
 * cone.setAngle(spot.spotAngle);
 * ```
 */
export function createCone(app: App, options: ConeGizmoOptions): ConeGizmo {
  const length = options.length;
  const material = unlitMaterial(app, "gizmo/cone", options.color, CONE_ALPHA);
  const entity = app.world.createEntity("Spot Cone", { parent: options.parent });
  entity.transform.localEulerAngles = { x: ALIGN_Y_TO_Z, y: 0, z: 0 };

  const shape = app.world.createEntity("Cone Shape", { parent: entity });
  // `diameterTop: 2, diameterBottom: 0` puts the apex at the mesh's **-Y** end, and the mesh spans
  // -length/2 to +length/2 about its own origin — so pushing it half its length **along** the
  // rotated axis puts the apex on the lamp and the mouth `length` metres down the beam.
  shape.transform.localPosition.set(0, length / 2, 0);
  addGizmoMesh(
    shape,
    MeshAsset.cylinder(app, { height: length, diameterTop: 2, diameterBottom: 0, tessellation: SEGMENTS }),
    material,
  );
  const setAngle = (angleDegrees: number): void => {
    const radius = length * Math.tan(degToRad(angleDegrees) / 2);
    shape.transform.localScale.set(radius, 1, radius);
  };
  setAngle(options.angleDegrees);
  return {
    entity,
    setColor: (color: ColorLike): void => {
      material.value.setBaseColor(color);
    },
    setAngle,
  };
}

/**
 * The marker for a hemispheric light: a ball in the sky colour sitting on a disc in the ground
 * colour.
 *
 * @remarks
 * A hemispheric light has **no position** — only a sky direction, which is its entity's +Y — so
 * this marker is a legend rather than a location: the two colours the light mixes between, stacked
 * along that axis. The disc is wider than the ball so both read from a camera looking down at it,
 * which is where an example's camera usually is. Moving its entity changes nothing about the light
 * except which way "up" is.
 *
 * @param app - The app the entities and assets belong to.
 * @param options - The parent, the disc's diameter and the starting sky colour.
 * @returns The gizmo.
 *
 * @example
 * ```ts
 * const sky = createSkyMarker(app, { parent: ambient, size: 0.8, color: skyBlue });
 * sky.setGroundColor({ r: 0.3, g: 0.22, b: 0.16, a: 1 });
 * ```
 */
export function createSkyMarker(app: App, options: GizmoOptions): SkyGizmo {
  const upper = unlitMaterial(app, "gizmo/sky", options.color);
  const lower = unlitMaterial(app, "gizmo/ground", { r: 0.18, g: 0.15, b: 0.13, a: 1 });
  const entity = app.world.createEntity("Hemispheric Marker", { parent: options.parent });

  const ball = app.world.createEntity("Sky Ball", { parent: entity });
  ball.transform.localPosition.set(0, options.size * SKY_BALL_LIFT, 0);
  addGizmoMesh(ball, MeshAsset.sphere(app, { diameter: options.size * SKY_BALL_FRACTION, segments: 16 }), upper);

  const disc = app.world.createEntity("Ground Disc", { parent: entity });
  addGizmoMesh(
    disc,
    MeshAsset.cylinder(app, {
      height: options.size * SKY_DISC_THICKNESS,
      diameter: options.size,
      tessellation: SEGMENTS,
    }),
    lower,
  );

  return {
    entity,
    setSkyColor: (color: ColorLike): void => {
      upper.value.setBaseColor(color);
    },
    setGroundColor: (color: ColorLike): void => {
      lower.value.setBaseColor(color);
    },
  };
}
