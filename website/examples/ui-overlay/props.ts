/**
 * The scene behind the overlay: three shapes turning on the grid, so the overlay has something to
 * sit in front of and the point of an overlay is visible.
 *
 * @remarks
 * A separate file for the reason `pbr-model/shot.ts` is: none of it is a lesson about UI.
 */

import { createMaterialAsset, f32, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import type { App, ScriptCallbacks } from "ignifx";

/** Spins its entity about Y, in degrees per second. */
export class Spinner
  extends Script.define({ speed: f32(30, { tooltip: "Degrees per second about Y." }) })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "ui-overlay/Spinner";

  /** Reused so the per-frame path allocates nothing (coding standards §7). */
  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame, scaled — so `?static=1` holds the pose and a
   * capture of this example is the same frame every time.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}

/**
 * Builds the three props.
 *
 * @remarks
 * `app.registerComponents([Spinner])` is the caller's job, because a game registers every component
 * it uses in one place.
 *
 * @param app - The app the entities and the assets belong to.
 *
 * @example
 * ```ts
 * app.registerComponents([Spinner]);
 * createProps(app);
 * ```
 */
export function createProps(app: App): void {
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "ui-overlay/prop",
      baseColor: { r: 0.55, g: 0.36, b: 0.22, a: 1 },
      metallic: 0.35,
      roughness: 0.4,
    }),
    [],
  );
  const meshes = [
    MeshAsset.box(app, { size: 0.62 }),
    MeshAsset.torus(app, { diameter: 0.8, thickness: 0.22, tessellation: 24 }),
    MeshAsset.capsule(app, { height: 0.9, radius: 0.22, tessellation: 16 }),
  ];
  for (const [index, mesh] of meshes.entries()) {
    const prop = app.world.createEntity(`Prop ${String(index + 1)}`);
    prop.transform.localPosition.set((index - 1) * 1.15, index === 1 ? 0.24 : 0.45, 0);
    prop.transform.localEulerAngles = { x: 0, y: 25 * index, z: index === 1 ? 90 : 0 };
    prop.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: true });
    prop.addComponent(Spinner, { speed: 18 + index * 14 });
  }
}
