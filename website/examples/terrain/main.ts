import {
  Camera,
  Environment,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  createMaterialAsset,
  Terrain,
  terrain,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { readout, slider, toggle } from "../_kit/panel.ts";
import { attachFly } from "./fly.ts";
import { createLodOverlay } from "./lod-overlay.ts";
import type { AssetHandle, TerrainAsset } from "ignifx";

/**
 * A 512-metre island from a 16-bit heightmap, four blended ground layers, and the level-of-detail
 * machinery that makes it affordable.
 *
 * ## What the document carries
 *
 * `island.terrain.json` names one `.r16` file — raw little-endian `uint16`, no header — and four
 * layers, and `island_splat.png` says which layer wins where: one RGBA image whose red, green,
 * blue and alpha channels are the weights of sand, grass, rock and snow. Sixteen bits is not a
 * detail: eight would put a 31 cm stair on every slope of an 80 m range, which no lighting hides.
 *
 * ## What the engine does with it
 *
 * The ground is `chunksPerSide²` chunks, each built at four levels of detail with a downward skirt
 * on every edge, and exactly one level of each is visible. `TerrainLodSystem` runs once in
 * `PreRender`: it picks each chunk's level from the camera's distance to the chunk's world box —
 * with a ten per cent hysteresis band, so a camera parked on a threshold does not flip every frame
 * — and then tests that box against the camera's six frustum planes, because Babylon Lite does not
 * cull plain meshes and a terrain would otherwise draw the half behind you.
 *
 * All four layers are blended by **one** PBR material carrying the generated `terrainSplat` surface
 * shader, so the ground keeps the engine's own lighting, fog and tone mapping. That is also why
 * there is no wireframe switch here: every chunk shares that one material. `lodOf(chunkX, chunkZ)`
 * is the public answer, and `lod-overlay.ts` draws it as a marker over each chunk.
 */

/** The address of the island document; every file it needs is named relative to it. */
const ISLAND_ADDRESS = "terrain/island.terrain.json";

/** The sky the island stands against. */
const SKY = { r: 0.55, g: 0.68, b: 0.82, a: 1 } as const;

/** The fog colour: brighter than {@link SKY}, because fog is composited before tone mapping. */
const HAZE = { r: 0.6, g: 0.72, b: 0.86, a: 1 } as const;

/** Where the camera opens, in metres: south-west of the island, above the water. */
const SHOT = { x: -170, y: 66, z: -212, yaw: 39, pitch: -13 } as const;

/** Where the water plane sits, in metres. The document's heights run from `0` to `80`. */
const SEA_LEVEL = 3;

/**
 * Writes a metre count.
 *
 * @param value - The value, in metres.
 * @returns The text for the value cell.
 */
function metres(value: number): string {
  return `${value.toFixed(0)} m`;
}

bootExample({
  title: "Terrain",
  // `terrain()` declares the `materialPlugins` rendering feature the splat surface shader needs.
  extensions: [terrain()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: false } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    // Awaited before `app.start()`: the document, the `.r16`, the four layer images and the control
    // map all arrive together, and a load finished before the loop runs settles at once.
    const island: AssetHandle<TerrainAsset> = await app.assets.loadAsync<TerrainAsset>(ISLAND_ADDRESS);

    const sun = app.world.createEntity("Sun");
    sun.transform.lookAt({ x: 0.55, y: -0.72, z: 0.42 });
    sun.addComponent(Light, { type: "directional", intensity: 3.4, color: { r: 1, g: 0.97, b: 0.9, a: 1 } });
    app.world.createEntity("Sky light").addComponent(Light, {
      type: "hemispheric",
      intensity: 0.85,
      color: SKY,
      groundColor: { r: 0.3, g: 0.29, b: 0.25, a: 1 },
    });

    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: SKY });
    sky.imageProcessing.toneMapping = "aces";
    // Linear fog over the last third of the view, which is what hides a chunk changing level far
    // away and what stops the island ending at a hard edge against the sky.
    sky.fog.mode = "linear";
    // Brighter than the clear colour: the fog colour is composited before tone mapping, so a haze
    // that matches the sky on paper reads darker than it on screen.
    sky.fog.color = HAZE;
    sky.fog.start = 450;
    sky.fog.end = 1700;

    const ground = app.world.createEntity("Island").addComponent(Terrain, { definition: island });

    const water = app.world.createEntity("Sea", { position: { x: 0, y: SEA_LEVEL, z: 0 } });
    water.addComponent(MeshRenderer, {
      mesh: MeshAsset.ground(app, { width: 1600, height: 1600 }),
      materials: [
        createMaterialAsset(
          app,
          pbrMaterialDefinition({
            name: "terrain/sea",
            baseColor: { r: 0.09, g: 0.2, b: 0.3, a: 1 },
            roughness: 0.22,
            metallic: 0,
          }),
          [],
        ),
      ],
      castShadows: false,
    });

    const eye = app.world.createEntity("Main Camera", { position: { x: SHOT.x, y: SHOT.y, z: SHOT.z } });
    eye.addComponent(Camera, { near: 1, far: 1600, fov: 58 });
    const fly = attachFly(app, eye, { yaw: SHOT.yaw, pitch: SHOT.pitch });
    fly.ground = ground;

    const middleChunk = Math.floor(island.value.definition.chunksPerSide / 2);

    // Built before `app.start()`: an `InstancedMeshRenderer`'s capacity sizes a buffer Babylon Lite
    // fixes when the scene is registered.
    const overlay = createLodOverlay(app, ground, island.value);

    panel({
      title: "Terrain",
      groups: [
        {
          label: "Level of detail",
          controls: [
            toggle("LOD markers", {
              value: false,
              change: (on: boolean): void => {
                overlay.setVisible(on);
              },
            }),
            slider(
              "LOD bias",
              { min: 0.25, max: 4, step: 0.05, format: (value): string => `${value.toFixed(2)}x` },
              {
                value: ground.lodBias,
                change: (value: number): void => {
                  ground.lodBias = value;
                },
              },
            ),
            toggle("Frustum culling", {
              value: ground.frustumCulling,
              change: (on: boolean): void => {
                ground.frustumCulling = on;
              },
            }),
          ],
        },
        {
          label: "What it costs",
          controls: [
            readout("Chunks drawn", (): string => `${String(ground.visibleChunks)} of ${String(ground.chunkCount)}`),
            // `Terrain.drawCalls` and not `app.renderer.drawCalls`: a chunk is a renderable and not
            // a component, and Lite's own counter includes bindings the terrain never issued.
            readout("Terrain draws", (): string => String(ground.drawCalls)),
            readout("Middle chunk LOD", (): string => String(ground.lodOf(middleChunk, middleChunk))),
          ],
        },
        {
          label: "Camera",
          collapsed: true,
          controls: [
            slider(
              "Speed",
              { min: 6, max: 140, step: 2, format: (value): string => `${value.toFixed(0)} m/s` },
              {
                value: fly.speed,
                change: (value: number): void => {
                  fly.speed = value;
                },
              },
            ),
            readout("Altitude", (): string => metres(eye.transform.position.y)),
            readout("Ground below", (): string =>
              metres(ground.heightAt(eye.transform.position.x, eye.transform.position.z)),
            ),
          ],
        },
      ],
    });
  },
});
