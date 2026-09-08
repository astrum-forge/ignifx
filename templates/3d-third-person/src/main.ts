// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import {
  Animator,
  ANIMATOR_ASSET_TYPE,
  NavMeshAgent,
  NavMeshSurface,
  ThirdPersonCamera,
  ThirdPersonController,
  threeD,
} from "@ignifx/3d";
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener, AudioSource } from "@ignifx/audio";
import { Camera, createApp, isIgnifxError, Model, PostProcessStack } from "@ignifx/core";
import { electron } from "@ignifx/electron";
import { input, INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { CharacterController, physics } from "@ignifx/physics";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// Vite virtual modules the plugin serves, typed by `@ignifx/vite-plugin/client`.
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { installDesktopProbe } from "./desktop-probe.js";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { installGameplayProbe } from "./gameplay-probe.js";
import { buildLevel } from "./level.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { createRun } from "./run.js";
import { Companion } from "./scripts/companion.js";
import { HeroAnimation } from "./scripts/hero-animation.js";
import { HudLine } from "./scripts/hud-line.js";
import { LockHint } from "./scripts/lock-hint.js";
import { MenuController } from "./scripts/menu-controller.js";
import { SaveGame } from "./scripts/save-game.js";
import type { Level } from "./level.js";
import type { GameMenus } from "./menus/game-menus.js";
import type { GraphicsHooks } from "./menus/settings-store.js";
import type { AnimatorAsset } from "@ignifx/3d";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity, MaterialAsset, ModelAsset } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A third-person 3D game: a walking, jumping, sprinting character on a `CharacterController`, an
 * orbit camera that will not clip through a wall, an `Animator` state machine on a rigged model, a
 * navmesh-driven companion, pushable crates, a loading screen and a pause menu.
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
 * - `?static=1` builds the scene **without** the controllers, the camera rig and the navigating
 *   companion, places the camera by hand, and stops the clock before the first frame. No fixed step
 *   ever runs, so nothing falls, no clip advances and no path is computed: the frame is exactly
 *   what was authored. It is what the visual golden suite in `tests/visual/` opens.
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

/** How many animation frames the scene is given before the image is called settled. */
const SETTLE_FRAMES = 12;

/** The character's capsule height, in metres. The rig is about 1.45 m tall. */
const PLAYER_HEIGHT = 1.5;

/** Where the character starts, on the ground. */
const PLAYER_SPAWN = { x: 0, y: 0, z: -3 } as const;

/** Where the capsule's centre starts: the spawn, lifted by half the capsule's height. */
const PLAYER_SPAWN_POSE = { x: PLAYER_SPAWN.x, y: PLAYER_HEIGHT / 2, z: PLAYER_SPAWN.z } as const;

/** Where the companion starts, on the ground. */
const COMPANION_SPAWN = { x: 5, y: 0, z: 6 } as const;

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
const MODEL = { type: "model" } as const;
const MATERIAL = { type: "material" } as const;
const ANIMATOR = { type: ANIMATOR_ASSET_TYPE } as const;
const ACTIONS = { type: INPUT_ACTIONS_ASSET_TYPE } as const;
const BUSES = { type: AUDIO_BUSES_ASSET_TYPE } as const;
const CLIP = { type: AUDIO_ASSET_TYPE } as const;
const STRINGS = { type: I18N_ASSET_TYPE } as const;

/** Everything the world is built from. */
interface Assets {
  readonly player: AssetHandle<ModelAsset>;
  readonly companion: AssetHandle<ModelAsset>;
  readonly stateMachine: AssetHandle<AnimatorAsset>;
  readonly floor: AssetHandle<MaterialAsset>;
  readonly wall: AssetHandle<MaterialAsset>;
  readonly crate: AssetHandle<MaterialAsset>;
  readonly sky: AssetHandle<MaterialAsset>;
  readonly emissive: AssetHandle<MaterialAsset>;
  readonly footstep: AssetHandle<AudioClip>;
  readonly jump: AssetHandle<AudioClip>;
  readonly land: AssetHandle<AudioClip>;
  readonly pickup: AssetHandle<AudioClip>;
  readonly uiClick: AssetHandle<AudioClip>;
  readonly uiHover: AssetHandle<AudioClip>;
  readonly ambient: AssetHandle<AudioClip>;
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
 * Builds the character: a capsule that walks, a child that carries the model, and the state
 * machine that poses it.
 *
 * @remarks
 * The model hangs off a **child** entity. A `CharacterController`'s capsule is centred on its own
 * entity, and the rig's origin is between its feet, so the two cannot share one transform without
 * the character being buried to the waist.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param isStatic - Whether the scene is being built for a golden.
 * @returns The character's entity.
 */
function buildPlayer(app: App, assets: Assets, isStatic: boolean): Entity {
  const player = app.world.createEntity("Player", {
    position: { x: PLAYER_SPAWN.x, y: PLAYER_HEIGHT / 2, z: PLAYER_SPAWN.z },
  });
  player.layer = app.world.layers.requireIndex("Player");
  player.addComponent(CharacterController, { height: PLAYER_HEIGHT, radius: 0.35, slopeLimit: 50 });

  const body = app.world.createEntity("Player Body", { parent: player });
  body.transform.localPosition.set(0, -PLAYER_HEIGHT / 2, 0);
  body.addComponent(Model, { model: assets.player.retain(), castShadows: true, receiveShadows: true });
  // One `Animator` per **model asset**: `player.glb` and `companion.glb` are two copies of one
  // generated rig for exactly this reason. Babylon Lite binds an animation group to a single
  // manager, so two animators over one asset would fight over one pose.
  body.addComponent(Animator, { animator: assets.stateMachine.retain() });

  if (!isStatic) {
    player.addComponent(ThirdPersonController, {
      walkSpeed: 3.5,
      sprintSpeed: 6.5,
      jumpHeight: 1.1,
      stepHeight: 0.35,
      rotateToMovement: true,
    });
    // The animation script lives on the same entity as the controller it reads, and reaches the
    // `Animator` on the child through the entity tree.
    const animation = player.addComponent(HeroAnimation);
    animation.footstep = assets.footstep;
  }
  return player;
}

/**
 * Builds the companion: a second copy of the rig, a crowd agent, and the follow script.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param player - The entity to follow.
 * @param isStatic - Whether the scene is being built for a golden.
 * @returns The companion's follow script, or `null` in a static scene.
 */
function buildCompanion(app: App, assets: Assets, player: Entity, isStatic: boolean): Companion | null {
  const companion = app.world.createEntity("Companion", { position: COMPANION_SPAWN });
  companion.layer = app.world.layers.requireIndex("Companion");
  companion.addComponent(Model, { model: assets.companion.retain(), castShadows: true, receiveShadows: true });
  companion.addComponent(Animator, { animator: assets.stateMachine.retain() });
  if (isStatic) {
    return null;
  }
  companion.addComponent(NavMeshAgent, { speed: 3.6, acceleration: 12, radius: 0.4, stoppingDistance: 0.4 });
  return companion.addComponent(Companion, { target: player, followDistance: 2.5 });
}

/**
 * Builds the camera: the orbit rig in a running game, a fixed vantage in a golden.
 *
 * @param app - The running app.
 * @param player - The entity the rig orbits.
 * @param isStatic - Whether the scene is being built for a golden.
 * @returns The camera's entity.
 */
function buildCamera(app: App, player: Entity, isStatic: boolean): Entity {
  const eye = app.world.createEntity("Main Camera");
  eye.addComponent(Camera, { near: 0.1, far: 200, fov: 55 });
  // The listener rides the camera, so a spatial sound is panned from where the player is looking.
  eye.addComponent(AudioListener);

  if (isStatic) {
    eye.transform.position = STATIC_EYE;
    eye.transform.lookAt(STATIC_FOCUS);
    return eye;
  }

  // `ThirdPersonCamera.awake` reads the entity's current facing as the starting orbit, so the
  // downward tilt is authored here rather than as a field.
  eye.transform.localEulerAngles = { x: 12, y: 0, z: 0 };
  eye.addComponent(ThirdPersonCamera, {
    target: player,
    distance: 4.5,
    shoulderOffset: { x: 0.4, y: 0.55, z: 0 },
    damping: 0.06,
    minPitch: -20,
    maxPitch: 55,
    // Degrees per **CSS pixel** of mouse motion, so the same figure suits a retina display and a
    // 1080p monitor and does not move when the settings screen changes the render scale. A full
    // 180-degree turn is about 1,800 pixels of hand movement, which is roughly one mouse mat.
    sensitivity: 0.1,
    // Degrees per second at full deflection, not per frame: a stick is a rate. 150 is a little
    // under the engine's 180 default because an orbit camera frames a character rather than aims,
    // and it matches what the old `scale(18)` binding happened to give at 60 fps (18 x 0.12 x 60 =
    // 130 deg/s) without being a hostage to the frame rate the way that arithmetic was.
    stickLookSpeed: 150,
    // The console-style rig: a click on the canvas asks the browser for the pointer, and mouse look
    // waits until it is granted. Without it the camera swung whenever the cursor crossed the frame
    // — on the way to a menu button, or on the way out of the page — and stopped dead the moment
    // the cursor left. Gamepad and touch look are never gated; they have no cursor to lose.
    // `src/scripts/lock-hint.ts` is what tells the player about the click.
    lockPointerOnClick: true,
    // `invertY` is deliberately left at its default: the rig normalises the pitch axis per device,
    // so a mouse pushed forward and a stick pushed up both aim the camera up already.
    collisionEnabled: true,
    collisionRadius: 0.25,
    // Which hit the boom attributes an entity to. The rig always sweeps *past* its own target's
    // capsule — the shoulder pivot sits inside it — and Lite's sweep cannot be filtered by layer, so
    // the companion drifting behind the camera still shortens the boom, as scenery does.
    collisionLayers: ["Level", "Prop"],
  });
  return eye;
}

/**
 * Builds the world.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param isStatic - Whether the scene is being built for a golden.
 * @returns The level, the character, the companion's script and the camera.
 */
function buildWorld(app: App, assets: Assets, isStatic: boolean): World {
  const level = buildLevel(app, {
    floor: assets.floor,
    wall: assets.wall,
    crate: assets.crate,
    sky: assets.sky,
    emissive: assets.emissive,
  });
  const player = buildPlayer(app, assets, isStatic);
  const companion = buildCompanion(app, assets, player, isStatic);
  const eye = buildCamera(app, player, isStatic);
  return { level, player, companion, eye };
}

/**
 * Bakes the navmesh from the level's own geometry.
 *
 * @remarks
 * From `addSource` triangles rather than from the scene's `MeshRenderer`s: the soup is world-space
 * and known before the first frame, so the bake does not depend on anything having been uploaded
 * to the GPU, and it is the same on a machine with no GPU at all. Babylon Lite 1.27.0 has no
 * navmesh serialization, so every bake is a runtime bake (`NavMeshSurface.prebaked` says so and
 * bakes anyway); keeping the source geometry this small is what keeps that cheap.
 *
 * @param app - The running app.
 * @param level - The level whose geometry is baked.
 * @returns A promise that settles once the crowd exists.
 */
async function bakeNavigation(app: App, level: Level): Promise<void> {
  const surface = app.world.createEntity("Navigation").addComponent(NavMeshSurface, {
    bakeOnAwake: false,
    agentRadius: 0.4,
    agentHeight: PLAYER_HEIGHT,
    agentClimb: 0.4,
    cellSize: 0.2,
    cellHeight: 0.2,
    maxAgents: 8,
  });
  surface.addSource(level.navPositions, level.navIndices, null);
  await surface.bake();
}

/** What {@link buildWorld} produced. */
interface World {
  /** The level. */
  readonly level: Level;
  /** The character. */
  readonly player: Entity;
  /** The companion's follow script, or `null` in a static scene. */
  readonly companion: Companion | null;
  /** The camera. */
  readonly eye: Entity;
}

/**
 * Builds the front end and the save file over a world that is already standing.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param world - What {@link buildWorld} produced.
 * @param hud - The HUD element, or `null` under an app with no DOM overlay.
 * @param hint - The "click to look" line, or `null` on a device with no pointer to lock.
 * @param isBench - Whether the frame-time harness is driving, in which case the game starts
 *   immediately instead of waiting on a title screen.
 * @returns A promise for the callback that switches the post-process effects on; it has to run
 *   after `app.start()` (see below).
 */
async function installFrontEnd(
  app: App,
  assets: Assets,
  world: World,
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
  // target the presenter builds does not exist until the scene is registered.
  const post = world.eye.addComponent(PostProcessStack);
  post.bloom.threshold = 0.85;
  post.bloom.weight = 0.35;

  const sun = world.level.sun;
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
  const saveGame = host.addComponent(SaveGame);
  let menus: GameMenus | null = null;

  const run = createRun(world.player, world.level.beacons, PLAYER_SPAWN_POSE, (): void => {
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
  host.addComponent(LockHint).element = hint;
  const controller = world.player.requireComponent(ThirdPersonController);
  const companion = world.companion;
  line.render = (): string =>
    app.i18n.t("hud.status", {
      speed: controller.speed.toFixed(1),
      distance: (companion?.distanceToTarget() ?? 0).toFixed(1),
    });

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

/**
 * Builds and runs the game.
 *
 * @returns The status `window.__ignifxReady` resolves to.
 */
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
      // Order matters twice: `threeD()` requires `physics()` and `input()` to be registered before
      // it, and `ui()` finds `@ignifx/input`'s focus flags structurally at registration time.
      // `electron()` is registered in **both** builds. Without a preload bridge it is inert — one
      // debug line, and an `app.desktop` that answers `isElectron === false` — so the browser build
      // is unchanged and the desktop build needs no second entry point. It goes first because it
      // only requires core, and because `app.storage` should be the file backend before any other
      // extension reads a setting from it.
      extensions: [electron(), physics(), input(), audio(), threeD(), ui()],
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
  });
  // The golden is about the rendered scene, not about how this machine draws a system font, and a
  // frame-time run should not be measuring DOM layout either.
  app.ui.visible = showOverlay;

  const assets: Assets = {
    player: app.assets.load<ModelAsset>("player.glb", MODEL),
    companion: app.assets.load<ModelAsset>("companion.glb", MODEL),
    stateMachine: app.assets.load<AnimatorAsset>("hero.animator.json", ANIMATOR),
    floor: app.assets.load<MaterialAsset>("floor.material.json", MATERIAL),
    wall: app.assets.load<MaterialAsset>("wall.material.json", MATERIAL),
    crate: app.assets.load<MaterialAsset>("crate.material.json", MATERIAL),
    sky: app.assets.load<MaterialAsset>("sky.material.json", MATERIAL),
    emissive: app.assets.load<MaterialAsset>("emissive.material.json", MATERIAL),
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

  await Promise.all([
    assets.player.promise,
    assets.companion.promise,
    assets.stateMachine.promise,
    assets.floor.promise,
    assets.wall.promise,
    assets.crate.promise,
    assets.sky.promise,
    assets.emissive.promise,
    actions.promise,
    buses.promise,
  ]);
  // The clips are awaited together and separately from the rest: a browser that refuses to decode
  // a sound should cost the game its audio, not its first frame.
  await Promise.all(
    [assets.footstep, assets.jump, assets.land, assets.pickup, assets.uiClick, assets.uiHover, assets.ambient].map(
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

  const world = buildWorld(app, assets, isStatic);
  let enableEffects: (() => void) | null = null;

  if (isStatic) {
    // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
    // nothing animates and no path is computed: the frame is exactly what was authored. That is
    // stronger than freezing the scene after a frame or two, and it needs no navmesh at all.
    app.time.timeScale = 0;
  } else {
    // Recast is WebAssembly in a chunk of its own; this is the only thing that fetches it, and the
    // loading screen is still up while it does.
    await bakeNavigation(app, world.level);
    enableEffects = await installFrontEnd(app, assets, world, gameUi.hud, gameUi.hint, isBench);
  }

  if (isStatic && showOverlay && gameUi.hud !== null) {
    // `?static=1` leaves the front end out, so nothing writes the HUD. `?hud=1` says the overlay is
    // wanted anyway — the gallery capture asks for exactly that — so the zero state is written once.
    gameUi.hud.textContent = app.i18n.t("hud.status", { speed: "0.0", distance: "0.0" });
  }

  gameUi.loading.hide();

  // Two test-only hooks, and only under `?probe=1`: `tests/visual/tests/desktop.spec.ts` uses the
  // first for the Phase 9 device-loss exit criterion, and the gameplay half of
  // `tests/visual/tests/templates.spec.ts` uses the second to read the camera and the character as
  // numbers rather than as pixels. See `src/desktop-probe.ts` and `src/gameplay-probe.ts`.
  if (flags.get("probe") === "1") {
    installDesktopProbe(app, world.level.crates);
    const rig = world.eye.getComponent(ThirdPersonCamera);
    if (rig !== null) {
      installGameplayProbe(app, world.player, rig);
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
