/**
 * The scene the overlay watches: a pylon and a ring of drones that keep moving, so the Stats
 * panel's numbers change and the Timeline graph has something to draw.
 *
 * @remarks
 * A separate file for the reason `pbr-model/shot.ts` is: none of it is a lesson about devtools.
 * `main.ts` is then the settings section that opens the overlay, the selection it opens pointed at,
 * and the panel that drives both.
 *
 * The loop at the bottom is exactly what the overlay's **Scene** tab shows: one entity per drone,
 * named, under the world's root. Selecting a row there points the Inspector at that drone, and the
 * Inspector's rows are this file's `Script.define` fields.
 */

import { createMaterialAsset, f32, i32, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import type { App, ScriptCallbacks } from "ignifx";

/** How many drones orbit the pylon. */
export const DRONES = 7;

/** The speed a drone starts at, in degrees per second, before its per-index stagger. */
export const START_SPEED = 36;

/** Carries one drone around the centre. */
export class Drone
  extends Script.define({
    index: i32(0, { min: 0, tooltip: "Which drone this is; sets its phase around the ring." }),
    speed: f32(START_SPEED, { min: 0, tooltip: "Degrees around the ring per second." }),
    radius: f32(1.35, { min: 0.1, tooltip: "How far out the drone flies, in metres." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "devtools/Drone";

  /** How far round the circle this drone has travelled, in degrees. */
  #angle = 0;

  /**
   * Advances the orbit.
   *
   * @param dt - Seconds since the previous frame, scaled — so `?static=1` holds the ring still
   * while the overlay keeps refreshing, because the overlay runs on the **unscaled** clock. That
   * is what makes this example's capture reproducible with the overlay up.
   */
  update(dt: number): void {
    this.#angle += this.speed * dt;
    const phase = ((this.index / DRONES) * 360 + this.#angle) * (Math.PI / 180);
    this.transform.localPosition.set(
      Math.cos(phase) * this.radius,
      0.5 + Math.sin(phase * 2) * 0.22,
      Math.sin(phase) * this.radius,
    );
  }
}

/**
 * Builds the pylon and the ring.
 *
 * @remarks
 * `app.registerComponents([Drone])` is the caller's job, because a game registers every component
 * it uses in one place.
 *
 * @param app - The app the entities and the assets belong to.
 *
 * @example
 * ```ts
 * app.registerComponents([Drone]);
 * createRing(app);
 * ```
 */
export function createRing(app: App): void {
  const shell = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "devtools/shell",
      baseColor: { r: 0.3, g: 0.42, b: 0.55, a: 1 },
      metallic: 0.5,
      roughness: 0.32,
    }),
    [],
  );
  const core = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "devtools/core",
      baseColor: { r: 0.18, g: 0.2, b: 0.24, a: 1 },
      metallic: 0.2,
      roughness: 0.55,
      emissive: { r: 0.55, g: 0.24, b: 0.06, a: 1 },
    }),
    [],
  );

  const pylon = app.world.createEntity("Pylon");
  pylon.transform.localPosition.set(0, 0.42, 0);
  pylon.addComponent(MeshRenderer, {
    mesh: MeshAsset.cylinder(app, { height: 0.84, diameterTop: 0.24, diameterBottom: 0.44, tessellation: 24 }),
    materials: [core],
    castShadows: true,
  });

  // One mesh shared by every drone, one entity each.
  const droneMesh = MeshAsset.capsule(app, { height: 0.34, radius: 0.09, tessellation: 12 });
  for (let index = 0; index < DRONES; index += 1) {
    const drone = app.world.createEntity(`Drone ${String(index + 1)}`);
    drone.addComponent(MeshRenderer, { mesh: droneMesh, materials: [shell], castShadows: true });
    drone.addComponent(Drone, { index, speed: START_SPEED + index * 3 });
  }
}
