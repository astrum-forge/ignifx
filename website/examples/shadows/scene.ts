/**
 * Everything in `shadows` that is not a shadow setting: the casters, the receding pillars, the
 * script that turns the rig, and the numbers the shot is composed with.
 *
 * @remarks
 * Split out for the reason `pbr-model/shot.ts` is: what a reader wants from `main.ts` is the shadow
 * record and what each of its fields does. The one part of this example that *is* a lesson about
 * the engine has its own file, `rebuild.ts`.
 */

import { createMaterialAsset, f32, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import { createGridGround } from "../_kit/stage.ts";
import type { App, AssetHandle, ColorLike, Entity, ScriptCallbacks } from "ignifx";

/** Where the camera looks, between the orbiting casters and the receding pillars. */
export const FOCUS = { x: 0.7, y: 1.1, z: 2.6 } as const;

/** The one light that casts: a warm sun from the front upper left. */
export const SUN = {
  color: { r: 1, g: 0.945, b: 0.839, a: 1 },
  intensity: 2.6,
  at: { x: -5.5, y: 7, z: -2.5 },
} as const;

/** A soft, cool fill so the shadow side is readable without washing the shadow out. */
export const FILL = { color: { r: 0.576, g: 0.706, b: 1, a: 1 }, intensity: 0.32 } as const;

/** The shadow settings the example opens on. */
export const SHADOWS = {
  technique: "pcf",
  mapSize: 1024,
  bias: 0.00005,
  normalBias: 0.02,
  darkness: 0.12,
  cascades: 4,
  maxDistance: 0,
} as const;

/** How fast the casters turn when the page loads, in degrees per second. */
export const CASTER_SPIN = 22;

/** The map sizes the panel offers, as the labels it shows them under. */
export const MAP_SIZES: Readonly<Record<string, number>> = { "512": 512, "1024": 1024, "2048": 2048, "4096": 4096 };

/**
 * The shadow techniques, by the label the panel shows; the values are `SHADOW_TECHNIQUES`.
 *
 * @remarks
 * PCF filters several taps of a depth map and gives a defined contact shadow; ESM stores an
 * exponential of depth and is blurred by construction, which is cheaper than widening a PCF kernel;
 * CSM splits the view into up to four depth slices so a distant shadow keeps its texels. A **spot**
 * light ignores all of this and always uses PCF, the only generator Lite gives it.
 */
export const TECHNIQUES: Readonly<Record<string, "csm" | "esm" | "pcf">> = {
  PCF: "pcf",
  ESM: "esm",
  "CSM (cascades)": "csm",
};

/**
 * The label {@link TECHNIQUES} shows one technique under.
 *
 * @param technique - The engine's own name for it.
 * @returns The panel's label, or the first one when nothing matches.
 */
export function labelFor(technique: string): string {
  return Object.keys(TECHNIQUES).find((label: string) => TECHNIQUES[label] === technique) ?? "PCF";
}

/** The colour the casters and pillars are drawn in. */
const CASTER_COLOR: ColorLike = { r: 0.82, g: 0.83, b: 0.86, a: 1 };

/** The ground plane's edge length, in metres. Long enough for a cascade split to be visible. */
const GROUND_SIZE = 90;

/** How far the casters orbit from the turntable's centre, in metres. */
const ORBIT_RADIUS = 2.6;

/** Where the pillars stand along +Z, in metres: near, then receding away from the camera. */
const PILLAR_DISTANCES: readonly number[] = Object.freeze([7, 12, 19, 28, 40]);

/** How tall a pillar is, in metres. */
const PILLAR_HEIGHT = 2.4;

/** A point in metres, as the kit's options and `createEntity` take one. */
interface Point3 {
  /** Metres along X. */
  readonly x: number;
  /** Metres along Y. */
  readonly y: number;
  /** Metres along Z. */
  readonly z: number;
}

/**
 * Writes a slider's value as a distance, and zero as what zero means.
 *
 * @param value - Metres.
 * @returns The text for the slider's value cell.
 */
export function metresOrDefault(value: number): string {
  return value === 0 ? "Lite's default" : `${String(value)} m`;
}

/**
 * Writes a slider's value as a rate.
 *
 * @param value - Degrees per second.
 * @returns The text for the slider's value cell.
 */
export function degreesPerSecond(value: number): string {
  return `${String(value)}°/s`;
}

/**
 * Writes a bias slider's value, which is small enough to need its exponent.
 *
 * @param value - The bias, in Lite's depth units.
 * @returns The text for the slider's value cell.
 */
export function exponential(value: number): string {
  return value === 0 ? "0" : value.toExponential(1);
}

/** Turns its entity about world Y, in degrees per second. */
export class Turntable extends Script.define({ speed: f32(0) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "shadows/Turntable";

  /** Reused so the per-frame path allocates nothing (coding standards §7). */
  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame, already scaled by `time.timeScale`. Under
   * `?static=1` the scale is zero, so the casters hold the pose they were authored at.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}

/**
 * Builds the floor, the turning casters and the receding pillars.
 *
 * @remarks
 * Two kinds of caster, for two kinds of question. The four shapes on the turntable are close to the
 * camera and always moving, which is where the technique, the map size and the biases show: a
 * sphere's contact shadow, a torus shadowing itself, and the acne a PCF map stripes across a curved
 * surface when `normalBias` is zero. The five pillars recede to forty metres, which is where the
 * cascade count and the shadow distance show — turn `maxDistance` down and the far pillars lose
 * their shadows one by one.
 *
 * @param app - The app the entities and assets belong to.
 * @returns The turntable entity, so the caller can attach {@link Turntable} to it.
 *
 * @example
 * ```ts
 * const casters = await createCasters(app);
 * casters.addComponent(Turntable, { speed: CASTER_SPIN });
 * ```
 */
export async function createCasters(app: App): Promise<Entity> {
  await createGridGround(app, { size: GROUND_SIZE });

  const chalk = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "shadows/chalk",
      baseColor: CASTER_COLOR,
      metallic: 0,
      roughness: 0.62,
      environmentIntensity: 0,
    }),
    [],
  );
  const place = (name: string, mesh: AssetHandle<MeshAsset>, at: Point3, parent?: Entity): Entity => {
    const position = { x: at.x, y: at.y, z: at.z };
    const entity =
      parent === undefined
        ? app.world.createEntity(name, { position })
        : app.world.createEntity(name, { parent, position });
    entity.addComponent(MeshRenderer, { mesh, materials: [chalk], castShadows: true, receiveShadows: true });
    return entity;
  };

  const turntable = app.world.createEntity("Casters");
  const r = ORBIT_RADIUS;
  // A sphere with few segments on purpose: shadow acne is a facet artefact, and sixteen segments is
  // where a 1024-texel map with no normal bias shows it plainly.
  place("Sphere", MeshAsset.sphere(app, { diameter: 1.5, segments: 16 }), { x: r, y: 0.75, z: 0 }, turntable);
  const torus = MeshAsset.torus(app, { diameter: 1.7, thickness: 0.38, tessellation: 28 });
  place("Torus", torus, { x: 0, y: 1.5, z: r }, turntable);
  place("Box", MeshAsset.box(app, { size: 1.2 }), { x: -r, y: 0.6, z: 0 }, turntable);
  const capsule = MeshAsset.capsule(app, { height: 1.8, radius: 0.34, tessellation: 20 });
  place("Capsule", capsule, { x: 0, y: 0.9, z: -r }, turntable);

  // The pillars are separate entities, not children of the turntable: what they are for is depth,
  // and a pillar that moved would take its shadow's distance with it.
  const pillar = MeshAsset.box(app, { width: 0.5, height: PILLAR_HEIGHT, depth: 0.5 });
  for (const distance of PILLAR_DISTANCES) {
    place("Pillar", pillar, { x: distance * 0.42, y: PILLAR_HEIGHT / 2, z: distance });
  }

  return turntable;
}
