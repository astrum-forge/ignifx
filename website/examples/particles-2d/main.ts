import {
  Camera2D,
  Camera2DFollow,
  ParticleSystem2D,
  particleAssetFromDefinition,
  particles,
  particles2D,
  physics2d,
  SpriteRenderer,
  Tilemap,
  TilemapCollider2D,
  TilemapRenderer,
  twoD,
  Vec2,
  VirtualJoystick,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, readout, slider } from "../_kit/panel.ts";
import {
  COIN,
  footstepDefinition,
  LEVEL_SIZE,
  loadLevel,
  REFERENCE_RESOLUTION,
  SORTING_LAYERS,
  sparkleDefinition,
  spritesDrawn,
  TORCHES,
  torchDefinition,
  VILLAGER_START,
} from "./village-fx.ts";
import { createVillager, WALK_ACTIONS, Walker } from "./walker.ts";
import type { AssetHandle, ParticleAsset } from "ignifx";

/**
 * The tilemap example's village with three particle effects on it: two braziers, dust under the
 * villager's feet, and a sparkle over a pickup.
 *
 * ## The same documents, drawn as sprites
 *
 * `ParticleSystem2D` reads the `.particles.json` the 3D `ParticleSystem` reads — the same presets,
 * the same modules, the same emitter and the same evaluator. What changes is the draw: instead of
 * uploading spawn records for the GPU to evaluate, it writes every live particle into a
 * **`SpriteBatch`**, a block of entity-less sprite slots in one sorting layer. So a particle blends,
 * sorts and pans exactly like the tiles around it, and a torch behind a roof is behind the roof.
 *
 * ## Sorting layers are the depth
 *
 * There is no Z here (`docs/architecture/11-2d-toolkit.md` §3), so where an effect draws is which
 * layer it is on: `Dust` sits under `Default` and `Sparks` above it, under `Canopy`. A large moving
 * effect belongs on a layer that does not Y-sort, which is why neither of those two does.
 *
 * `village-fx.ts` holds the three documents and where they stand; `walker.ts` is the villager.
 */

/** How many particles all three effects together may hold. */
const BUDGET = 4000;

bootExample({
  title: "2D particles",
  extensions: [
    // One world metre is one 16-pixel tile. `particles` owns the budget and the quality scale for
    // both dimensions; `particles2D` is the renderer that draws into sprite layers.
    twoD({ pixelsPerUnit: 16, ySort: { Default: true } }),
    physics2d(),
    particles({ maxParticles: BUDGET }),
    particles2D(),
  ],
  settings: {
    // Multisampling is off because it would soften exactly the edges pixel art exists to keep sharp.
    rendering: { msaaSamples: 1 },
    time: { fixedDeltaTime: 1 / 60 },
    sortingLayers: { sortingLayers: SORTING_LAYERS },
    layers: { layers: ["Default", "Player", "Terrain"] },
    // A top-down world has no gravity: the controller goes exactly where `move` says, and a
    // document that asks for the world's gravity gets none either.
    physics2d: { gravity: { x: 0, y: 0 }, defaultMaterial: { friction: 0, restitution: 0 } },
    particles: { gravity: { x: 0, y: 0, z: 0 } },
  },

  async setup({ app, panel, flags }) {
    app.registerComponents([Walker]);
    app.input.loadActions(WALK_ACTIONS);

    const assets = await loadLevel(app);
    const seed = Math.max(1, Math.trunc(flags.seed));

    const level = app.world.createEntity("Level");
    level.layer = app.world.layers.requireIndex("Terrain");
    const map = level.addComponent(Tilemap, { map: assets.map, chunkSize: 8 });
    level.addComponent(TilemapRenderer, { atlas: assets.tiles, cullChunks: true });
    // Adjacent solid cells are merged into as few polygons as the tiles allow, so the villager
    // walks the streets rather than through the fences.
    level.addComponent(TilemapCollider2D).collisionData = map.collisionData;

    const villager = createVillager(app, assets);
    const walker = villager.requireComponent(Walker);
    const footsteps = villager.addComponent(ParticleSystem2D, {
      definition: particleAssetFromDefinition(app, footstepDefinition(), "fx/footsteps"),
      atlas: assets.dust,
      sortingLayer: "Dust",
      seed,
    });

    const torchDocument: AssetHandle<ParticleAsset> = particleAssetFromDefinition(app, torchDefinition(), "fx/torch");
    for (let index = 0; index < TORCHES.length; index += 1) {
      const at = TORCHES[index];
      if (at === undefined) {
        continue;
      }
      const brazier = app.world.createEntity(`Brazier ${String(index)}`);
      brazier.transform.position2D = new Vec2(at.x, at.y);
      // Two systems, one document: the second brazier shares the first's atlas and its document,
      // and its own seed is what keeps the two flames from flickering in step.
      brazier.addComponent(ParticleSystem2D, {
        definition: torchDocument,
        atlas: assets.flame,
        sortingLayer: "Sparks",
        seed: seed + index + 1,
      });
    }

    const pickup = app.world.createEntity("Pickup");
    pickup.transform.position2D = new Vec2(COIN.x, COIN.y);
    pickup.addComponent(SpriteRenderer, {
      sprite: assets.dust,
      sortingLayer: "Default",
      color: { r: 1, g: 0.78, b: 0.25, a: 1 },
    });
    const sparkle = pickup.addComponent(ParticleSystem2D, {
      definition: particleAssetFromDefinition(app, sparkleDefinition(), "fx/sparkle"),
      atlas: assets.spark,
      sortingLayer: "Sparks",
      seed: seed + 9,
    });

    const eye = app.world.createEntity("Main Camera");
    eye.transform.position2D = new Vec2(VILLAGER_START.x, VILLAGER_START.y);
    eye.addComponent(Camera2D, {
      pixelPerfect: true,
      referenceResolution: REFERENCE_RESOLUTION,
      follow: villager,
      followDamping: 0.12,
      followOffset: { x: 0, y: 0.5 },
      deadZone: { x: 1.5, y: 1 },
      boundsMin: { x: 0, y: 0 },
      boundsMax: LEVEL_SIZE,
    });
    eye.addComponent(Camera2DFollow);

    // On-screen controls only where there is a touch screen: on a desktop they would cover the map.
    if (navigator.maxTouchPoints > 0) {
      const joystick = new VirtualJoystick(app, {
        control: "joystick",
        ariaLabel: "Walk",
        style: { left: "1.5rem", bottom: "calc(1.5rem + var(--ignifx-safe-bottom, 0px))" },
      });
      window.addEventListener("pagehide", (): void => {
        joystick.dispose();
      });
    }

    panel({
      title: "2D particles",
      groups: [
        {
          label: "Village",
          controls: [
            slider(
              "Walk speed",
              { min: 1, max: 8, step: 0.5, format: (value: number): string => `${value.toFixed(1)} m/s` },
              bind(walker, "speed"),
            ),
            slider(
              "Effects quality",
              { min: 0, max: 1, step: 0.05, format: (value: number): string => `${(value * 100).toFixed(0)} %` },
              {
                value: app.particles.qualityScale,
                change: (value: number): void => {
                  // The one knob a settings screen turns: every rate and burst in the app, 2D and
                  // 3D alike, read fresh each frame.
                  app.particles.qualityScale = value;
                },
              },
            ),
          ],
        },
        {
          label: "Particles",
          controls: [
            readout("Footstep dust", (): string => String(footsteps.aliveCount)),
            readout("Sparkle", (): string => `${String(sparkle.aliveCount)} of ${String(sparkle.capacity)}`),
            readout("Sprites in layers", (): string => String(spritesDrawn(app))),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
