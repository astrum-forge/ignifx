/**
 * The frame the five effects are applied to, and the table that drives the panel.
 *
 * @remarks
 * The subject is the same ship the `pbr-model` example is composed around, lit by the same
 * prefiltered studio probe: a post-process chain is only interesting over a frame that already has
 * highlights, shadow and colour in it, and this is the repository's own frame that does.
 */

import { Camera, Environment, MODEL_ASSET_TYPE, Model } from "ignifx";
import { attachOrbit } from "../_kit/orbit.ts";
import { createBackdrop, createStudioRig, loadEnvironment } from "../_kit/stage.ts";
import type { App, ColorLike, Entity, ModelAsset } from "ignifx";

/** The near-black the frame is cleared to. */
export const CLEAR_COLOR: ColorLike = { r: 0.008, g: 0.01, b: 0.016, a: 1 };

/** The opening shot. */
export const SHOT = {
  fov: 34,
  yaw: 18,
  pitch: 9,
  distance: 1.55,
  target: { x: 0, y: 0.68, z: 0 },
  exposure: 1.5,
  blur: 0.22,
  pose: { x: -12, y: 18, z: 7 },
  height: 0.7,
} as const;

/** One custom effect on the panel: its file, its order, and the slider it gets. */
export interface EffectRow {
  /** The label on the toggle and the panel group. */
  readonly label: string;
  /** The `.post.wgsl` address, under `website/examples/assets/`. */
  readonly address: string;
  /** Where it sits in the chain; lower runs first, alongside bloom's and SMAA's own `order`. */
  readonly order: number;
  /** Whether it is on when the example opens. */
  readonly enabled: boolean;
  /** The uniform the slider writes, and its bounds. */
  readonly control: {
    /** The visible label. */
    readonly label: string;
    /** The uniform's name, as the file declares it. */
    readonly name: string;
    /** The lowest value. */
    readonly min: number;
    /** The highest value. */
    readonly max: number;
    /** The increment. */
    readonly step: number;
    /** The value the effect opens on. */
    readonly value: number;
  };
}

/**
 * The five effects, in chain order.
 *
 * @remarks
 * The grade runs first, on a frame nothing has textured yet; the two screen effects run after it, so
 * the scan lines and the speckle are not themselves graded. Swapping the middle two is what the
 * panel's Order select does, and the difference is visible: blocks cut by scan lines, or scan lines
 * running over blocks.
 */
export const EFFECTS: readonly EffectRow[] = [
  {
    label: "Colour LUT",
    address: "shaders/custom-post-process/lut.post.wgsl",
    order: 10,
    enabled: true,
    control: { label: "Amount", name: "amount", min: 0, max: 1, step: 0.05, value: 1 },
  },
  {
    label: "Pixelate",
    address: "shaders/custom-post-process/pixelate.post.wgsl",
    order: 20,
    enabled: false,
    control: { label: "Block size", name: "blockSize", min: 1, max: 32, step: 1, value: 6 },
  },
  {
    label: "CRT",
    address: "shaders/custom-post-process/crt.post.wgsl",
    order: 30,
    enabled: true,
    control: { label: "Scan lines", name: "scanline", min: 0, max: 1, step: 0.05, value: 0.25 },
  },
  {
    label: "Film grain",
    address: "shaders/custom-post-process/grain.post.wgsl",
    order: 40,
    // The one effect that is off in the opening frame, and for a reason worth stating: per-pixel
    // noise is incompressible, so a grained poster cannot be squeezed under the site's 120 KB
    // budget, and a grained golden would need a tolerance wide enough to hide a real regression.
    enabled: false,
    control: { label: "Amount", name: "amount", min: 0, max: 0.4, step: 0.005, value: 0.05 },
  },
  {
    label: "Vignette",
    address: "shaders/custom-post-process/vignette.post.wgsl",
    order: 50,
    enabled: true,
    control: { label: "Amount", name: "amount", min: 0, max: 1.5, step: 0.05, value: 0.55 },
  },
];

/** Which two effects the Order select swaps, by their labels. */
export const SWAPPABLE = ["Pixelate", "CRT"] as const;

/**
 * Builds the lit frame: the rig, the floor, the backdrop, the probe and the ship.
 *
 * @param app - The app the entities and the assets belong to.
 * @returns The camera entity, so the caller can hang a `PostProcessStack` on it.
 */
export async function createShot(app: App): Promise<Entity> {
  const eye = app.world.createEntity("Main Camera");
  eye.addComponent(Camera, { near: 0.02, far: 400, fov: SHOT.fov });
  attachOrbit(app, eye, {
    yaw: SHOT.yaw,
    pitch: SHOT.pitch,
    distance: SHOT.distance,
    target: SHOT.target,
    minDistance: 0.8,
    maxDistance: 6,
  });

  // No floor: the two screen effects want an uninterrupted frame, and a floor edge running
  // across it would read as an artefact of the chain rather than as a horizon.
  createStudioRig(app, { focus: SHOT.target, keyIntensity: 3.4, rimIntensity: 2.4, shadows: false });
  await createBackdrop(app, { diameter: 20 });

  const ship = app.assets.load<ModelAsset>("models/ignifx-ship.glb", { type: MODEL_ASSET_TYPE });
  const environment = loadEnvironment(app, "studio");
  await Promise.all([ship.promise, environment.promise]);

  const sky = app.world.createEntity("Environment").addComponent(Environment, { environment, clearColor: CLEAR_COLOR });
  sky.imageProcessing.toneMapping = "aces";
  sky.imageProcessing.exposure = SHOT.exposure;
  sky.blur = SHOT.blur;

  const subject = app.world.createEntity("Ship");
  subject.transform.localPosition.set(0, SHOT.height, 0);
  subject.transform.localEulerAngles = SHOT.pose;
  subject.addComponent(Model, { model: ship, castShadows: false, receiveShadows: false });
  return eye;
}
