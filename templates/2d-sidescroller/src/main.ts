// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import {
  Camera2D,
  Camera2DFollow,
  ParallaxLayer,
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
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener, AudioSource } from "@ignifx/audio";
import { createApp, isIgnifxError, Vec2 } from "@ignifx/core";
import { electron } from "@ignifx/electron";
import { INPUT_ACTIONS_ASSET_TYPE, input } from "@ignifx/input";
import { CharacterController2D, CircleCollider2D, physics2d, TilemapCollider2D } from "@ignifx/physics-2d";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// Vite virtual modules the plugin serves, typed by `@ignifx/vite-plugin/client`.
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { createRun } from "./run.js";
import { Collectible } from "./scripts/collectible.js";
import { HudLine } from "./scripts/hud-line.js";
import { MenuController } from "./scripts/menu-controller.js";
import { PlatformerController } from "./scripts/platformer-controller.js";
import { SaveGame } from "./scripts/save-game.js";
import type { GameMenus } from "./menus/game-menus.js";
import type { GraphicsHooks } from "./menus/settings-store.js";
import type { SpriteAnimationAsset, SpriteAtlasAsset, TileObjectContext, TilemapAsset } from "@ignifx/2d";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A pixel-perfect 2D side-scroller: three parallax bands, a tilemap with slopes and one-way
 * platforms, collectible coins, and a reference platformer controller.
 *
 * The build order is the same as every ignifx game's — create the app, load and **await** every
 * asset before `app.start()`, build the world, start — and the interesting parts are:
 *
 * - `Camera2D.pixelPerfect` with a `referenceResolution` of 320 by 180. The camera snaps its zoom
 *   to a whole number and its position to the pixel grid, so one source texel always covers an
 *   exact square of screen pixels. It does **not** change how the atlas is sampled: that is
 *   `"sampling": "nearest"` in each `.atlas.json`, because a texture's sampler is fixed at upload.
 * - One `ParallaxLayer` per band. The component slows a whole *sorting layer* down, which is why
 *   `ignifx.config.ts` declares `Sky`, `Hills` and `Trees` as separate layers.
 *
 * ## Query flags
 *
 * - `?static=1` stops the clock before the first frame and leaves the front end out, so the picture
 *   is exactly the authored scene. It is what the visual golden suite in `tests/visual/` opens.
 * - `?hud=1` keeps the DOM overlay visible in a `?static=1` scene, which is what the gallery
 *   capture script uses.
 * - `?locale=<tag>` picks a locale from `assets/strings.i18n.json` before the menus are built.
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

/** The map is 64 by 20 cells of one metre, and the camera may not leave it. */
const LEVEL_SIZE = { x: 64, y: 20 };

/** The design resolution the pixel-perfect camera fits a whole-number zoom to. */
const REFERENCE_RESOLUTION = { x: 320, y: 180 };

/**
 * One parallax band: which sorting layer it owns, which atlas frame it draws, how much of the
 * camera's motion it follows, and where it sits.
 *
 * A factor of `1` means "moves with the world"; `0` means "pinned to the screen", which is what a
 * sky wants. The bands in between are what produce the sense of depth.
 */
const BANDS = [
  { layer: "Sky", frame: "sky", factor: { x: 0, y: 0 }, y: 0, copies: 1, span: 40 },
  { layer: "Hills", frame: "hills", factor: { x: 0.25, y: 1 }, y: 6, copies: 5, span: 20 },
  { layer: "Trees", frame: "trees", factor: { x: 0.5, y: 1 }, y: 1.75, copies: 5, span: 20 },
] as const;

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
const STRINGS = { type: I18N_ASSET_TYPE } as const;

/** Everything the world is built from. */
interface Assets {
  readonly tiles: AssetHandle<SpriteAtlasAsset>;
  readonly heroAtlas: AssetHandle<SpriteAtlasAsset>;
  readonly heroClips: AssetHandle<SpriteAnimationAsset>;
  readonly coinAtlas: AssetHandle<SpriteAtlasAsset>;
  readonly coinClips: AssetHandle<SpriteAnimationAsset>;
  readonly parallax: AssetHandle<SpriteAtlasAsset>;
  readonly level: AssetHandle<TilemapAsset>;
  readonly pickup: AssetHandle<AudioClip>;
  readonly footstep: AssetHandle<AudioClip>;
  readonly jump: AssetHandle<AudioClip>;
  readonly land: AssetHandle<AudioClip>;
  readonly uiClick: AssetHandle<AudioClip>;
  readonly uiHover: AssetHandle<AudioClip>;
  readonly ambient: AssetHandle<AudioClip>;
}

/** What {@link buildWorld} produced. */
interface World {
  /** The character. */
  readonly player: Entity;
  /** Where the character starts. */
  readonly spawn: Vec2;
  /** Every coin the objects layer spawned. */
  readonly coins: readonly Collectible[];
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

/**
 * The clip behind a handle, or `null` when the browser refused to decode it.
 *
 * @remarks
 * `AssetHandle.value` is only meaningful once the handle is `"loaded"`; every sound in this
 * template is optional, so a failed decode costs the game that sound and nothing else.
 *
 * @param handle - The handle to read.
 * @returns The clip, or `null`.
 */
function clipOrNull(handle: AssetHandle<AudioClip>): AudioClip | null {
  return handle.state === "loaded" ? handle.value : null;
}

/** Swaps the canvas for the "no WebGPU here" panel in `index.html`. */
function showUnsupported(): void {
  document.body.dataset["webgpu"] = "unavailable";
}

/**
 * Builds the three parallax bands.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 */
function buildParallax(app: App, assets: Assets): void {
  const atlas = assets.parallax.value;
  for (const band of BANDS) {
    const controller = app.world.createEntity(`Parallax ${band.layer}`);
    controller.addComponent(ParallaxLayer, {
      sortingLayer: band.layer,
      factor: band.factor,
      // Wrapping the offset by one repetition is what stops a distant band from drifting away
      // from the camera — and what keeps the number in single-precision range on a long level.
      repeatX: band.copies > 1,
      repeatWidth: band.span,
    });

    // The component offsets the layer; it does not duplicate sprites. Enough copies are placed by
    // hand to cover the widest view plus one repetition on each side.
    const first = -Math.floor(band.copies / 2);
    for (let index = 0; index < band.copies; index += 1) {
      const strip = app.world.createEntity(`${band.layer} ${String(index)}`);
      strip.transform.position2D = new Vec2((first + index) * band.span, band.y);
      // `frame` is a runtime property rather than a schema field, so it is assigned after the
      // component exists; passing it to `addComponent` is `IGX-0607`.
      strip.addComponent(SpriteRenderer, {
        sprite: assets.parallax.retain(),
        sortingLayer: band.layer,
      }).frame = atlas.requireFrame(band.frame);
    }
  }
}

/**
 * Registers the factories the tilemap's objects layer names.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param coins - The list every spawned coin is appended to.
 * @returns A function that answers with the player entity and its spawn point once the map has been
 *   walked.
 */
function registerObjectFactories(
  app: App,
  assets: Assets,
  coins: Collectible[],
): () => { readonly player: Entity | null; readonly spawn: Vec2 } {
  let player: Entity | null = null;
  let spawn = new Vec2();
  const pickup = app.world.layers.requireIndex("Pickup");

  app.twoD.registerTileObjectFactory("spawn", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = app.world.layers.requireIndex("Player");
    spawn = new Vec2(context.position.x, context.position.y);
    entity.transform.position2D = new Vec2(spawn.x, spawn.y);
    entity.addComponent(SpriteRenderer, { sprite: assets.heroAtlas.retain(), sortingLayer: "Default" });
    entity.addComponent(SpriteAnimator, {
      animations: assets.heroClips.retain(),
      defaultClip: "idle",
      playOnAwake: true,
    });
    // `shape: "box"` is not a style choice: with the default capsule of radius 0.2 the autostep
    // clears about 0.15 m, and a box is what actually gets `stepOffset` metres of step
    // (ADR-0006 Validation). A stair-climbing character needs the box.
    entity.addComponent(CharacterController2D, {
      shape: "box",
      radius: 0.28,
      height: 0.9,
      offset: { x: 0, y: 0.45 },
      slopeLimit: 50,
      stepOffset: 0.3,
      snapToGround: 0.25,
      onOneWayPlatforms: true,
    });
    const controller = entity.addComponent(PlatformerController);
    // The clips are handed over rather than loaded inside the script, so a hot-reloaded script
    // does not re-request a file the asset service has already delivered.
    controller.footstep = clipOrNull(assets.footstep) === null ? null : assets.footstep;
    controller.jumpSound = clipOrNull(assets.jump) === null ? null : assets.jump;
    controller.landSound = clipOrNull(assets.land) === null ? null : assets.land;
    player = entity;
    return entity;
  });

  app.twoD.registerTileObjectFactory("coin", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = pickup;
    entity.transform.position2D = new Vec2(context.position.x, context.position.y);
    entity.addComponent(SpriteRenderer, { sprite: assets.coinAtlas.retain(), sortingLayer: "Default" });
    entity.addComponent(SpriteAnimator, {
      animations: assets.coinClips.retain(),
      defaultClip: "spin",
      playOnAwake: true,
    });
    entity.addComponent(CircleCollider2D, { radius: 0.35, isTrigger: true });
    const coin = entity.addComponent(Collectible);
    if (clipOrNull(assets.pickup) !== null) {
      coin.clip = assets.pickup;
    }
    coins.push(coin);
    return entity;
  });

  return () => ({ player, spawn });
}

/**
 * Builds the world.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @returns The player entity.
 */
function buildWorld(app: App, assets: Assets): World {
  buildParallax(app, assets);
  const coins: Collectible[] = [];
  const take = registerObjectFactories(app, assets, coins);

  const level = app.world.createEntity("Level");
  level.layer = app.world.layers.requireIndex("Terrain");
  const map = level.addComponent(Tilemap, { map: assets.level.retain(), chunkSize: 16 });
  level.addComponent(TilemapRenderer, { atlas: assets.tiles.retain(), cullChunks: true });
  // Solid tiles become merged outlines; a `oneWay` tile contributes only its top edge, which is
  // what `CharacterController2D.onOneWayPlatforms` collides against.
  level.addComponent(TilemapCollider2D).collisionData = map.collisionData;

  spawnTilemapObjects(app, app.twoD, map);
  const spawned = take();
  const player = spawned.player;
  if (player === null) {
    throw new Error('level.tilemap.json has no object of type "spawn".');
  }

  const eye = app.world.createEntity("Main Camera");
  eye.transform.position2D = new Vec2(player.transform.position2D.x, player.transform.position2D.y + 1.5);
  eye.addComponent(Camera2D, {
    // `orthographicSize` is ignored while `pixelPerfect` is on: the zoom comes from
    // `viewportHeight / referenceResolution.y`, snapped to a whole number.
    pixelPerfect: true,
    referenceResolution: REFERENCE_RESOLUTION,
    follow: player,
    followDamping: 0.1,
    followOffset: { x: 0, y: 1.5 },
    deadZone: { x: 1.2, y: 1.5 },
    boundsMin: { x: 0, y: 0 },
    boundsMax: LEVEL_SIZE,
  });
  eye.addComponent(Camera2DFollow);
  // The ears ride the camera, so a sound is panned from where the player is looking.
  eye.addComponent(AudioListener);
  return { player, spawn: spawned.spawn, coins };
}

/**
 * Builds the front end and the save file over a world that is already standing.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param world - What {@link buildWorld} produced.
 * @param hud - The HUD element, or `null` under an app with no DOM overlay.
 * @param isBench - Whether the frame-time harness is driving, in which case the game starts
 *   immediately instead of waiting on a title screen.
 * @returns A promise that settles once the front end is up.
 */
async function installFrontEnd(
  app: App,
  assets: Assets,
  world: World,
  hud: HTMLDivElement | null,
  isBench: boolean,
): Promise<void> {
  // A 2D sprite scene has no shadow-casting light and no post-process chain, so the settings
  // screen leaves both graphics rows out rather than offering a switch that does nothing.
  const graphics: GraphicsHooks = {
    supportsShadows: false,
    supportsPostProcessing: false,
    setShadows: (): void => {
      // No shadows in a sprite scene.
    },
    setPostProcessing: (): void => {
      // No post-process chain in a sprite scene.
    },
  };

  await loadInputOverrides(app);
  const settings = await loadSettings(app, app.i18n.locale);
  applySettings(app, settings, graphics);

  const host = app.world.createEntity("Game UI");
  const saveGame = host.addComponent(SaveGame);
  let menus: GameMenus | null = null;

  const run = createRun(world.player, world.coins, world.spawn, (): void => {
    if (saveGame.checkpoint()) {
      menus?.toast(app.i18n.t("toast.checkpoint"));
    }
  });
  saveGame.run = run.state;

  menus = createGameMenus(app, {
    settings,
    graphics,
    gameplayMap: "Player",
    rebindable: [
      { action: "jump", labelKey: "action.jump" },
      { action: "pause", labelKey: "action.pause" },
    ],
    creditKeys: ["credits.engine", "credits.art", "credits.license"],
    sounds: { click: clipOrNull(assets.uiClick), hover: clipOrNull(assets.uiHover) },
    onStartNew: (): void => {
      saveGame.restart();
    },
    onContinue: (save): void => {
      saveGame.restore(save);
    },
    onSaveNow: (): Promise<boolean> => saveGame.save(),
    onQuitToTitle: (): void => {
      saveGame.restart();
    },
  });
  host.addComponent(MenuController).menus = menus;

  const line = host.addComponent(HudLine);
  line.element = hud;
  line.render = (): string => app.i18n.t("hud.status", { score: run.score() });

  // The ambient pad loops on the `Music` bus, which `game.audio.json` marks as not pausable so the
  // menus can duck it rather than silence it.
  if (clipOrNull(assets.ambient) !== null) {
    app.world.createEntity("Ambience").addComponent(AudioSource, {
      clip: assets.ambient.retain(),
      bus: "Music",
      loop: true,
      playOnAwake: true,
      volume: 0.9,
    });
  }

  if (isBench) {
    // The frame-time harness measures a *running* game, so it skips the title screen. Everything
    // else is the scene a player gets.
    return;
  }
  // The game boots into its title screen. `MenuController` reconciles `app.pause()` against the
  // screen stack every frame, so this one call is what stops the world until "New game".
  menus.show("title");
  app.pause();
}

/**
 * Builds and runs the game.
 *
 * @returns The status `window.__ignifxReady` resolves to.
 */
async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('2d-sidescroller needs a <canvas id="game"> element on the page.');
  }

  const flags = new URLSearchParams(window.location.search);
  const isStatic = flags.get("static") === "1";
  const isBench = flags.get("bench") === "1";
  const showOverlay = (!isStatic || flags.get("hud") === "1") && !isBench;

  let app: App;
  try {
    app = await createApp({
      canvas,
      settings: import.meta.env.IGNIFX_CONFIG,
      // The address-to-URL table `@ignifx/vite-plugin` built from `assets/`. Importing the virtual
      // module rather than fetching `assets.manifest.json` means the table is in the bundle, so
      // the first asset request needs no round trip.
      assets: { manifest },
      // `electron()` is registered in **both** builds. Without a preload bridge it is inert — one
      // debug line, and an `app.desktop` that answers `isElectron === false` — so the browser build
      // is unchanged and the desktop build needs no second entry point. It goes first because it
      // only requires core, and because `app.storage` should be the file backend before any other
      // extension reads a setting from it.
      extensions: [electron(), twoD(), physics2d(), input(), audio(), ui()],
    });
  } catch (error) {
    // IGX-0701: the browser has no WebGPU, and ignifx has no fallback renderer (ADR-0001).
    if (isIgnifxError(error) && error.code === "IGX-0701") {
      showUnsupported();
      return "unsupported";
    }
    throw error;
  }

  // Every class under `src/scripts/**` with a `static typeId`, from the plugin's virtual registry; in

  // development the registry hot-reloads edited scripts through `app.hotReload` (`"patch"` by default).

  app.registerComponents(scripts);

  acceptHotReload(app);

  // The strings come first and alone: every label below is read out of them, and the document is
  // under three kilobytes, so nothing is gained by making the loading screen wait for it.
  const strings = app.assets.load<LocaleAsset>("strings.i18n.json", STRINGS);
  await strings.promise;
  await app.i18n.load(strings);
  const locale = flags.get("locale");
  if (locale !== null && app.i18n.availableLocales.includes(locale)) {
    app.i18n.locale = locale;
  }

  // The overlay comes up before the first asset is requested, so the loading bar sees every byte.
  const gameUi = createGameUi(
    app,
    app.i18n.t("loading.label"),
    [{ control: "jump", label: "▲" }],
    !isStatic && hasTouch(),
  );
  app.ui.visible = showOverlay;

  const assets: Assets = {
    tiles: app.assets.load<SpriteAtlasAsset>("tiles.atlas.json", ATLAS),
    heroAtlas: app.assets.load<SpriteAtlasAsset>("hero.atlas.json", ATLAS),
    heroClips: app.assets.load<SpriteAnimationAsset>("hero.spriteanim.json", CLIPS),
    coinAtlas: app.assets.load<SpriteAtlasAsset>("coin.atlas.json", ATLAS),
    coinClips: app.assets.load<SpriteAnimationAsset>("coin.spriteanim.json", CLIPS),
    parallax: app.assets.load<SpriteAtlasAsset>("parallax.atlas.json", ATLAS),
    level: app.assets.load<TilemapAsset>("level.tilemap.json", MAP),
    pickup: app.assets.load<AudioClip>("pickup.wav", CLIP),
    footstep: app.assets.load<AudioClip>("footstep.wav", CLIP),
    jump: app.assets.load<AudioClip>("jump.wav", CLIP),
    land: app.assets.load<AudioClip>("land.wav", CLIP),
    uiClick: app.assets.load<AudioClip>("ui-click.wav", CLIP),
    uiHover: app.assets.load<AudioClip>("ui-hover.wav", CLIP),
    ambient: app.assets.load<AudioClip>("ambient.wav", CLIP),
  };
  const actions = app.assets.load<InputActionsAsset>("game.input.json", ACTIONS);
  const buses = app.assets.load<AudioBusesAsset>("game.audio.json", BUSES);

  await Promise.all([
    assets.tiles.promise,
    assets.heroAtlas.promise,
    assets.heroClips.promise,
    assets.coinAtlas.promise,
    assets.coinClips.promise,
    assets.parallax.promise,
    assets.level.promise,
    actions.promise,
    buses.promise,
  ]);
  // The clips are awaited together and separately from the rest: a browser that refuses to decode
  // a sound should cost the game its audio, not its first frame.
  await Promise.all(
    [assets.pickup, assets.footstep, assets.jump, assets.land, assets.uiClick, assets.uiHover, assets.ambient].map(
      async (handle: AssetHandle<AudioClip>): Promise<void> => {
        await handle.promise.catch((error: unknown) => {
          app.log.warn("a sound could not be decoded: {error}", String(error));
        });
      },
    ),
  );

  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);
  const world = buildWorld(app, assets);

  if (isStatic) {
    // No fixed step ever runs, so nothing falls and nothing animates: the frame is exactly what
    // was authored, which is what a golden needs.
    app.time.timeScale = 0;
  } else {
    await installFrontEnd(app, assets, world, gameUi.hud, isBench);
  }

  if (isStatic && showOverlay && gameUi.hud !== null) {
    // `?static=1` leaves the front end out, so nothing writes the HUD. `?hud=1` says the overlay is
    // wanted anyway — the gallery capture asks for exactly that — so the zero state is written once.
    gameUi.hud.textContent = app.i18n.t("hud.status", { score: 0 });
  }

  gameUi.loading.hide();

  if (isBench) {
    installFrameTimeProbe(app);
  }

  await app.start();
  await settle(SETTLE_FRAMES);
  app.log.info("2d-sidescroller running: {sprites} sprites", app.twoD.spriteCount);
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
