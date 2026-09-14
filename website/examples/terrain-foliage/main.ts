import {
  Camera,
  createFoliageMaterial,
  Environment,
  InstancedMeshRenderer,
  Light,
  Terrain,
  terrain,
  terrainAssetFromDefinition,
  TerrainScatter,
  TEXTURE_ASSET_TYPE,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, slider } from "../_kit/panel.ts";
import { conifer, grassCard } from "./meshes.ts";
import type { AssetHandle, MaterialAsset, TextureAsset } from "ignifx";

/**
 * Grass and trees on a terrain: two `TerrainScatter` components, two draw calls, and no model file.
 *
 * ## Where an instance is allowed to stand
 *
 * A scatter walks a jittered grid over the field — `density` instances per square metre, capped by
 * `maxInstances` — and keeps a candidate only if its slope, its height and the terrain's **splat
 * weight** for the named layers all accept it. Every random number is an integer hash of the cell
 * and the seed, never a running generator, so the same seed places the same forest in a headless
 * test and on a device. Placement runs **once**, not per frame; a changed rule needs
 * `regenerate()`, and a sculpt triggers one by itself.
 *
 * ## What draws them
 *
 * Each scatter owns an `InstancedMeshRenderer` with `gpuCulling` on, so Babylon Lite's compute
 * culling drops the instances behind the camera before the vertex stage, and a `lodMesh` partner
 * that takes over past `lodDistance`. One material draws every instance.
 *
 * ## Why foliage is a shader material and not PBR
 *
 * `createFoliageMaterial` builds a `"shader"` material that owns its vertex stage, because that is
 * the only way the wind can read the clock: Babylon Lite declares a material plugin's uniforms
 * fragment-visible only, so a `displace` surface hook has no time to sway with. The price is
 * stated plainly — the cards cast shadows but receive none, and get no image-based lighting.
 */

/** The grass card's alpha-tested albedo, written by `_tools/make-terrain-assets.ts`. */
const GRASS_CARD = "terrain/grass_card.png";

/** The conifer atlas: leaf in the top half, bark in the bottom. */
const TREE_ATLAS = "terrain/tree_atlas.png";

/** The sky the meadow stands against. */
const SKY = { r: 0.59, g: 0.72, b: 0.85, a: 1 } as const;

/** The opening shot: low and close, so the near grass reads as blades. */
const SHOT = { yaw: 28, pitch: 11, distance: 30, x: 0, z: 10, lift: 3 } as const;

/**
 * Writes an instance count with thousands separators.
 *
 * @param value - The count.
 * @returns The text for the value cell.
 */
function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}

bootExample({
  title: "Terrain foliage",
  extensions: [terrain()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const meadow = await terrainAssetFromDefinition(app, {
      name: "meadow",
      size: { width: 160, depth: 160, height: 18 },
      resolution: 257,
      chunks: { size: 32, lodLevels: 3, lodDistance: 60, skirtDepth: 1 },
      noise: { seed: 12, octaves: 5, frequency: 0.012, persistence: 0.48 },
      layers: [
        { name: "grass", color: [0.29, 0.42, 0.2] },
        { name: "rock", color: [0.44, 0.42, 0.39] },
      ],
      splatRules: [
        { layer: "grass", slope: [0, 26] },
        { layer: "rock", slope: [22, 90] },
      ],
      material: { roughness: 0.95, metallic: 0 },
    });

    const blades = await app.assets.loadAsync<TextureAsset>(GRASS_CARD, { type: TEXTURE_ASSET_TYPE });
    const bark = await app.assets.loadAsync<TextureAsset>(TREE_ATLAS, { type: TEXTURE_ASSET_TYPE });
    const grassMaterial: AssetHandle<MaterialAsset> = await createFoliageMaterial(app, {
      albedo: blades,
      wind: { strength: 0.22, frequency: 1.4, height: 1 },
      alphaCutoff: 0.45,
    });
    const treeMaterial: AssetHandle<MaterialAsset> = await createFoliageMaterial(app, {
      albedo: bark,
      // A trunk that swayed as far as a blade of grass would tear out of the ground: the lean is
      // quoted at `height` metres up, so a tall mesh needs a tall reference height.
      wind: { strength: 0.16, frequency: 0.55, height: 4 },
      alphaCutoff: 0.2,
    });

    // Placed above the ground rather than at the origin: a directional shadow map is fitted around
    // the light's own node, so a sun sitting inside the terrain casts nothing onto it.
    const sun = app.world.createEntity("Sun", { position: { x: -34, y: 48, z: -28 } });
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    const key = sun.addComponent(Light, {
      type: "directional",
      intensity: 3.1,
      color: { r: 1, g: 0.97, b: 0.9, a: 1 },
    });
    key.shadows.enabled = true;
    key.shadows.mapSize = 2048;
    key.shadows.maxDistance = 90;
    key.shadows.darkness = 0.35;
    key.shadows.normalBias = 0.02;
    app.world.createEntity("Sky light").addComponent(Light, {
      type: "hemispheric",
      intensity: 0.95,
      color: SKY,
      groundColor: { r: 0.26, g: 0.3, b: 0.2, a: 1 },
    });

    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: SKY });
    sky.imageProcessing.toneMapping = "aces";

    const groundEntity = app.world.createEntity("Meadow");
    const ground = groundEntity.addComponent(Terrain, { definition: meadow });

    const grass = groundEntity.addComponent(TerrainScatter, {
      mesh: grassCard(app, "foliage/grass-cross", 2),
      lodMesh: grassCard(app, "foliage/grass-card", 1),
      lodDistance: 26,
      material: grassMaterial,
      density: 1.4,
      layers: ["grass"],
      slope: { x: 0, y: 24 },
      scale: { x: 0.7, y: 1.5 },
      seed: 3,
      maxInstances: 36_000,
    });

    // A second kind of foliage goes on a **child**: one `TerrainScatter` per entity, and a scatter
    // finds the terrain on itself or on any ancestor.
    const trees = app.world.createEntity("Conifers", { parent: groundEntity }).addComponent(TerrainScatter, {
      mesh: conifer(app, "foliage/conifer", 7),
      lodMesh: conifer(app, "foliage/conifer-far", 4),
      lodDistance: 48,
      material: treeMaterial,
      density: 0.022,
      layers: ["grass"],
      slope: { x: 0, y: 20 },
      scale: { x: 0.75, y: 1.45 },
      seed: 9,
      maxInstances: 900,
    });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.3, far: 600, fov: 55 });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      // Framed on the ground rather than on a fixed height: the field is noise, so the only honest
      // way to stand the camera above the grass is to ask the height field where the grass is.
      target: { x: SHOT.x, y: meadow.value.field.heightAt(SHOT.x, SHOT.z) + SHOT.lift, z: SHOT.z },
      minDistance: 6,
      maxDistance: 180,
      idleDegreesPerSecond: 4,
    });

    /**
     * Writes the wind strength onto both foliage materials.
     *
     * @param value - Metres of lean at the material's reference height.
     */
    function setWind(value: number): void {
      grassMaterial.value.setUniform("windStrength", value);
      treeMaterial.value.setUniform("windStrength", value * 0.7);
    }

    panel({
      title: "Terrain foliage",
      groups: [
        {
          label: "Scatter",
          controls: [
            slider(
              "Grass density",
              { min: 0.1, max: 3, step: 0.1, format: (v): string => `${v.toFixed(1)}/m²` },
              {
                value: grass.density,
                change: (value: number): void => {
                  grass.density = value;
                  grass.regenerate();
                },
              },
            ),
            slider(
              "Tree density",
              { min: 0, max: 0.06, step: 0.002, format: (v): string => `${v.toFixed(3)}/m²` },
              {
                value: trees.density,
                change: (value: number): void => {
                  trees.density = value;
                  trees.regenerate();
                },
              },
            ),
            readout("Grass instances", (): string => thousands(grass.count)),
            readout("Trees", (): string => thousands(trees.count)),
          ],
        },
        {
          label: "Wind and detail",
          controls: [
            slider(
              "Wind",
              { min: 0, max: 0.8, step: 0.02, format: (v): string => `${v.toFixed(2)} m` },
              {
                value: 0.22,
                change: setWind,
              },
            ),
            slider(
              "Grass LOD distance",
              { min: 6, max: 90, step: 2, format: (v): string => `${v.toFixed(0)} m` },
              {
                value: grass.lodDistance,
                change: (value: number): void => {
                  grass.lodDistance = value;
                  // Lite re-applies a pairing's distance live, so this is an ordinary assignment.
                  const lod = grass.entity.getComponent(InstancedMeshRenderer)?.lod ?? null;
                  if (lod !== null) {
                    lod.distance = value;
                  }
                },
              },
            ),
            readout("Chunks drawn", (): string => `${String(ground.visibleChunks)} of ${String(ground.chunkCount)}`),
            readout("Frame draws", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
