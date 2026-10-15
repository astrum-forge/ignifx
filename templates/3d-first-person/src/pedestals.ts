import { MeshRenderer } from "@ignifx/core";
import type { App, AssetHandle, Entity, MaterialAsset } from "@ignifx/core";

/**
 * The interactable pedestals of the loaded scene, each given a material of its own.
 *
 * ## Why the clone is code
 *
 * Lighting a pedestal recolours its material with `setBaseColor`, which writes the Lite material
 * every renderer sharing the asset draws with. The scene file names the shared
 * `crate.material.json` on all three, because a scene file can only name a material by its asset
 * address and a runtime clone has none. Each pedestal therefore gets its own `clone` here, after
 * the load and before the first frame builds the renderer's mesh, so recolouring one does not
 * recolour them all.
 */

/** One thing the crosshair ray can find. */
export interface Interactable {
  /** The entity the ray hits. */
  readonly entity: Entity;
  /** The pedestal's private material clone, so recolouring one does not recolour them all. */
  readonly material: AssetHandle<MaterialAsset>;
  /** The emissive cap, shown only while the pedestal is lit. */
  readonly glow: MeshRenderer;
}

/**
 * Finds every pedestal — every renderer on the `Interactable` layer, in scene order — and swaps its
 * shared material for a clone of its own.
 *
 * @param app - The app the scene was loaded in.
 * @returns The pedestals.
 * @throws Error when a pedestal has no material or no child renderer for its cap.
 */
export function preparePedestals(app: App): Interactable[] {
  const layer = app.world.layers.requireIndex("Interactable");
  const pedestals: Interactable[] = [];
  for (const renderer of app.world.components(MeshRenderer)) {
    const entity = renderer.entity;
    if (entity.layer !== layer) {
      continue;
    }
    const shared = renderer.materials[0];
    const glow = entity.children.map((child) => child.getComponent(MeshRenderer)).find((found) => found !== null);
    if (shared === undefined || shared === null || glow === undefined) {
      throw new Error(`The pedestal "${entity.name}" needs a material and a child renderer for its cap.`);
    }
    const material = shared.value.clone(app);
    renderer.materials = [material];
    pedestals.push({ entity, material, glow });
  }
  return pedestals;
}
