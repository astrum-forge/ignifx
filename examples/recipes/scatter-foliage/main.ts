/**
 * Scatter foliage on terrain
 *
 * `TerrainScatter` places instances on the terrain it shares an entity with — or on any ancestor's
 * — by seeded rules: a density in instances per square metre, the splat layers a candidate may
 * stand on, and the slope and height bands it must fall in. Placement is a pure function of the
 * seed, the height field and the rules, so a headless test asserts the same grass a device draws.
 *
 * It places **once**, into the `InstancedMeshRenderer` it requires, and `maxInstances` sizes that
 * renderer's GPU buffer before the scene is registered — so set it before `app.start()` and call
 * `regenerate()` after changing a rule. A sculpt regenerates by itself.
 *
 * `createFoliageMaterial` builds a shader material with a vertex-stage wind, because a surface
 * shader's `displace` hook cannot read the clock: Babylon Lite's plugin uniforms are fragment-stage
 * only. That is the trade — wind, alpha cutout and cheap Lambert lighting, but no image-based
 * lighting, no fog, and shadows cast (as solid cards) rather than received.
 */
import { Camera, Light, MeshAsset, createApp } from "@ignifx/core";
import { Terrain, TerrainScatter, createFoliageMaterial, terrain } from "@ignifx/terrain";
import type { TextureAsset } from "@ignifx/core";
import type { TerrainAsset } from "@ignifx/terrain";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({
  canvas,
  settings: { assets: { root: "assets" }, rendering: { features: { shadows: true } } },
  extensions: [terrain()],
});

const island = await app.assets.loadAsync<TerrainAsset>("terrain/island.terrain.json");
const card = await app.assets.loadAsync<TextureAsset>("terrain/grass-card.png");

const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 12, -30);
eye.transform.lookAt({ x: 0, y: 4, z: 0 });
eye.addComponent(Camera, { fov: 60, far: 1500 });

const sun = app.world.createEntity("Sun");
sun.transform.lookAt({ x: 1, y: -1.4, z: 0.6 });
sun.addComponent(Light, { type: "directional", intensity: 3 }).shadows.enabled = true;

const ground = app.world.createEntity("Island");
ground.addComponent(Terrain, { definition: island });

// Alpha-cutout cards that sway; `wind: null` is a still, cheaper material.
const grassMaterial = await createFoliageMaterial(app, {
  albedo: card,
  alphaCutoff: 0.4,
  doubleSided: true,
  wind: { strength: 0.3, frequency: 1.2, height: 1 },
});

// The scatter rides on the terrain's own entity, so it reads its height field directly.
const grass = ground.addComponent(TerrainScatter, {
  mesh: MeshAsset.plane(app, { width: 0.6, height: 0.8 }),
  material: grassMaterial,
  density: 2,
  // Only where the splat says grass, and only on ground a blade could grow on.
  layers: ["grass"],
  layerThreshold: 0.5,
  slope: { x: 0, y: 25 },
  height: { x: 1, y: 45 },
  scale: { x: 0.8, y: 1.3 },
  randomYaw: true,
  alignToNormal: false,
  seed: 4,
  // Sizes the instance buffer: raising it after `app.start()` is refused with IGX-0717.
  maxInstances: 20_000,
});

await app.start();
app.log.info("blades placed:", grass.count);

// A density slider changes the rule and then asks for the placement again; it is not per-frame work.
grass.density = 4;
grass.regenerate();
app.log.info("after the density change:", grass.count);
