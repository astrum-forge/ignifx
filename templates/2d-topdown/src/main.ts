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
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener, AudioSource } from "@ignifx/audio";
import { createApp, isIgnifxError, Vec2 } from "@ignifx/core";
import { electron } from "@ignifx/electron";
import { INPUT_ACTIONS_ASSET_TYPE, input } from "@ignifx/input";
import { BoxCollider2D, CharacterController2D, physics2d, TilemapCollider2D } from "@ignifx/physics-2d";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// Vite virtual modules the plugin serves, typed by `@ignifx/vite-plugin/client`.
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { installGameplayProbe } from "./gameplay-probe.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { createRun } from "./run.js";
import { HudLine } from "./scripts/hud-line.js";
import { MenuController } from "./scripts/menu-controller.js";
import { PlayerController } from "./scripts/player-controller.js";
import { SaveGame } from "./scripts/save-game.js";
import { Shrine } from "./scripts/shrine.js";
import type { GameMenus } from "./menus/game-menus.js";
import type { GraphicsHooks } from "./menus/settings-store.js";
import type { Run } from "./run.js";
import type { SpriteAnimationAsset, SpriteAtlasAsset, TileObjectContext, TilemapAsset } from "@ignifx/2d";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A top-down 2D game: a tilemap with a collision layer, a Y-sorted layer of props and a character,
 * a dead-zoned camera follow, shrines to light, a title screen, a pause menu, a settings screen
 * with interactive rebinding, and a save file.
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
 * ## Query flags
 *
 * - `?static=1` stops the clock before the first frame and leaves the front end out, so the picture
 *   is exactly the authored scene and nothing depends on how long a frame took. It is what the
 *   visual golden suite in `tests/visual/` opens.
 * - `?hud=1` keeps the DOM overlay visible in a `?static=1` scene, which is what the gallery
 *   capture script uses; a golden leaves it off so the image never depends on how the runner draws
 *   a system font.
 * - `?probe=1` installs `window.__ignifxGameplay`, the read-only test hook the gameplay half of
 *   `tests/visual/tests/templates.spec.ts` measures the character with. See `src/gameplay-probe.ts`.
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

/** Half the viewport height, in metres: 18 metres of world, which is 288 tile pixels. */
const CAMERA_HALF_HEIGHT = 9;

/** The map is 40 by 24 cells of one metre, and the camera may not leave it. */
const LEVEL_SIZE = { x: 40, y: 24 };

/** Explicit loader types for the template assets. */
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
  readonly level: AssetHandle<TilemapAsset>;
  readonly pickup: AssetHandle<AudioClip>;
  readonly footstep: AssetHandle<AudioClip>;
  readonly uiClick: AssetHandle<AudioClip>;
  readonly uiHover: AssetHandle<AudioClip>;
  readonly ambient: AssetHandle<AudioClip>;
}

/** What {@link buildWorld} produced. */
interface World {
  /** The character. */
  readonly player: Entity;
  /** The camera that follows it. */
  readonly camera: Entity;
  /** Where the character starts. */
  readonly spawn: Vec2;
  /** Every shrine the objects layer spawned. */
  readonly shrines: readonly Shrine[];
}

function noop(): void {
  // Nothing to do: the promise executor runs synchronously and replaces this on the next line.
}

let announceReady: (status: AppStatus) => void = noop;
window.__ignifxReady = new Promise<AppStatus>((resolve) => {
  announceReady = resolve;
});

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
 * Registers the factories the tilemap's objects layer names, so a map edit can add a prop or move
 * the spawn point without touching this file.
 *
 * @param app - The running app.
 * @param assets - The loaded assets the factories draw from.
 * @param shrines - The list every spawned shrine is appended to.
 * @returns The player entity and its spawn point once the map has been walked.
 */
function registerObjectFactories(
  app: App,
  assets: Assets,
  shrines: Shrine[],
): () => { readonly player: Entity | null; readonly spawn: Vec2 } {
  let player: Entity | null = null;
  let spawn = new Vec2();
  const solid = app.world.layers.requireIndex("Solid");
  const triggerLayer = app.world.layers.requireIndex("Trigger");
  const atlas = assets.tiles.value;

  app.twoD.registerTileObjectFactory("spawn", (context: TileObjectContext): Entity => {
    const entity = app.world.createEntity(context.name);
    entity.layer = app.world.layers.requireIndex("Player");
    spawn = new Vec2(context.position.x, context.position.y);
    entity.transform.position2D = new Vec2(spawn.x, spawn.y);

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
    const controller = entity.addComponent(PlayerController, { speed: 4.5 });
    // The clip is handed over rather than loaded inside the script, so a script that is hot-reloaded
    // does not re-request a file the asset service has already delivered.
    if (clipOrNull(assets.footstep) !== null) {
      controller.footstep = assets.footstep;
    }
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
    const shrine = entity.addComponent(Shrine);
    if (clipOrNull(assets.pickup) !== null) {
      shrine.clip = assets.pickup;
    }
    shrines.push(shrine);
    return entity;
  });

  return () => ({ player, spawn });
}

/**
 * Builds the world: the tilemap and its collider, everything the objects layer spawns, and the
 * camera that follows whatever the `spawn` object produced.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @returns The character, its spawn point and the shrines.
 */
function buildWorld(app: App, assets: Assets): World {
  const shrines: Shrine[] = [];
  const take = registerObjectFactories(app, assets, shrines);

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
  const spawned = take();
  if (spawned.player === null) {
    throw new Error('level.tilemap.json has no object of type "spawn".');
  }

  const eye = app.world.createEntity("Main Camera");
  eye.transform.position2D = new Vec2(spawned.spawn.x, spawned.spawn.y);
  eye.addComponent(Camera2D, {
    orthographicSize: CAMERA_HALF_HEIGHT,
    follow: spawned.player,
    followDamping: 0.12,
    // The target rides the edge of this rectangle instead of being pinned to the middle of the
    // screen, so small steps do not drag the whole world around.
    deadZone: { x: 1.5, y: 1 },
    boundsMin: { x: 0, y: 0 },
    boundsMax: LEVEL_SIZE,
  });
  eye.addComponent(Camera2DFollow);
  // The ears ride the camera, so a sound is panned from where the player is looking.
  eye.addComponent(AudioListener);
  return { player: spawned.player, camera: eye, spawn: spawned.spawn, shrines };
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
 * @returns A promise that answers with the run once the front end is up.
 */
async function installFrontEnd(
  app: App,
  assets: Assets,
  world: World,
  hud: HTMLDivElement | null,
  isBench: boolean,
): Promise<Run> {
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

  const run = createRun(world.player, world.shrines, world.spawn, (): void => {
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
      { action: "interact", labelKey: "action.interact" },
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

  // `interact` runs a shape query and now says what it found, because a control the player is told
  // to press has to do something the player can see.
  const controller = world.player.getComponent(PlayerController);
  if (controller !== null) {
    controller.onLookAround = (names: readonly string[]): void => {
      menus.toast(
        names.length === 0
          ? app.i18n.t("toast.nothingNearby")
          : app.i18n.t("toast.nearby", { names: names.join(", ") }),
      );
    };
  }

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
    return run;
  }
  // The game boots into its title screen. `MenuController` reconciles `app.pause()` against the
  // screen stack every frame, so this one call is what stops the world until "New game".
  menus.show("title");
  app.pause();
  return run;
}

async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('2d-topdown needs a <canvas id="game"> element on the page.');
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
    // IGX-0701 is the one failure a shipped game must handle itself: the browser has no WebGPU and
    // ignifx has no fallback renderer by decision (ADR-0001).
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
    [{ control: "interact", label: "E" }],
    !isStatic && hasTouch(),
  );
  app.ui.visible = showOverlay;

  const assets: Assets = {
    tiles: app.assets.load<SpriteAtlasAsset>("tiles.atlas.json", ATLAS),
    heroAtlas: app.assets.load<SpriteAtlasAsset>("hero.atlas.json", ATLAS),
    heroClips: app.assets.load<SpriteAnimationAsset>("hero.spriteanim.json", CLIPS),
    level: app.assets.load<TilemapAsset>("level.tilemap.json", MAP),
    pickup: app.assets.load<AudioClip>("pickup.wav", CLIP),
    footstep: app.assets.load<AudioClip>("footstep.wav", CLIP),
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
    assets.level.promise,
    actions.promise,
    buses.promise,
  ]);
  // The clips are awaited together and separately from the rest: a browser that refuses to decode
  // a sound should cost the game its audio, not its first frame.
  await Promise.all(
    [assets.pickup, assets.footstep, assets.uiClick, assets.uiHover, assets.ambient].map(
      async (handle: AssetHandle<AudioClip>): Promise<void> => {
        await handle.promise.catch((error: unknown) => {
          app.log.warn("a sound could not be decoded: {error}", String(error));
        });
      },
    ),
  );

  // Installed here rather than through `input.actions` in `ignifx.config.ts`, so that the maps
  // exist before the first `update` runs. See the comment in that file.
  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  const world = buildWorld(app, assets);

  if (isStatic) {
    // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
    // nothing animates and the camera never chases: the frame is exactly what was authored. The
    // front end is left out for the same reason.
    app.time.timeScale = 0;
  } else {
    const run = await installFrontEnd(app, assets, world, gameUi.hud, isBench);
    // A read-only test hook, and only under `?probe=1`: the gameplay half of the template spec
    // measures the character in metres rather than in pixels. See `src/gameplay-probe.ts`.
    if (flags.get("probe") === "1") {
      installGameplayProbe(app, world.player, world.camera, world.shrines, run);
    }
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
  app.log.info("2d-topdown running; sprites:", app.twoD.spriteCount);
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
