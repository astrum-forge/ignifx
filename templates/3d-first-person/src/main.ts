// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { Animator, ANIMATOR_ASSET_TYPE, FirstPersonController, threeD } from "@ignifx/3d";
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener, AudioSource } from "@ignifx/audio";
import {
  Camera,
  createApp,
  createMaterialAsset,
  isIgnifxError,
  MeshAsset,
  MeshRenderer,
  Model,
  pbrMaterialDefinition,
  PostProcessStack,
} from "@ignifx/core";
import { electron } from "@ignifx/electron";
import { input, INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { CharacterController, physics } from "@ignifx/physics";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// Vite virtual modules the plugin serves, typed by `@ignifx/vite-plugin/client`.
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { installFrameTimeProbe } from "./frame-time-probe.js";
import { createGameUi, hasTouch } from "./game-ui.js";
import { installGameplayProbe } from "./gameplay-probe.js";
import { buildLevel } from "./level.js";
import { createGameMenus } from "./menus/game-menus.js";
import { applySettings, loadInputOverrides, loadSettings } from "./menus/settings-store.js";
import { createRun } from "./run.js";
import { AttachToHand } from "./scripts/attach-to-hand.js";
import { HudLine } from "./scripts/hud-line.js";
import { Interactor } from "./scripts/interactor.js";
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
 * A first-person 3D game: a walking, jumping, sprinting, crouching character whose head owns the
 * pitch, pointer lock on a click, a crosshair ray that lights the pedestal it lands on, a view
 * model with a prop attached to the rig's `hand` node, a loading screen and a pause menu.
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
 * - `?static=1` builds the scene **without** the controller and without pointer lock, places the
 *   head by hand, and stops the clock before the first frame. No fixed step ever runs, so nothing
 *   falls and no clip advances: the frame is exactly what was authored. It is what the visual
 *   golden suite in `tests/visual/` opens.
 * - `?locale=fr` switches `app.i18n` before the menus are built.
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

/** The character's capsule height while standing, in metres. */
const STAND_HEIGHT = 1.8;

/** How high the eyes sit above the capsule's centre, in metres. */
const EYE_OFFSET = 0.72;

/** Ground speed while walking, in metres per second. The head bob is derived from it. */
const WALK_SPEED = 4;

/**
 * How far the head rises and falls while walking, in metres.
 *
 * @remarks
 * 0.025 m is a two-and-a-half-centimetre sway at the eye, which reads as weight without reading as
 * a camera shake. The template shipped 0.035 m at the engine's default 1.8 bobs per metre, which at
 * 4 m/s is seven bobs a second — a vibration, not a walk, and the "jumpy" the owner reported.
 */
const HEAD_BOB_AMPLITUDE = 0.025;

/**
 * How many head bobs one metre of travel is worth.
 *
 * @remarks
 * `FirstPersonController` advances the bob phase by distance, not by time, so a sprint bobs faster
 * than a walk for free and a stopped character does not bob at all. Two bobs a second at
 * {@link WALK_SPEED} — a walking cadence, one per footfall — is `2 / WALK_SPEED` bobs per metre.
 */
const HEAD_BOB_FREQUENCY = 2 / WALK_SPEED;

/** Where the character starts, on the ground. */
const PLAYER_SPAWN = { x: 0, y: 0, z: 2.5 } as const;

/** Where the capsule's centre starts: the spawn, lifted by half the standing capsule's height. */
const PLAYER_SPAWN_POSE = { x: PLAYER_SPAWN.x, y: STAND_HEIGHT / 2, z: PLAYER_SPAWN.z } as const;

/** The body's yaw in `?static=1`, in degrees: turned to face the pair of pedestals at `z = -6`. */
const STATIC_YAW = 180;

/** The head's pitch in `?static=1`, in degrees; a little down, so the floor carries the frame. */
const STATIC_PITCH = 7;

/** The asset type to load each document as; see the same table in the third-person template. */
const MODEL = { type: "model" } as const;
const MATERIAL = { type: "material" } as const;
const ANIMATOR = { type: ANIMATOR_ASSET_TYPE } as const;
const ACTIONS = { type: INPUT_ACTIONS_ASSET_TYPE } as const;
const BUSES = { type: AUDIO_BUSES_ASSET_TYPE } as const;
const CLIP = { type: AUDIO_ASSET_TYPE } as const;
const STRINGS = { type: I18N_ASSET_TYPE } as const;

/** Everything the world is built from. */
interface Assets {
  readonly viewmodel: AssetHandle<ModelAsset>;
  readonly stateMachine: AssetHandle<AnimatorAsset>;
  readonly floor: AssetHandle<MaterialAsset>;
  readonly wall: AssetHandle<MaterialAsset>;
  readonly crate: AssetHandle<MaterialAsset>;
  readonly sky: AssetHandle<MaterialAsset>;
  readonly emissive: AssetHandle<MaterialAsset>;
  readonly pickup: AssetHandle<AudioClip>;
  readonly footstep: AssetHandle<AudioClip>;
  readonly jump: AssetHandle<AudioClip>;
  readonly land: AssetHandle<AudioClip>;
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
 * Hangs the view model off the head, and a prop off the view model's `hand` node.
 *
 * @remarks
 * The rig is the same generated "box-man" the third-person template walks around with. In first
 * person you would normally see only arms; this template shows the whole thing, scaled down and
 * pushed forward and to the right of the eye, because that is what makes
 * `Model.attachToNode("hand", …)` visible — the point of the exercise is the bone attachment, and a
 * prop welded to a bone you cannot see demonstrates nothing.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param head - The entity the view model hangs from.
 */
function buildViewModel(app: App, assets: Assets, head: Entity): void {
  const viewmodel = app.world.createEntity("View Model", { parent: head });
  viewmodel.transform.localPosition.set(0.3, -0.84, 0.78);
  viewmodel.transform.localScale.set(0.38, 0.38, 0.38);
  viewmodel.transform.localEulerAngles = { x: 0, y: 150, z: 0 };
  viewmodel.addComponent(Model, { model: assets.viewmodel.retain(), castShadows: false, receiveShadows: false });
  viewmodel.addComponent(Animator, { animator: assets.stateMachine.retain() });

  // A small emissive bar standing in for a tool. It is created as a **root** entity and re-parented
  // by `attachToNode`, which is what puts it under the glTF node rather than under an ignifx entity.
  const prop = app.world.createEntity("Prop");
  prop.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(app, { width: 0.12, height: 0.12, depth: 0.9 }),
    materials: [
      createMaterialAsset(
        app,
        pbrMaterialDefinition({
          name: "prop",
          baseColor: { r: 0.29, g: 0.82, b: 0.94, a: 1 },
          emissive: { r: 0.06, g: 0.24, b: 0.3, a: 1 },
          metallic: 0.6,
          roughness: 0.3,
        }),
        [],
      ),
    ],
    castShadows: false,
    receiveShadows: false,
  });
  viewmodel.addComponent(AttachToHand).prop = prop;
}

/**
 * Builds the character: a capsule, a head that pitches, and the view model hanging off it.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param isStatic - Whether the scene is being built for a golden.
 * @returns The head entity, which is where the camera and the listener are.
 */
function buildPlayer(app: App, assets: Assets, isStatic: boolean): { readonly player: Entity; readonly head: Entity } {
  const player = app.world.createEntity("Player", {
    position: { x: PLAYER_SPAWN.x, y: STAND_HEIGHT / 2, z: PLAYER_SPAWN.z },
  });
  player.layer = app.world.layers.requireIndex("Player");
  player.addComponent(CharacterController, { height: STAND_HEIGHT, radius: 0.35, slopeLimit: 50 });

  // Yaw lives on the body and pitch on this child. Rotating the capsule in pitch would tip the
  // whole collider over, which is why `FirstPersonController` splits them.
  const head = app.world.createEntity("Head", { parent: player });
  head.transform.localPosition.set(0, EYE_OFFSET, 0);
  head.addComponent(Camera, { near: 0.05, far: 200, fov: 68 });
  // The listener rides the head, so a spatial sound is panned from where the player is looking.
  head.addComponent(AudioListener);

  buildViewModel(app, assets, head);

  if (isStatic) {
    // The split the controller would otherwise own: yaw on the body, pitch on the head.
    player.transform.localEulerAngles = { x: 0, y: STATIC_YAW, z: 0 };
    head.transform.localEulerAngles = { x: STATIC_PITCH, y: 0, z: 0 };
    return { player, head };
  }

  player.addComponent(FirstPersonController, {
    cameraPivot: head,
    walkSpeed: WALK_SPEED,
    sprintSpeed: 7,
    crouchSpeed: 1.8,
    standHeight: STAND_HEIGHT,
    crouchHeight: 1.1,
    jumpHeight: 1.1,
    // Degrees per **CSS pixel**, so one figure suits a retina display and a 1080p monitor and does
    // not move when the settings screen changes the render scale: a 180-degree turn is about 1,800
    // pixels of hand, roughly one mouse mat.
    sensitivity: 0.1,
    // Degrees per **second** at full deflection: a stick is a rate, not a displacement.
    stickLookSpeed: 180,
    headBobAmplitude: HEAD_BOB_AMPLITUDE,
    headBobFrequency: HEAD_BOB_FREQUENCY,
    // Every click asks for the pointer while it is not held, and mouse look waits until it is
    // granted; `src/scripts/lock-hint.ts` tells the player about the click and
    // `src/scripts/interactor.ts` stops that click also flipping a pedestal. See the README.
    lockPointerOnClick: true,
  });
  return { player, head };
}

/** What the front end is built over. */
interface World {
  /** The level. */
  readonly level: Level;
  /** The character's body, which carries the `CharacterController`. */
  readonly player: Entity;
  /** The head, which carries the camera and the interaction ray. */
  readonly head: Entity;
  /** The crosshair element, or `null` under an app with no DOM overlay. */
  readonly crosshair: HTMLElement | null;
  /** The "click to look" line, or `null` on a device with no pointer to lock. */
  readonly hint: HTMLElement | null;
}

/**
 * Builds the front end and the save file over a world that is already standing.
 *
 * @param app - The running app.
 * @param assets - The loaded assets.
 * @param world - The level and the character.
 * @param hud - The HUD element, or `null` under an app with no DOM overlay.
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
  isBench: boolean,
): Promise<() => void> {
  // The chain is built once and switched with `enabled`, because `rendering.features.postProcessing`
  // is read when `app.start()` registers the scene and asking for it later is `IGX-0704`.
  // The two effects are switched on by the callback this function returns, **after** `app.start()`.
  // Enabling them earlier makes Lite record the first bloom task against a source that is still the
  // swapchain, and the frame is rejected with `sourceTexture has no color texture`: the offscreen
  // target the presenter builds does not exist until the scene is registered.
  const post = world.head.addComponent(PostProcessStack);
  post.bloom.threshold = 0.8;
  post.bloom.weight = 0.4;

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

  const interactor = world.head.addComponent(Interactor, { eye: world.head, reach: 3.5 });
  interactor.targets = world.level.pedestals;
  if (clipOrNull(assets.pickup) !== null) {
    interactor.clip = assets.pickup;
  }
  interactor.crosshair = world.crosshair;

  await loadInputOverrides(app);
  const settings = await loadSettings(app, app.i18n.locale);
  applySettings(app, settings, graphics);

  const host = app.world.createEntity("Game UI");
  const saveGame = host.addComponent(SaveGame);
  let menus: GameMenus | null = null;

  const run = createRun(world.player, interactor, world.level.pedestals, PLAYER_SPAWN_POSE, (): void => {
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
      { action: "Interact", labelKey: "action.interact" },
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
  host.addComponent(LockHint).element = world.hint;
  line.render = (): string =>
    app.i18n.t("hud.status", {
      lit: interactor.litCount,
      target: interactor.focus === null ? app.i18n.t("hud.nothing") : app.i18n.t("hud.reach"),
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
    throw new Error('3d-first-person needs a <canvas id="game"> element on the page.');
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
      assets: { manifest },
      // `threeD()` requires `physics()` and `input()` to be registered before it, and `ui()` finds
      // `@ignifx/input`'s focus flags structurally at registration time.
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
    viewmodel: app.assets.load<ModelAsset>("viewmodel.glb", MODEL),
    stateMachine: app.assets.load<AnimatorAsset>("hero.animator.json", ANIMATOR),
    floor: app.assets.load<MaterialAsset>("floor.material.json", MATERIAL),
    wall: app.assets.load<MaterialAsset>("wall.material.json", MATERIAL),
    crate: app.assets.load<MaterialAsset>("crate.material.json", MATERIAL),
    sky: app.assets.load<MaterialAsset>("sky.material.json", MATERIAL),
    emissive: app.assets.load<MaterialAsset>("emissive.material.json", MATERIAL),
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
    assets.viewmodel.promise,
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

  const level = buildLevel(app, {
    floor: assets.floor,
    wall: assets.wall,
    crate: assets.crate,
    sky: assets.sky,
    emissive: assets.emissive,
  });
  const character = buildPlayer(app, assets, isStatic);
  let enableEffects: (() => void) | null = null;

  if (isStatic) {
    // No fixed step ever runs, so nothing falls, no clip advances and no ray is cast: the frame is
    // exactly what was authored.
    app.time.timeScale = 0;
  } else {
    enableEffects = await installFrontEnd(
      app,
      assets,
      { level, ...character, crosshair: gameUi.crosshair, hint: gameUi.hint },
      gameUi.hud,
      isBench,
    );
  }

  if (isStatic && showOverlay && gameUi.hud !== null) {
    // `?static=1` leaves the front end out, so nothing writes the HUD. `?hud=1` says the overlay is
    // wanted anyway — the gallery capture asks for exactly that — so the zero state is written once.
    gameUi.hud.textContent = app.i18n.t("hud.status", { lit: 0, target: app.i18n.t("hud.nothing") });
  }

  gameUi.loading.hide();

  // A test-only hook, and only under `?probe=1`: the gameplay half of
  // `tests/visual/tests/templates.spec.ts` reads the view and the character as numbers rather than
  // as pixels. See `src/gameplay-probe.ts`.
  if (flags.get("probe") === "1") {
    const controller = character.player.getComponent(FirstPersonController);
    if (controller !== null) {
      installGameplayProbe(app, character.player, character.head, controller);
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
  app.log.info("3d-first-person running; draw calls:", app.renderer.drawCalls);
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
