// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import {
  Camera2D,
  Camera2DFollow,
  spawnTilemapObjects,
  SPRITE_ANIMATION_ASSET_TYPE,
  SPRITE_ATLAS_ASSET_TYPE,
  SpriteAnimator,
  SpriteRenderer,
  Tilemap,
  TILEMAP_ASSET_TYPE,
  TilemapRenderer,
  twoD,
} from "@ignifx/2d";
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE } from "@ignifx/audio";
import { createApp, isIgnifxError, Vec2 } from "@ignifx/core";
import { INPUT_ACTIONS_ASSET_TYPE, input } from "@ignifx/input";
import { BoxCollider2D, CharacterController2D, physics2d, TilemapCollider2D } from "@ignifx/physics-2d";
// A Vite virtual module the plugin serves; the declaration is in src/vite-env.d.ts.
// eslint-disable-next-line import-x/no-unresolved -- see above.
import { manifest } from "virtual:ignifx/manifest";
import { PlayerController } from "./scripts/player-controller.js";
import { Shrine } from "./scripts/shrine.js";
import { createTouchControls, hasTouch } from "./touch-controls.js";
import type { SpriteAnimationAsset, SpriteAtlasAsset, TileObjectContext, TilemapAsset } from "@ignifx/2d";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";

/**
 * A top-down 2D game: a tilemap with a collision layer, a Y-sorted layer of props and a character,
 * a dead-zoned camera follow, and one trigger zone.
 *
 * The shape of this file is the shape of every ignifx game:
 *
 * 1. `createApp` with the extensions the game uses; `ignifx.config.ts` carries the settings.
 * 2. Load every asset and **await it before `app.start()`**. A load awaited before the loop runs
 *    settles as soon as it finishes; once the loop is running, delivery waits for a `PreUpdate`,
 *    so awaiting after `start()` needs frames to be pumped.
 * 3. Build the world.
 * 4. `app.start()`.
 *
 * `?static=1` stops the clock before the first frame, so the picture is exactly the authored scene
 * and nothing depends on how long a frame took. It is what the visual golden suite in
 * `tests/visual/` opens.
 */

declare global {
  interface Window {
    /** Resolves once the game has presented a settled frame. See the module comment. */
    __ignifxReady: Promise<AppStatus>;
  }
}

/** What `window.__ignifxReady` resolves to. */
type AppStatus = "ready" | "unsupported";

/** How many animation frames the scene is given before the image is called settled. */
const SETTLE_FRAMES = 12;

/** Half the viewport height, in metres: 18 metres of world, which is 288 tile pixels. */
const CAMERA_HALF_HEIGHT = 9;

/** The map is 40 by 24 cells of one metre, and the camera may not leave it. */
const LEVEL_SIZE = { x: 40, y: 24 };

/**
 * The asset type to load each document as.
 *
 * `@ignifx/vite-plugin`'s manifest types a file by its extension, and its table does not yet know
 * the 2D suffixes: a `.atlas.json` arrives typed as plain `"json"`, which would pick the generic
 * JSON loader instead of the sprite-atlas one. Naming the type at the call site is what the
 * `LoadOptions.type` override is for, and it is exact rather than a guess from the file name.
 */
const ATLAS = { type: SPRITE_ATLAS_ASSET_TYPE } as const;
const CLIPS = { type: SPRITE_ANIMATION_ASSET_TYPE } as const;
const MAP = { type: TILEMAP_ASSET_TYPE } as const;
const ACTIONS = { type: INPUT_ACTIONS_ASSET_TYPE } as const;
const CLIP = { type: AUDIO_ASSET_TYPE } as const;
const BUSES = { type: AUDIO_BUSES_ASSET_TYPE } as const;

/** Everything the world is built from. */
interface Assets {
  readonly tiles: AssetHandle<SpriteAtlasAsset>;
  readonly heroAtlas: AssetHandle<SpriteAtlasAsset>;
  readonly heroClips: AssetHandle<SpriteAnimationAsset>;
  readonly level: AssetHandle<TilemapAsset>;
  readonly chime: AssetHandle<AudioClip>;
}

/** The placeholder `announceReady` holds until the promise below hands over its resolver. */
function noop(): void {
  // Nothing to do: the promise executor runs synchronously and replaces this on the next line.
}

let announceReady: (status: AppStatus) => void = noop;
window.__ignifxReady = new Promise<AppStatus>((resolve) => {
  announceReady = resolve;
});

/**
 * Waits for one animation frame.
 *
 * @returns A promise that resolves inside the next frame callback.
 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Waits for several animation frames, so a newly built scene has presented.
 *
 * @param frames - How many frames to wait for.
 * @returns A promise that resolves after the last of them.
 */
function settle(frames: number): Promise<void> {
  let chain = Promise.resolve();
  for (let index = 0; index < frames; index += 1) {
    chain = chain.then(nextFrame);
  }
  return chain;
}

/** Swaps the canvas for the "no WebGPU here" panel in `index.html`. */
function showUnsupported(): void {
  document.body.dataset["webgpu"] = "unavailable";
}

/**
 * Registers the factories the tilemap's objects layer names, so a map edit can add a prop or move
 * the spawn point without touching this file.
 *
 * @param app - The running app.
 * @param assets - The loaded assets the factories draw from.
 * @returns The player entity once the map has been walked; `null` until then.
 */
function registerObjectFactories(app: App, assets: Assets): () => Entity | null {
  let player: Entity | null = null;
  const solid = app.world.layers.requireIndex("Solid");
  const triggerLayer = app.world.layers.requireIndex("Trigger");
  const atlas = assets.tiles.value;

  app.twoD.registerTileObjectFactory("spawn", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = app.world.layers.requireIndex("Player");
    entity.transform.position2D = new Vec2(context.position.x, context.position.y);

    entity.addComponent(SpriteRenderer, {
      sprite: assets.heroAtlas.retain(),
      sortingLayer: "Default",
      pickable: true,
    });
    entity.addComponent(SpriteAnimator, {
      animations: assets.heroClips.retain(),
      defaultClip: "idle_down",
      playOnAwake: true,
    });
    // A box, not the default capsule: a top-down character slides along walls more predictably
    // with square corners, and the shape is what `stepOffset` would need anyway. The offset lifts
    // the box off the entity's origin, which sits at the sprite's feet.
    entity.addComponent(CharacterController2D, {
      shape: "box",
      radius: 0.3,
      height: 0.6,
      offset: { x: 0, y: 0.3 },
      slopeLimit: 90,
      snapToGround: 0,
    });
    entity.addComponent(PlayerController, { speed: 4.5 });
    player = entity;
    return entity;
  });

  app.twoD.registerTileObjectFactory("prop", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = solid;
    entity.transform.position2D = new Vec2(context.position.x, context.position.y);
    const frame = String(context.properties["frame"] ?? "crate");
    entity.addComponent(SpriteRenderer, {
      sprite: assets.tiles.retain(),
      sortingLayer: "Default",
      pickable: true,
      // `frame` is a runtime property rather than a schema field, so it is assigned after the
      // component exists; passing it to `addComponent` is `IGX-0607`.
    }).frame = atlas.requireFrame(frame);
    // The collider is shorter than the sprite: only the base of a prop blocks a character, which
    // is what makes a Y-sorted scene feel like it has depth rather than like a wall of boxes.
    entity.addComponent(BoxCollider2D, { size: { x: 0.9, y: 0.5 }, offset: { x: 0, y: 0.25 } });
    return entity;
  });

  app.twoD.registerTileObjectFactory("shrine", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = triggerLayer;
    entity.transform.position2D = new Vec2(context.position.x, context.position.y);
    entity.addComponent(SpriteRenderer, {
      sprite: assets.tiles.retain(),
      sortingLayer: "Decal",
    }).frame = atlas.requireFrame(String(context.properties["frame"] ?? "pad"));
    entity.addComponent(BoxCollider2D, {
      size: { x: context.size.x, y: context.size.y },
      offset: { x: 0, y: context.size.y / 2 },
      isTrigger: true,
    });
    entity.addComponent(Shrine).clip = assets.chime;
    return entity;
  });

  return () => player;
}

/**
 * Builds the world: the tilemap and its collider, everything the objects layer spawns, and the
 * camera that follows whatever the `spawn` object produced.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @returns The player entity.
 */
function buildWorld(app: App, assets: Assets): Entity {
  const takePlayer = registerObjectFactories(app, assets);

  const level = app.world.createEntity("Level");
  level.layer = app.world.layers.requireIndex("Solid");
  const map = level.addComponent(Tilemap, { map: assets.level.retain(), chunkSize: 16 });
  level.addComponent(TilemapRenderer, { atlas: assets.tiles.retain(), cullChunks: true });
  // The merged outlines of every solid tile, as one static compound body. `TilemapCollider2D`
  // watches the data's `version` each fixed step, so editing a tile at runtime reaches physics
  // with no subscription of our own.
  level.addComponent(TilemapCollider2D).collisionData = map.collisionData;

  // Objects are normally spawned by the extension when a *scene file* finishes loading. This
  // template builds its world in code, so it walks the objects layer itself.
  spawnTilemapObjects(app, app.twoD, map);
  const player = takePlayer();
  if (player === null) {
    throw new Error('level.tilemap.json has no object of type "spawn".');
  }

  const eye = app.world.createEntity("Main Camera");
  eye.transform.position2D = new Vec2(player.transform.position2D.x, player.transform.position2D.y);
  eye.addComponent(Camera2D, {
    orthographicSize: CAMERA_HALF_HEIGHT,
    follow: player,
    followDamping: 0.12,
    // The target rides the edge of this rectangle instead of being pinned to the middle of the
    // screen, so small steps do not drag the whole world around.
    deadZone: { x: 1.5, y: 1 },
    boundsMin: { x: 0, y: 0 },
    boundsMax: LEVEL_SIZE,
  });
  eye.addComponent(Camera2DFollow);
  return player;
}

/**
 * Builds and runs the game.
 *
 * @returns The status `window.__ignifxReady` resolves to.
 */
async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('2d-topdown needs a <canvas id="game"> element on the page.');
  }

  const flags = new URLSearchParams(window.location.search);
  const isStatic = flags.get("static") === "1";

  let app: App;
  try {
    app = await createApp({
      canvas,
      settings: import.meta.env.IGNIFX_CONFIG,
      // The address-to-URL table `@ignifx/vite-plugin` built from `assets/`. Importing the virtual
      // module rather than fetching `assets.manifest.json` means the table is in the bundle, so
      // the first asset request needs no round trip.
      assets: { manifest },
      extensions: [twoD(), physics2d(), input(), audio()],
    });
  } catch (error) {
    // IGX-0701 is the one failure a shipped game must handle itself: the browser has no WebGPU and
    // ignifx has no fallback renderer by decision (ADR-0001).
    if (isIgnifxError(error) && error.code === "IGX-0701") {
      showUnsupported();
      return "unsupported";
    }
    throw error;
  }

  app.registerComponents([PlayerController, Shrine]);

  const assets: Assets = {
    tiles: app.assets.load<SpriteAtlasAsset>("tiles.atlas.json", ATLAS),
    heroAtlas: app.assets.load<SpriteAtlasAsset>("hero.atlas.json", ATLAS),
    heroClips: app.assets.load<SpriteAnimationAsset>("hero.spriteanim.json", CLIPS),
    level: app.assets.load<TilemapAsset>("level.tilemap.json", MAP),
    chime: app.assets.load<AudioClip>("chime.wav", CLIP),
  };
  const actions = app.assets.load<InputActionsAsset>("game.input.json", ACTIONS);
  const buses = app.assets.load<AudioBusesAsset>("game.audio.json", BUSES);

  await Promise.all([
    assets.tiles.promise,
    assets.heroAtlas.promise,
    assets.heroClips.promise,
    assets.level.promise,
    actions.promise,
    buses.promise,
  ]);
  // The clip is awaited separately: a browser that refuses to decode the file should cost the game
  // its chime, not its first frame.
  await assets.chime.promise.catch((error: unknown) => {
    app.log.warn("the chime could not be decoded: {error}", String(error));
  });

  // Installed here rather than through `input.actions` in `ignifx.config.ts`, so that the maps
  // exist before the first `update` runs. See the comment in that file.
  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  buildWorld(app, assets);

  if (isStatic) {
    // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
    // nothing animates and the camera never chases: the frame is exactly what was authored.
    app.time.timeScale = 0;
  } else if (hasTouch()) {
    createTouchControls(app, [{ control: "interact", label: "E" }], document.body);
  }

  await app.start();
  await settle(SETTLE_FRAMES);
  app.log.info("2d-topdown running: {sprites} sprites", app.twoD.spriteCount);
  return "ready";
}

void main().then(announceReady, (error: unknown) => {
  showUnsupported();
  announceReady("unsupported");
  // Rethrown out of the promise chain so it reaches `window.onerror` as an uncaught error rather
  // than a swallowed rejection. Templates never log through `console` (coding standards §6).
  setTimeout(() => {
    throw error;
  }, 0);
});
