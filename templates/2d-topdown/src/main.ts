// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { Tilemap } from "@ignifx/2d";
import { AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioSource } from "@ignifx/audio";
import { createApp, isIgnifxError, Vec2 } from "@ignifx/core";
import { INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { TilemapCollider2D } from "@ignifx/physics-2d";
import { I18N_ASSET_TYPE } from "@ignifx/ui";
// Vite virtual modules the plugins serve, typed by `@ignifx/vite-plugin/client` and
// `@ignifx/editor-host/client`.
import { attachEditorPlayControls } from "virtual:ignifx/editor";
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { extensions } from "./extensions.js";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { installGameplayProbe } from "./gameplay-probe.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { createRun } from "./run.js";
import { scriptType } from "./script-types.js";
import type { GameMenus } from "./menus/game-menus.js";
import type { GraphicsHooks } from "./menus/settings-store.js";
import type { Run } from "./run.js";
// Types only: they are erased before the dev server sees this file, so no script module joins the
// entry's graph and an edit to one hot-patches it instead of reloading the page (`script-types.ts`).
import type { HudLine } from "./scripts/hud-line.js";
import type { MenuController } from "./scripts/menu-controller.js";
import type { PlayerController } from "./scripts/player-controller.js";
import type { SaveGame } from "./scripts/save-game.js";
import type { Shrine } from "./scripts/shrine.js";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A top-down 2D game: a tilemap with a collision layer, a Y-sorted layer of props and a character,
 * a dead-zoned camera follow, shrines to light, a title screen, a pause menu, a settings screen
 * with interactive rebinding, and a save file.
 *
 * The level is data: `assets/scenes/main.scene.json` holds every entity, component and reference,
 * and this file loads it. The shape of this file is the shape of every ignifx game:
 *
 * 1. `createApp` with `extensions()` from `./extensions.ts`; `ignifx.config.ts` carries the settings.
 * 2. Register the scripts from `virtual:ignifx/scripts`, accept hot reloads, and hand the app to
 *    the ignifx editor's play controls.
 * 3. Load what the scene's scripts read while it loads (input actions, audio buses), then the
 *    scene itself. **Await it before `app.start()`**: a load awaited before the loop runs settles as
 *    soon as it finishes; once the loop is running, delivery waits for a `PreUpdate`.
 * 4. The post-load steps a scene file cannot express — the README's "The level" lists them.
 * 5. `app.start()`.
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

/** The level, by its asset address. */
const MAIN_SCENE = "scenes/main.scene.json";

/** How many animation frames the scene is given before the image is called settled. */
const SETTLE_FRAMES = 12;

/** Explicit loader types for the template assets. */
const ACTIONS = { type: INPUT_ACTIONS_ASSET_TYPE } as const;
const CLIP = { type: AUDIO_ASSET_TYPE } as const;
const BUSES = { type: AUDIO_BUSES_ASSET_TYPE } as const;
const STRINGS = { type: I18N_ASSET_TYPE } as const;

/** The sounds, which stay out of the scene file: each one is optional (see `clipOrNull`). */
interface Sounds {
  readonly pickup: AssetHandle<AudioClip>;
  readonly footstep: AssetHandle<AudioClip>;
  readonly uiClick: AssetHandle<AudioClip>;
  readonly uiHover: AssetHandle<AudioClip>;
  readonly ambient: AssetHandle<AudioClip>;
}

/** The entities of the loaded scene that the code below wires up. */
interface World {
  /** The character. */
  readonly player: Entity;
  /** The camera that follows it. */
  readonly camera: Entity;
  /** Where the character starts: wherever the scene puts it. */
  readonly spawn: Vec2;
  /** Every shrine in the scene, in scene order. */
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
 * Finds an entity of the loaded scene by name.
 *
 * @param app - The running app.
 * @param name - The entity's name in `assets/scenes/main.scene.json`.
 * @returns The entity.
 * @throws Error when the scene has no entity of that name.
 */
function requireEntity(app: App, name: string): Entity {
  const entity = app.world.findByName(name);
  if (entity === null) {
    throw new Error(`${MAIN_SCENE} has no entity named "${name}".`);
  }
  return entity;
}

/**
 * Wires up the loaded scene: the tilemap's collision outlines, the optional sounds, and the
 * entities the front end needs.
 *
 * @param app - The app the scene was loaded in.
 * @param sounds - The sounds that decoded, and the ones that did not.
 * @returns The character, the camera, the spawn point and the shrines.
 */
function prepareWorld(app: App, sounds: Sounds): World {
  // The merged outlines of every solid tile, as one static compound body. `TilemapCollider2D` does
  // not find the tilemap beside it, so the data is handed over here; it watches the data's
  // `version` each fixed step, so editing a tile at runtime reaches physics with no subscription.
  const level = requireEntity(app, "Level");
  level.requireComponent(TilemapCollider2D).collisionData = level.requireComponent(Tilemap).collisionData;

  const player = requireEntity(app, "Player");
  // The clips are handed over rather than loaded inside the scripts, so a script that is
  // hot-reloaded does not re-request a file the asset service has already delivered.
  if (clipOrNull(sounds.footstep) !== null) {
    player.requireComponent(scriptType<PlayerController>(app, "topdown/PlayerController")).footstep = sounds.footstep;
  }
  const shrines = app.world.components(scriptType<Shrine>(app, "topdown/Shrine"));
  for (const shrine of shrines) {
    if (clipOrNull(sounds.pickup) !== null) {
      shrine.clip = sounds.pickup;
    }
  }
  const here = player.transform.position2D;
  return {
    player,
    camera: requireEntity(app, "Main Camera"),
    spawn: new Vec2(here.x, here.y),
    shrines: [...shrines],
  };
}

/**
 * Builds the front end and the save file over a world that is already standing.
 *
 * @param app - The running app.
 * @param sounds - The sounds that decoded, and the ones that did not.
 * @param world - What {@link prepareWorld} found.
 * @param hud - The HUD element, or `null` under an app with no DOM overlay.
 * @param isBench - Whether the frame-time harness is driving, in which case the game starts
 *   immediately instead of waiting on a title screen.
 * @returns A promise that answers with the run once the front end is up.
 */
async function installFrontEnd(
  app: App,
  sounds: Sounds,
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
  const saveGame = host.addComponent(scriptType<SaveGame>(app, "topdown/SaveGame"));
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
    sounds: { click: clipOrNull(sounds.uiClick), hover: clipOrNull(sounds.uiHover) },
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
  host.addComponent(scriptType<MenuController>(app, "topdown/MenuController")).menus = menus;

  const line = host.addComponent(scriptType<HudLine>(app, "topdown/HudLine"));
  line.element = hud;
  line.render = (): string => app.i18n.t("hud.status", { score: run.score() });

  // `interact` runs a shape query and now says what it found, because a control the player is told
  // to press has to do something the player can see.
  const controller = world.player.getComponent(scriptType<PlayerController>(app, "topdown/PlayerController"));
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
  if (clipOrNull(sounds.ambient) !== null) {
    app.world.createEntity("Ambience").addComponent(AudioSource, {
      clip: sounds.ambient,
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
      extensions: extensions(),
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

  // Every class under `src/scripts/**` with a `static typeId`, from the plugin's virtual registry. It
  // is the only way code reaches a script: the scene names them by `typeId`, and so does
  // `scriptType`. In development the registry hot-reloads edited scripts through `app.hotReload`
  // (`"patch"` by default).
  app.registerComponents(scripts);
  acceptHotReload(app);
  // Under `vite dev`, lets the ignifx editor's play view play, pause, step and stop this app. In a
  // production build it is an empty function (`vite.config.ts`).
  attachEditorPlayControls(app);

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
  const gameUi = createGameUi(app, {
    loadingLabel: app.i18n.t("loading.label"),
    buttons: [{ control: "interact", label: "E", ariaLabel: app.i18n.t("action.interact") }],
    moveLabel: app.i18n.t("action.move"),
    pauseLabel: app.i18n.t("action.pause"),
    touch: !isStatic && hasTouch(),
  });
  app.ui.visible = showOverlay;

  const sounds: Sounds = {
    pickup: app.assets.load<AudioClip>("pickup.wav", CLIP),
    footstep: app.assets.load<AudioClip>("footstep.wav", CLIP),
    uiClick: app.assets.load<AudioClip>("ui-click.wav", CLIP),
    uiHover: app.assets.load<AudioClip>("ui-hover.wav", CLIP),
    ambient: app.assets.load<AudioClip>("ambient.wav", CLIP),
  };
  const actions = app.assets.load<InputActionsAsset>("game.input.json", ACTIONS);
  const buses = app.assets.load<AudioBusesAsset>("game.audio.json", BUSES);

  await Promise.all([actions.promise, buses.promise]);
  // The clips are awaited together and separately from the rest: a browser that refuses to decode
  // a sound should cost the game its audio, not its first frame.
  await Promise.all(
    Object.values(sounds).map(async (handle: AssetHandle<AudioClip>): Promise<void> => {
      await handle.promise.catch((error: unknown) => {
        app.log.warn("a sound could not be decoded: {error}", String(error));
      });
    }),
  );

  // Installed here rather than through `input.actions` in `ignifx.config.ts`, so that the maps
  // exist before the scene loads: `PlayerController` resolves its action names in `awake`, which
  // runs while `loadScene` builds it.
  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  // The level: the loader fetches every atlas, clip set and tilemap the file names before it builds
  // an entity, so each `SpriteFrame` can resolve its frame name in `awake`.
  await app.world.loadScene(MAIN_SCENE);
  const world = prepareWorld(app, sounds);

  if (isStatic) {
    // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
    // nothing animates and the camera never chases: the frame is exactly what was authored. The
    // front end is left out for the same reason.
    app.time.timeScale = 0;
  } else {
    const run = await installFrontEnd(app, sounds, world, gameUi.hud, isBench);
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
