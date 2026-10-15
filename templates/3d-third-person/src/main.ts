// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { NavMeshAgent, ThirdPersonCamera, ThirdPersonController } from "@ignifx/3d";
import { AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioSource } from "@ignifx/audio";
import { createApp, isIgnifxError, Light, PostProcessStack, Script } from "@ignifx/core";
import { INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { Rigidbody } from "@ignifx/physics";
import { I18N_ASSET_TYPE } from "@ignifx/ui";
// Vite virtual modules the plugins serve, typed by `@ignifx/vite-plugin/client` and
// `@ignifx/editor-host/client`.
import { attachEditorPlayControls } from "virtual:ignifx/editor";
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { installDesktopProbe } from "./desktop-probe.js";
import { extensions } from "./extensions.js";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { installGameplayProbe } from "./gameplay-probe.js";
import { publishLevelMeshes } from "./level-meshes.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { bakeNavigation } from "./navigation.js";
import { createRun } from "./run.js";
import { scriptType } from "./script-types.js";
import type { GameMenus } from "./menus/game-menus.js";
import type { GraphicsHooks } from "./menus/settings-store.js";
// Types only: they are erased before the dev server sees this file, so no script module joins the
// entry's graph and an edit to one hot-patches it instead of reloading the page (`script-types.ts`).
import type { Beacon } from "./scripts/beacon.js";
import type { Companion } from "./scripts/companion.js";
import type { HeroAnimation } from "./scripts/hero-animation.js";
import type { HudLine } from "./scripts/hud-line.js";
import type { LockHint } from "./scripts/lock-hint.js";
import type { MenuController } from "./scripts/menu-controller.js";
import type { SaveGame } from "./scripts/save-game.js";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A third-person 3D game: a walking, jumping, sprinting character on a `CharacterController`, an
 * orbit camera that will not clip through a wall, an `Animator` state machine on a rigged model, a
 * navmesh-driven companion, pushable crates, a loading screen and a pause menu.
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
 * - `?static=1` loads the same scene, switches every script and the companion's agent off, places
 *   the camera by hand, and stops the clock before the first frame. No fixed step ever runs, so
 *   nothing falls, no clip advances and no path is computed: the frame is exactly what was
 *   authored. It is what the visual golden suite in `tests/visual/` opens.
 * - `?locale=fr` switches `app.i18n` before the menus are built, which is the whole demonstration
 *   that the UI strings live in `assets/strings.i18n.json` and not in this file.
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

/** The tallest agent the navmesh has to clear: the character's capsule height, in metres. */
const AGENT_HEIGHT = 1.5;

/** The camera pose `?static=1` uses, chosen once so the golden frames the whole courtyard. */
const STATIC_EYE = { x: 0, y: 3.6, z: -10.5 } as const;

/** What the `?static=1` camera looks at. */
const STATIC_FOCUS = { x: 0, y: 1, z: -2.5 } as const;

/**
 * The asset type to load each document as.
 *
 * `@ignifx/vite-plugin` types a file by its extension and gets every one of these right, so the
 * overrides are documentation rather than necessity: they say at the call site which loader is
 * meant, and they keep working if the file is ever renamed.
 */
const ACTIONS = { type: INPUT_ACTIONS_ASSET_TYPE } as const;
const BUSES = { type: AUDIO_BUSES_ASSET_TYPE } as const;
const CLIP = { type: AUDIO_ASSET_TYPE } as const;
const STRINGS = { type: I18N_ASSET_TYPE } as const;

/** The sounds, which stay out of the scene file: each one is optional (see `clipOrNull`). */
interface Sounds {
  readonly footstep: AssetHandle<AudioClip>;
  readonly jump: AssetHandle<AudioClip>;
  readonly land: AssetHandle<AudioClip>;
  readonly pickup: AssetHandle<AudioClip>;
  readonly uiClick: AssetHandle<AudioClip>;
  readonly uiHover: AssetHandle<AudioClip>;
  readonly ambient: AssetHandle<AudioClip>;
}

/** The entities of the loaded scene that the code below wires up, found by name. */
interface Level {
  /** The character. */
  readonly player: Entity;
  /** The companion. */
  readonly companion: Entity;
  /** The camera. */
  readonly eye: Entity;
  /** The sun, so the settings screen can turn its shadows off. */
  readonly sun: Light;
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
 * Finds the entities the code below wires up.
 *
 * @param app - The app the scene was loaded in.
 * @returns The character, the companion, the camera and the sun.
 */
function findLevel(app: App): Level {
  const sun = requireEntity(app, "Sun").getComponent(Light);
  if (sun === null) {
    throw new Error(`The Sun in ${MAIN_SCENE} has no Light.`);
  }
  return {
    player: requireEntity(app, "Player"),
    companion: requireEntity(app, "Companion"),
    eye: requireEntity(app, "Main Camera"),
    sun,
  };
}

/**
 * Turns the loaded scene into the still frame the goldens are taken of.
 *
 * @remarks
 * The scene is the game's, controllers and camera rig included, and loading it has already run
 * their `awake` — which reads, but writes nothing. What would move the picture is their per-frame
 * work, so every script and the companion's agent are switched off before the first frame, and the
 * camera is placed at a vantage chosen to frame the whole courtyard.
 *
 * @param app - The app the scene was loaded in.
 * @param level - The scene's entities.
 */
function freezeForGolden(app: App, level: Level): void {
  // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
  // nothing animates and no path is computed: the frame is exactly what was authored. That is
  // stronger than freezing the scene after a frame or two, and it needs no navmesh at all.
  app.time.timeScale = 0;
  for (const script of app.world.components(Script)) {
    script.enabled = false;
  }
  for (const agent of app.world.components(NavMeshAgent)) {
    agent.enabled = false;
  }
  level.eye.transform.position = STATIC_EYE;
  level.eye.transform.lookAt(STATIC_FOCUS);
}

/**
 * Builds the front end and the save file over a level that is already loaded.
 *
 * @param app - The running app.
 * @param sounds - The sounds that decoded, and the ones that did not.
 * @param level - The scene's entities.
 * @param hud - The HUD element, or `null` under an app with no DOM overlay.
 * @param hint - The "click to look" line, or `null` on a device with no pointer to lock.
 * @param isBench - Whether the frame-time harness is driving, in which case the game starts
 *   immediately instead of waiting on a title screen.
 * @returns A promise for the callback that switches the post-process effects on; it has to run
 *   after `app.start()` (see below).
 */
async function installFrontEnd(
  app: App,
  sounds: Sounds,
  level: Level,
  hud: HTMLDivElement | null,
  hint: HTMLDivElement | null,
  isBench: boolean,
): Promise<() => void> {
  // The chain is built once and switched with `enabled`, because `rendering.features.postProcessing`
  // is read when `app.start()` registers the scene and asking for it later is `IGX-0704`. The
  // template pays for the offscreen target either way; the toggle only decides whether the two
  // effects run.
  //
  // The two effects are switched on by the callback this function returns, **after** `app.start()`.
  // Enabling them earlier makes Lite record the first bloom task against a source that is still the
  // swapchain, and the frame is rejected with `sourceTexture has no color texture`: the offscreen
  // target the presenter builds does not exist until the scene is registered. That ordering is
  // also why the stack is added here and not authored in the scene file.
  const post = level.eye.addComponent(PostProcessStack);
  post.bloom.threshold = 0.85;
  post.bloom.weight = 0.35;

  const sun = level.sun;
  const graphics: GraphicsHooks = {
    supportsShadows: true,
    supportsPostProcessing: true,
    setShadows: (enabled: boolean): void => {
      // `rendering.features.shadows` stays on: it is what compiled the shadow pass. What a player
      // turns off is this light's own casting, which is a live flag.
      sun.shadows.enabled = enabled;
    },
    setPostProcessing: (enabled: boolean): void => {
      post.enabled = enabled;
    },
  };

  await loadInputOverrides(app);
  const settings = await loadSettings(app, app.i18n.locale);
  applySettings(app, settings, graphics);

  const host = app.world.createEntity("Game UI");
  const saveGame = host.addComponent(scriptType<SaveGame>(app, "third-person/SaveGame"));
  let menus: GameMenus | null = null;

  const beacons = app.world.components(scriptType<Beacon>(app, "third-person/Beacon"));
  // Where the run restarts: wherever the scene puts the character.
  const here = level.player.transform.position;
  const spawn = { x: here.x, y: here.y, z: here.z };
  const run = createRun(level.player, beacons, spawn, (): void => {
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
      { action: "Jump", labelKey: "action.jump" },
      { action: "Sprint", labelKey: "action.sprint" },
      { action: "Pause", labelKey: "action.pause" },
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
  host.addComponent(scriptType<MenuController>(app, "third-person/MenuController")).menus = menus;

  const line = host.addComponent(scriptType<HudLine>(app, "third-person/HudLine"));
  line.element = hud;
  host.addComponent(scriptType<LockHint>(app, "third-person/LockHint")).element = hint;
  const controller = level.player.requireComponent(ThirdPersonController);
  const companion = level.companion.getComponent(scriptType<Companion>(app, "third-person/Companion"));
  line.render = (): string =>
    app.i18n.t("hud.status", {
      speed: controller.speed.toFixed(1),
      distance: (companion?.distanceToTarget() ?? 0).toFixed(1),
    });

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

  if (!isBench) {
    // The game boots into its title screen. `MenuController` reconciles `app.pause()` against the
    // screen stack every frame, so this one call is what stops the world until "New game". The
    // frame-time harness measures a *running* game, so it skips this and nothing else.
    menus.show("title");
    app.pause();
  }

  return (): void => {
    post.bloom.enabled = true;
    post.smaa.enabled = true;
    post.enabled = settings.postProcessing;
  };
}

async function main(): Promise<AppStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('3d-third-person needs a <canvas id="game"> element on the page.');
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
  // under a kilobyte, so nothing is gained by making the loading screen wait for it.
  const strings = app.assets.load<LocaleAsset>("strings.i18n.json", STRINGS);
  await strings.promise;
  await app.i18n.load(strings);
  const locale = flags.get("locale");
  if (locale !== null && app.i18n.availableLocales.includes(locale)) {
    app.i18n.locale = locale;
  }

  const gameUi = createGameUi(app, {
    loadingLabel: app.i18n.t("loading.label"),
    lockHint: app.i18n.t("hint.lock"),
    touch: !isStatic && !isBench && hasTouch(),
    touchLabels: {
      move: app.i18n.t("action.move"),
      look: app.i18n.t("action.look"),
      jump: app.i18n.t("action.jump"),
      sprint: app.i18n.t("action.sprint"),
      pause: app.i18n.t("action.pause"),
    },
  });
  // The golden is about the rendered scene, not about how this machine draws a system font, and a
  // frame-time run should not be measuring DOM layout either.
  app.ui.visible = showOverlay;

  const sounds: Sounds = {
    footstep: app.assets.load<AudioClip>("footstep.wav", CLIP),
    jump: app.assets.load<AudioClip>("jump.wav", CLIP),
    land: app.assets.load<AudioClip>("land.wav", CLIP),
    pickup: app.assets.load<AudioClip>("pickup.wav", CLIP),
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
  // exist before the scene loads: its controllers resolve their action names in `awake`, which
  // runs while `loadScene` builds them.
  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  // The scene names its primitive meshes by address; they are built in code and published first,
  // because ignifx has no mesh file format (`src/level-meshes.ts`). Then the level itself: the
  // loader fetches every model, material and animator the file names before it builds an entity.
  publishLevelMeshes(app);
  await app.world.loadScene(MAIN_SCENE);
  const level = findLevel(app);
  let enableEffects: (() => void) | null = null;

  if (isStatic) {
    freezeForGolden(app, level);
  } else {
    // A clip is a runtime field rather than a scene field (`src/scripts/hero-animation.ts`).
    level.player.requireComponent(scriptType<HeroAnimation>(app, "third-person/HeroAnimation")).footstep =
      sounds.footstep;
    // Recast is WebAssembly in a chunk of its own; this is the only thing that fetches it, and the
    // loading screen is still up while it does.
    await bakeNavigation(app, AGENT_HEIGHT);
    enableEffects = await installFrontEnd(app, sounds, level, gameUi.hud, gameUi.hint, isBench);
  }

  if (isStatic && showOverlay && gameUi.hud !== null) {
    // `?static=1` leaves the front end out, so nothing writes the HUD. `?hud=1` says the overlay is
    // wanted anyway — the gallery capture asks for exactly that — so the opening state is written
    // once: standing still, with the companion as far away as it starts.
    const player = level.player.transform.position;
    const companion = level.companion.transform.position;
    const distance = Math.hypot(companion.x - player.x, companion.z - player.z);
    gameUi.hud.textContent = app.i18n.t("hud.status", { speed: "0.0", distance: distance.toFixed(1) });
  }

  gameUi.loading.hide();

  // Two test-only hooks, and only under `?probe=1`: `tests/visual/tests/desktop.spec.ts` uses the
  // first for the Phase 9 device-loss exit criterion, and the gameplay half of
  // `tests/visual/tests/templates.spec.ts` uses the second to read the camera and the character as
  // numbers rather than as pixels. See `src/desktop-probe.ts` and `src/gameplay-probe.ts`.
  if (flags.get("probe") === "1") {
    installDesktopProbe(
      app,
      app.world.components(Rigidbody).map((body) => body.entity),
    );
    const rig = level.eye.getComponent(ThirdPersonCamera);
    if (rig !== null && !isStatic) {
      installGameplayProbe(app, level.player, rig);
    }
  }

  if (isBench) {
    installFrameTimeProbe(app);
  }

  await app.start();
  // The post-process chain is switched on only now: its source is the offscreen target the
  // presenter builds while `start()` registers the scene, and a task recorded before that samples
  // the swapchain, which WebGPU rejects.
  enableEffects?.();
  await settle(SETTLE_FRAMES);
  app.log.info("3d-third-person running; draw calls:", app.renderer.drawCalls);
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
