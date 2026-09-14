import {
  Camera,
  createFoliageMaterial,
  createMaterialAsset,
  Environment,
  HeightfieldCollider,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  physics,
  Rigidbody,
  SphereCollider,
  Terrain,
  terrain,
  terrainAssetFromDefinition,
  TerrainScatter,
  TEXTURE_ASSET_TYPE,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, select, slider } from "../_kit/panel.ts";
import { grassTuft } from "./card.ts";
import { SCULPT_ACTIONS, SCULPT_MODES, Sculptor } from "./sculptor.ts";
import type { SculptMode } from "./sculptor.ts";
import type { TextureAsset } from "ignifx";

/**
 * Reshape the ground with the pointer, and watch everything standing on it follow.
 *
 * `setHeights(x, z, width, depth, heights)` is the whole editing API. It rewrites the positions and
 * normals of every chunk the rectangle touches — one sample wider on each side, because a normal
 * reads its neighbours — and then raises `onHeightsChanged`. Two things listen: the
 * `HeightfieldCollider`, which re-reads `colliderInit()` so the balls roll on the new shape, and
 * the `TerrainScatter`, which re-places its grass by itself.
 *
 * The brush is applied twelve times a second rather than every frame, because that rebuild is real
 * work and a 240 Hz browser should not do four times as much of it as a 60 Hz one.
 */

/** The grass card's alpha-tested albedo, written by `_tools/make-terrain-assets.ts`. */
const GRASS_CARD = "terrain/grass_card.png";

/** The sky the field stands against. */
const SKY = { r: 0.6, g: 0.72, b: 0.85, a: 1 } as const;

/** Samples per side of the field. Small, because every stroke rebuilds a collider from it. */
const RESOLUTION = 129;

/** The field's edge length in metres. */
const EXTENT = 96;

bootExample({
  title: "Sculpt terrain",
  extensions: [physics(), terrain()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
    physics: { havokWasm: `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm` },
  },

  async setup({ app, panel, random }) {
    app.registerComponents([Sculptor]);
    app.input.loadActions(SCULPT_ACTIONS);

    const field = await terrainAssetFromDefinition(app, {
      name: "sandbox",
      size: { width: EXTENT, depth: EXTENT, height: 16 },
      resolution: RESOLUTION,
      chunks: { size: 32, lodLevels: 2, lodDistance: 70, skirtDepth: 1 },
      noise: { seed: 4, octaves: 4, frequency: 0.022, persistence: 0.45 },
      layers: [
        { name: "grass", color: [0.32, 0.45, 0.22] },
        { name: "rock", color: [0.46, 0.44, 0.41] },
      ],
      splatRules: [
        { layer: "grass", slope: [0, 34] },
        { layer: "rock", slope: [30, 90] },
      ],
      material: { roughness: 0.95, metallic: 0 },
    });
    // The shape the Reset button puts back. `Terrain.heights` is a live view, so this is a copy.
    const pristine = Float32Array.from(field.value.field.heights);

    const blades = await app.assets.loadAsync<TextureAsset>(GRASS_CARD, { type: TEXTURE_ASSET_TYPE });
    const grassMaterial = await createFoliageMaterial(app, {
      albedo: blades,
      wind: { strength: 0.18, frequency: 1.3, height: 1 },
      alphaCutoff: 0.45,
    });

    const sun = app.world.createEntity("Sun", { position: { x: -30, y: 44, z: -26 } });
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    const key = sun.addComponent(Light, { type: "directional", intensity: 3, color: { r: 1, g: 0.97, b: 0.91, a: 1 } });
    key.shadows.enabled = true;
    key.shadows.mapSize = 2048;
    key.shadows.maxDistance = 90;
    key.shadows.darkness = 0.3;
    key.shadows.normalBias = 0.02;
    app.world.createEntity("Sky light").addComponent(Light, {
      type: "hemispheric",
      intensity: 0.9,
      color: SKY,
      groundColor: { r: 0.28, g: 0.3, b: 0.22, a: 1 },
    });
    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: SKY });
    sky.imageProcessing.toneMapping = "aces";

    const groundEntity = app.world.createEntity("Sandbox");
    const ground = groundEntity.addComponent(Terrain, { definition: field });
    const collider = groundEntity.addComponent(HeightfieldCollider, ground.colliderInit());
    const grass = groundEntity.addComponent(TerrainScatter, {
      mesh: grassTuft(app),
      material: grassMaterial,
      density: 0.9,
      layers: ["grass"],
      slope: { x: 0, y: 30 },
      scale: { x: 0.8, y: 1.4 },
      seed: 6,
      maxInstances: 9000,
    });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.3, far: 500, fov: 50 });
    const camera = eye.requireComponent(Camera);
    attachOrbit(app, eye, {
      yaw: 24,
      pitch: 34,
      distance: 96,
      target: { x: 0, y: 6, z: 0 },
      minDistance: 25,
      maxDistance: 220,
    });

    const brush = app.world.createEntity("Brush").addComponent(Sculptor);
    brush.ground = ground;
    brush.camera = camera;

    // The two followers. `setHeights` raises this once per stroke, and neither listener knows about
    // the other: a collider re-reads the terrain's own init, and a scatter re-places itself.
    ground.onHeightsChanged.connect(
      (): void => {
        Object.assign(collider, ground.colliderInit());
        collider.rebuild();
      },
      { owner: brush },
    );

    const ballMesh = MeshAsset.sphere(app, { diameter: 1.6, segments: 16 });
    const ballMaterial = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: "sculpt/ball",
        baseColor: { r: 0.87, g: 0.4, b: 0.19, a: 1 },
        roughness: 0.4,
        metallic: 0,
      }),
      [],
    );
    let balls = 0;

    /** Drops one ball over the middle of the field, so the new shape can be felt as well as seen. */
    function dropBall(): void {
      const x = (random() - 0.5) * 24;
      const z = (random() - 0.5) * 24;
      const ball = app.world.createEntity(`Ball ${String(balls)}`, {
        position: { x, y: ground.heightAt(x, z) + 22, z },
      });
      ball.addComponent(MeshRenderer, {
        mesh: ballMesh.retain(),
        materials: [ballMaterial.retain()],
        castShadows: true,
      });
      ball.addComponent(SphereCollider, { radius: 0.8 });
      ball.addComponent(Rigidbody, { mass: 4 });
      balls += 1;
    }

    panel({
      title: "Sculpt terrain",
      groups: [
        {
          label: "Brush",
          controls: [
            select("Mode", [...SCULPT_MODES], {
              value: brush.mode,
              change: (value: string): void => {
                // The select hands back one of the strings it was given, so the narrowing is the
                // list itself rather than an assertion.
                brush.mode = SCULPT_MODES.find((mode: SculptMode): boolean => mode === value) ?? "Raise";
              },
            }),
            slider(
              "Radius",
              { min: 2, max: 18, step: 0.5, format: (v): string => `${v.toFixed(1)} m` },
              bind(brush, "radius"),
            ),
            slider(
              "Strength",
              { min: 1, max: 20, step: 0.5, format: (v): string => `${v.toFixed(1)} m/s` },
              bind(brush, "strength"),
            ),
            button("Reset the ground", (): void => {
              ground.setHeights(0, 0, ground.resolution, ground.resolution, pristine);
            }),
          ],
        },
        {
          label: "What follows",
          controls: [
            button("Drop a ball", dropBall),
            readout("Strokes", (): string => String(brush.strokes)),
            readout("Grass instances", (): string => grass.count.toLocaleString("en-GB")),
            readout("Collider samples", (): string => `${String(collider.samplesX)} x ${String(collider.samplesZ)}`),
            readout("Frame draws", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
