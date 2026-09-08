import {
  Camera2D,
  Camera2DFollow,
  CharacterController2D,
  physics2d,
  spawnTilemapObjects,
  SpriteAnimator,
  SpriteRenderer,
  Tilemap,
  TilemapCollider2D,
  TilemapRenderer,
  twoD,
  Vec2,
  VirtualJoystick,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, readout, slider, toggle } from "../_kit/panel.ts";
import { Villager, WALK_ACTIONS } from "./villager.ts";
import type {
  App,
  AssetHandle,
  Entity,
  MutableVec2,
  SpriteAnimationAsset,
  SpriteAtlasAsset,
  TileObjectContext,
  TilemapAsset,
} from "ignifx";

/**
 * A hand-drawn Tiled map with three tile layers, chunk culling, and a villager who walks it with
 * the camera following.
 *
 * Three components share the work. `Tilemap` owns the document — the grid, the tilesets and the
 * per-tile colliders; `TilemapRenderer` draws it from one atlas, a chunk at a time, dropping the
 * chunks the camera cannot see; `TilemapCollider2D` turns the map's merged outlines into one static
 * Rapier body. `village.tmj.json` beside this file is the Tiled export the map came from, and
 * `tools/build-2d-assets.ts` is what ran it through `importTiledMap` at build time.
 *
 * The three layers are the lesson worth watching. `Ground` is grass and stone; `Solid` is the
 * fences, the walls and the tree roots, and it is the only layer with collision; `Canopy` is the
 * roofs and the crowns, and it draws in a sorting layer **above** the villager — which is why
 * walking into a house or under a tree hides her.
 */

/** The map is forty by twenty cells of one metre, and the camera may not leave it. */
const LEVEL_SIZE = { x: 40, y: 20 } as const;

/** The design resolution the pixel-perfect camera fits a whole-number zoom to. */
const REFERENCE_RESOLUTION = { x: 320, y: 180 } as const;

/**
 * How many cells wide a chunk is.
 *
 * @remarks
 * Eight rather than the default thirty-two, because a 40x20 map is barely one chunk at the default
 * and the point here is to watch the sprite count fall when a chunk leaves the frame.
 */
const CHUNK_SIZE = 8;

/** Scratch for the panel's cell readout, so reading it four times a second allocates nothing. */
const cellScratch: MutableVec2 = new Vec2();

/**
 * How many sprites the sprite layers are holding, tiles included.
 *
 * @param app - The running app.
 * @returns The total.
 */
function tilesDrawn(app: App): number {
  let total = 0;
  for (const layer of app.twoD.layers) {
    total += layer.count;
  }
  return total;
}

/**
 * Loads the four documents the level is built from.
 *
 * @remarks
 * Awaited before `app.start()`, where a completed load settles at once; started after it, a load is
 * delivered in a later frame's `PreUpdate` and the first frames would draw an empty map.
 *
 * @param app - The app being set up.
 * @returns The map, the tile atlas, and the villager's atlas and clips.
 */
async function loadLevel(app: App): Promise<{
  readonly map: AssetHandle<TilemapAsset>;
  readonly tiles: AssetHandle<SpriteAtlasAsset>;
  readonly atlas: AssetHandle<SpriteAtlasAsset>;
  readonly clips: AssetHandle<SpriteAnimationAsset>;
}> {
  const [map, tiles, atlas, clips] = await Promise.all([
    app.assets.loadAsync<TilemapAsset>("2d/village.tilemap.json"),
    app.assets.loadAsync<SpriteAtlasAsset>("2d/tiny-town.atlas.json"),
    app.assets.loadAsync<SpriteAtlasAsset>("2d/villager.atlas.json"),
    app.assets.loadAsync<SpriteAnimationAsset>("2d/villager.spriteanim.json"),
  ]);
  return { map, tiles, atlas, clips };
}

bootExample({
  title: "Tilemap",
  extensions: [
    // One world metre is one 16-pixel tile. The default is 100, which would draw every sprite here
    // at a sixth of its intended size.
    twoD({ pixelsPerUnit: 16, ySort: { Default: true } }),
    physics2d(),
  ],
  settings: {
    rendering: {
      // `twoD` in `"sprite"` mode clears the frame to black itself and does not read
      // `rendering.clearColor` (`packages/2d/src/extension.ts`), so the sky here is the renderer's,
      // not a setting. Multisampling is off because it would soften exactly the edges pixel art
      // exists to keep sharp.
      msaaSamples: 1,
    },
    time: { fixedDeltaTime: 1 / 60 },
    // Back to front. `Canopy` is above `Default`, which is what puts a roof in front of a villager.
    sortingLayers: { sortingLayers: ["Ground", "Terrain", "Default", "Canopy"] },
    layers: { layers: ["Default", "Player", "Terrain"] },
    // A top-down world has no gravity: the controller goes exactly where `move` says.
    physics2d: { gravity: { x: 0, y: 0 }, defaultMaterial: { friction: 0, restitution: 0 } },
  },

  async setup({ app, panel }) {
    app.registerComponents([Villager]);
    app.input.loadActions(WALK_ACTIONS);

    const assets = await loadLevel(app);

    // The map's objects layer is a list of intentions — "someone starts here" — and only the game
    // knows what each one becomes. Registered before the map is walked, or nothing spawns.
    app.twoD.registerTileObjectFactory("spawn", (context: TileObjectContext): Entity => {
      const entity = app.world.createEntity(context.name);
      entity.layer = app.world.layers.requireIndex("Player");
      // The object is a one-metre cell and its position is the cell's bottom-left corner; the
      // sheet's frames pivot at `[0.5, 1]`, so the entity's origin is under her feet.
      entity.transform.position2D = new Vec2(context.position.x + context.size.x / 2, context.position.y);
      entity.addComponent(SpriteRenderer, { sprite: assets.atlas, sortingLayer: "Default" });
      entity.addComponent(SpriteAnimator, {
        animations: assets.clips,
        defaultClip: "idle_down",
        playOnAwake: true,
      });
      // A box, not the default capsule: a top-down character slides along a wall more predictably
      // with square corners. The offset lifts the box off the origin, which is at her feet.
      entity.addComponent(CharacterController2D, {
        shape: "box",
        radius: 0.3,
        height: 0.5,
        offset: { x: 0, y: 0.25 },
        slopeLimit: 90,
        snapToGround: 0,
      });
      entity.addComponent(Villager);
      return entity;
    });

    const level = app.world.createEntity("Level");
    level.layer = app.world.layers.requireIndex("Terrain");
    const map = level.addComponent(Tilemap, { map: assets.map, chunkSize: CHUNK_SIZE });
    const renderer = level.addComponent(TilemapRenderer, { atlas: assets.tiles, cullChunks: true });
    // Adjacent solid cells are merged into as few polygons as the tiles allow, so the fence around
    // the paddock is one shape rather than one per cell.
    level.addComponent(TilemapCollider2D).collisionData = map.collisionData;

    // The call answers with what it created, in document order, which is how the camera finds its
    // subject without the factory having to publish it.
    const villager = spawnTilemapObjects(app, app.twoD, map)[0];
    if (villager === undefined) {
      throw new Error('village.tilemap.json has no object of type "spawn".');
    }

    const eye = app.world.createEntity("Main Camera");
    eye.transform.position2D = new Vec2(villager.transform.position2D.x, villager.transform.position2D.y);
    eye.addComponent(Camera2D, {
      // `orthographicSize` is ignored while `pixelPerfect` is on: the zoom is
      // `viewportHeight / referenceResolution.y`, snapped to a whole number, so one texel always
      // covers an exact square of screen pixels.
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
      title: "Tilemap",
      groups: [
        {
          label: "Map",
          controls: [
            toggle("Cull chunks", bind(renderer, "cullChunks")),
            // Every tile the renderer has materialised, summed over the sprite layers. Turn the
            // toggle off and it climbs to the whole map; turn it on and it falls back to the
            // chunks the camera can see. `app.twoD.spriteCount` is the other figure and counts
            // only `SpriteRenderer` components — one, here, the villager.
            readout("Tiles drawn", (): string => String(tilesDrawn(app))),
            readout("Chunk size", (): string => `${String(map.chunkSize)} cells`),
          ],
        },
        {
          label: "Villager",
          controls: [
            slider(
              "Speed",
              { min: 1, max: 9, step: 0.5, format: (value: number): string => `${value.toFixed(1)} m/s` },
              bind(villager.requireComponent(Villager), "speed"),
            ),
            readout("Cell", (): string => {
              const cell = map.worldToCell(villager.transform.position2D, cellScratch);
              return `${String(cell.x)}, ${String(cell.y)}`;
            }),
          ],
        },
      ],
    });
  },
});
