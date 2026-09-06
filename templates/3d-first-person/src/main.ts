// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { Animator, ANIMATOR_ASSET_TYPE, FirstPersonController, threeD } from "@ignifx/3d";
import { audio, AUDIO_ASSET_TYPE, AUDIO_BUSES_ASSET_TYPE, AudioListener } from "@ignifx/audio";
import {
  Camera,
  createApp,
  createMaterialAsset,
  isIgnifxError,
  MeshAsset,
  MeshRenderer,
  Model,
  pbrMaterialDefinition,
} from "@ignifx/core";
import { electron } from "@ignifx/electron";
import { input, INPUT_ACTIONS_ASSET_TYPE } from "@ignifx/input";
import { CharacterController, physics } from "@ignifx/physics";
import { I18N_ASSET_TYPE, ui } from "@ignifx/ui";
// A Vite virtual module the plugin serves; the declaration is in src/vite-env.d.ts.
// eslint-disable-next-line import-x/no-unresolved -- see above.
import { manifest } from "virtual:ignifx/manifest";
import { createGameUi, hasTouch } from "./game-ui.js";
import { buildLevel } from "./level.js";
import { AttachToHand } from "./scripts/attach-to-hand.js";
import { HudLine } from "./scripts/hud-line.js";
import { Interactor } from "./scripts/interactor.js";
import { PauseMenu } from "./scripts/pause-menu.js";
import type { AnimatorAsset } from "@ignifx/3d";
import type { AudioBusesAsset, AudioClip } from "@ignifx/audio";
import type { App, AssetHandle, Entity, MaterialAsset, ModelAsset } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";
import type { LocaleAsset } from "@ignifx/ui";

/**
 * A first-person 3D game: a walking, jumping, sprinting, crouching character whose head owns the
 * pitch, pointer lock on the first click, a crosshair ray that lights the pedestal it lands on, a
 * view model with a prop attached to the rig's `hand` node, a loading screen and a pause menu.
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

/** Where the character starts, on the ground. */
const PLAYER_SPAWN = { x: 0, y: 0, z: 2.5 } as const;

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
  readonly blip: AssetHandle<AudioClip>;
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
function buildPlayer(app: App, assets: Assets, isStatic: boolean): Entity {
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
    return head;
  }

  player.addComponent(FirstPersonController, {
    cameraPivot: head,
    walkSpeed: 4,
    sprintSpeed: 7,
    crouchSpeed: 1.8,
    standHeight: STAND_HEIGHT,
    crouchHeight: 1.1,
    jumpHeight: 1.1,
    sensitivity: 0.12,
    headBobAmplitude: 0.035,
    // The first click on the canvas asks the browser for pointer lock; `<Mouse>/delta` keeps
    // reporting while it holds, and `Escape` gives it back (which is also what opens the menu).
    lockPointerOnClick: true,
  });
  return head;
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

  app.registerComponents([Interactor, AttachToHand, PauseMenu, HudLine]);

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
    viewmodel: app.assets.load<ModelAsset>("viewmodel.glb", MODEL),
    stateMachine: app.assets.load<AnimatorAsset>("hero.animator.json", ANIMATOR),
    floor: app.assets.load<MaterialAsset>("floor.material.json", MATERIAL),
    wall: app.assets.load<MaterialAsset>("wall.material.json", MATERIAL),
    crate: app.assets.load<MaterialAsset>("crate.material.json", MATERIAL),
    blip: app.assets.load<AudioClip>("blip.wav", CLIP),
  };
  const actions = app.assets.load<InputActionsAsset>("game.input.json", ACTIONS);
  const buses = app.assets.load<AudioBusesAsset>("game.audio.json", BUSES);

  await Promise.all([
    assets.viewmodel.promise,
    assets.stateMachine.promise,
    assets.floor.promise,
    assets.wall.promise,
    assets.crate.promise,
    actions.promise,
    buses.promise,
  ]);
  // The clip is awaited separately: a browser that refuses to decode the file should cost the game
  // its blip, not its first frame.
  await assets.blip.promise.catch((error: unknown) => {
    app.log.warn("the blip could not be decoded: {error}", String(error));
  });

  app.input.loadActions(actions.value);
  await app.audio.buildBuses(buses.value.buses);

  const level = buildLevel(app, { floor: assets.floor, wall: assets.wall, crate: assets.crate });
  const head = buildPlayer(app, assets, isStatic);

  if (isStatic) {
    // No fixed step ever runs, so nothing falls, no clip advances and no ray is cast: the frame is
    // exactly what was authored.
    app.time.timeScale = 0;
  } else {
    const menus = app.world.createEntity("Game UI");
    menus.addComponent(PauseMenu).menu = gameUi.pause;
    const interactor = head.addComponent(Interactor, { eye: head, reach: 3.5 });
    interactor.targets = level.pedestals;
    interactor.clip = assets.blip;
    interactor.crosshair = gameUi.crosshair;

    const hud = menus.addComponent(HudLine);
    hud.element = gameUi.hud;
    hud.render = (): string =>
      app.i18n.t("hud.status", {
        lit: interactor.litCount,
        target: interactor.focus === null ? app.i18n.t("hud.nothing") : app.i18n.t("hud.reach"),
      });
  }

  gameUi.loading.hide();

  await app.start();
  await settle(SETTLE_FRAMES);
  app.log.info("3d-first-person running: {calls} draw calls", app.renderer.drawCalls);
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
