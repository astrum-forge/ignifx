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
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener } from "@ignifx/audio";
import { Camera, createApp, isIgnifxError, Model } from "@ignifx/core";
import { input, INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { CharacterController, physics } from "@ignifx/physics";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// A Vite virtual module the plugin serves; the declaration is in src/vite-env.d.ts.
// eslint-disable-next-line import-x/no-unresolved -- see above.
import { manifest } from "virtual:ignifx/manifest";
import { createGameUi, hasTouch } from "./game-ui.js";
import { buildLevel } from "./level.js";
import { Companion } from "./scripts/companion.js";
import { HeroAnimation } from "./scripts/hero-animation.js";
import { HudLine } from "./scripts/hud-line.js";
import { PauseMenu } from "./scripts/pause-menu.js";
import type { Level } from "./level.js";
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
  readonly footstep: AssetHandle<AudioClip>;
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
    sensitivity: 0.12,
    collisionEnabled: true,
    collisionRadius: 0.25,
    // Only scenery shortens the boom. Leaving this empty would let the character's own capsule and
    // the companion pull the camera in whenever one drifted behind it.
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
 * @returns The level, the character, and the companion's script.
 */
function buildWorld(
  app: App,
  assets: Assets,
  isStatic: boolean,
): { readonly level: Level; readonly player: Entity; readonly companion: Companion | null } {
  const level = buildLevel(app, { floor: assets.floor, wall: assets.wall, crate: assets.crate });
  const player = buildPlayer(app, assets, isStatic);
  const companion = buildCompanion(app, assets, player, isStatic);
  buildCamera(app, player, isStatic);
  return { level, player, companion };
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
      extensions: [physics(), input(), audio(), threeD(), ui()],
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

  app.registerComponents([HeroAnimation, Companion, PauseMenu, HudLine]);

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
    pauseTitle: app.i18n.t("menu.paused"),
    pauseButtons: [
      { id: "resume", label: app.i18n.t("menu.resume") },
      { id: "restart", label: app.i18n.t("menu.restart") },
    ],
    touch: !isStatic && hasTouch(),
  });
  // The golden is about the rendered scene, not about how this machine draws a system font.
  app.ui.visible = !isStatic;

  const assets: Assets = {
    player: app.assets.load<ModelAsset>("player.glb", MODEL),
    companion: app.assets.load<ModelAsset>("companion.glb", MODEL),
    stateMachine: app.assets.load<AnimatorAsset>("hero.animator.json", ANIMATOR),
    floor: app.assets.load<MaterialAsset>("floor.material.json", MATERIAL),
    wall: app.assets.load<MaterialAsset>("wall.material.json", MATERIAL),
    crate: app.assets.load<MaterialAsset>("crate.material.json", MATERIAL),
    footstep: app.assets.load<AudioClip>("footstep.wav", CLIP),
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
    actions.promise,
    buses.promise,
  ]);
  // The clip is awaited separately: a browser that refuses to decode the file should cost the game
  // its footsteps, not its first frame.
  await assets.footstep.promise.catch((error: unknown) => {
    app.log.warn("the footstep could not be decoded: {error}", String(error));
  });

  // Installed here rather than through `input.actions` in `ignifx.config.ts`, so that the maps
  // exist before the first `update` runs. See the comment in that file.
  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  const world = buildWorld(app, assets, isStatic);

  if (isStatic) {
    // Stopping the clock *before* `start()` means no fixed step ever runs, so nothing falls,
    // nothing animates and no path is computed: the frame is exactly what was authored. That is
    // stronger than freezing the scene after a frame or two, and it needs no navmesh at all.
    app.time.timeScale = 0;
  } else {
    // Recast is WebAssembly in a chunk of its own; this is the only thing that fetches it, and the
    // loading screen is still up while it does.
    await bakeNavigation(app, world.level);

    const menus = app.world.createEntity("Game UI");
    menus.addComponent(PauseMenu).menu = gameUi.pause;
    const hud = menus.addComponent(HudLine);
    hud.element = gameUi.hud;
    const controller = world.player.requireComponent(ThirdPersonController);
    const companion = world.companion;
    hud.render = (): string =>
      app.i18n.t("hud.status", {
        speed: controller.speed.toFixed(1),
        distance: (companion?.distanceToTarget() ?? 0).toFixed(1),
      });
  }

  gameUi.loading.hide();

  await app.start();
  await settle(SETTLE_FRAMES);
  app.log.info("3d-third-person running: {calls} draw calls", app.renderer.drawCalls);
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
