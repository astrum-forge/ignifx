/**
 * The two weather documents and the yard they fall on.
 *
 * @remarks
 * Both are the shipped presets with the numbers this scene wants: a bigger volume, a rate that
 * fills it, and `renderer.lit` set from the panel's toggle. `lit` is a document field rather than a
 * component one because it changes the *generated program* — a lit particle reads
 * `mainLightDirection`, `mainLightColor` and `ambientColor`, and a program that never reads them
 * does not declare them.
 */

import {
  createMaterialAsset,
  MeshAsset,
  MeshRenderer,
  ParticleSystem,
  particleDefinition,
  pbrMaterialDefinition,
} from "ignifx";
import { FollowsTheViewer } from "./volume.ts";
import type { App, AssetHandle, Entity, ParticleAsset, ParticleDefinition } from "ignifx";

/** The overcast near-black the frame is cleared to. */
export const CLEAR_COLOR = { r: 0.035, g: 0.042, b: 0.055, a: 1 } as const;

/** The opening shot: the pose every capture is taken from. */
export const SHOT = {
  fov: 46,
  yaw: 26,
  pitch: 10,
  distance: 11,
  target: { x: 0, y: 2.2, z: 0 },
} as const;

/** How wide the ground is, in metres. */
export const FLOOR_SIZE = 90;

/**
 * How many records each volume holds: the ring size, and therefore the ceiling on how many drops or
 * flakes can be in the air at once.
 */
const CAPACITY = { rain: 1600, snow: 1000 } as const;

/** How high each volume hangs above the ground, in metres, and whether it opens falling. */
export const VOLUME = {
  rain: { height: 12, enabled: true },
  snow: { height: 9, enabled: false },
} as const;

/**
 * How wide each volume is, in metres.
 *
 * @remarks
 * Twenty-two is a compromise the capacity forces: the volume is centred on the **camera** and the
 * camera looks across it, so a narrow volume leaves the far half of the frame dry — but a wide one
 * spreads the same thousand drops over three times the ground and the rain stops reading as rain.
 */
const VOLUME_SIZE = { x: 22, y: 0.2, z: 22 } as const;

/**
 * The rain document.
 *
 * @param lit - Whether the drops are shaded by the scene's main light.
 * @returns The document.
 */
export function rainDefinition(lit: boolean): ParticleDefinition {
  return particleDefinition("rain", {
    // A rate of 900 over a 1.4-second life keeps about 1,260 drops alive, inside the capacity: a
    // system that emits faster than its capacity overwrites live particles, and counts each one in
    // `droppedCount`.
    main: { capacity: CAPACITY.rain },
    emission: { rateOverTime: 900 },
    shape: { kind: "box", size: VOLUME_SIZE },
    start: { lifetime: 1.4, speed: { min: -9, max: -12 }, size: 0.035, color: [0.75, 0.85, 1, 0.75] },
    renderer: { lit, speedScale: 0.06, lengthScale: 1.2 },
  });
}

/**
 * The snow document.
 *
 * @param lit - Whether the flakes are shaded by the scene's main light.
 * @returns The document.
 */
export function snowDefinition(lit: boolean): ParticleDefinition {
  return particleDefinition("snow", {
    // A flake lives up to eight seconds, so sixty a second keeps about 480 of them in the air.
    main: { capacity: CAPACITY.snow },
    emission: { rateOverTime: 60 },
    shape: { kind: "box", size: VOLUME_SIZE },
    start: { lifetime: { min: 5, max: 8 }, speed: { min: -1.2, max: -2.2 }, size: { min: 0.04, max: 0.09 } },
    renderer: { lit },
  });
}

/** Where the yard's posts stand and how tall each one is, in metres. */
const POSTS: readonly { readonly x: number; readonly z: number; readonly height: number }[] = [
  { x: -3.2, z: 1.4, height: 3.4 },
  { x: 2.6, z: -2.2, height: 2.2 },
  { x: 5.4, z: 3.1, height: 4.1 },
  { x: -6.1, z: -4.3, height: 2.8 },
  { x: 0.4, z: 6.2, height: 3.1 },
  { x: -8.4, z: 5.5, height: 2.4 },
];

/**
 * Stands a few posts in the yard, so the weather has something to fall in front of and behind.
 *
 * @param app - The app the entities belong to.
 */
export function createPosts(app: App): void {
  const mesh = MeshAsset.box(app, { size: 1 });
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "weather/post",
      baseColor: { r: 0.21, g: 0.19, b: 0.17, a: 1 },
      metallic: 0,
      roughness: 0.85,
    }),
    [],
  );
  for (const post of POSTS) {
    const entity = app.world.createEntity("Post", { position: { x: post.x, y: post.height / 2, z: post.z } });
    entity.transform.localScale.set(0.34, post.height, 0.34);
    entity.addComponent(MeshRenderer, { mesh: mesh.retain(), materials: [material.retain()], castShadows: true });
  }
}

/** One weather volume: the entity that carries it, and the system that fills it. */
export interface Volume {
  /** The emitter's entity, whose rotation is the wind. */
  readonly entity: Entity;
  /** The system playing the document. */
  readonly system: ParticleSystem;
}

/** What {@link createVolume} takes. */
export interface VolumeOptions {
  /** The entity's name. */
  readonly name: string;
  /** The document it opens with. */
  readonly definition: AssetHandle<ParticleAsset>;
  /** How high it hangs, in metres. */
  readonly height: number;
  /** Whose position it stands over. */
  readonly target: Entity;
  /** The emission seed. */
  readonly seed: number;
  /** Whether it is falling to begin with. */
  readonly enabled: boolean;
}

/**
 * Hangs one weather volume over the viewer.
 *
 * @remarks
 * `playOnAwake` is off and `main.ts` plays it a frame later, because a world-space document bakes
 * the emitter's matrix into every record as it is written — and a `prewarm` on the very first frame
 * would run before the volume has been told where it is.
 *
 * @param app - The app the entity belongs to.
 * @param options - The document, the height, whom to follow, the seed and whether it starts on.
 * @returns The entity and its system.
 */
export function createVolume(app: App, options: VolumeOptions): Volume {
  const entity = app.world.createEntity(options.name, { position: { x: 0, y: options.height, z: 0 } });
  const follow = entity.addComponent(FollowsTheViewer, { height: options.height });
  follow.target = options.target;
  const system = entity.addComponent(ParticleSystem, {
    definition: options.definition,
    seed: options.seed,
    playOnAwake: false,
  });
  system.enabled = options.enabled;
  return { entity, system };
}

/**
 * The toggle handler for one volume: it turns the component off and on, and starts it the first
 * time it is turned on.
 *
 * @param system - The volume's system.
 * @returns What the toggle calls.
 */
export function falls(system: ParticleSystem): (on: boolean) => void {
  return (on: boolean): void => {
    system.enabled = on;
    if (on) {
      start(system);
      return;
    }
    // A disabled system is frozen, not empty: its clock stops and its records stay in the ring.
    // Clearing them is what makes the counter agree with the sky.
    system.stop({ clear: true });
  };
}

/**
 * Starts one volume if it is on and not already falling.
 *
 * @param system - The volume's system.
 */
export function start(system: ParticleSystem): void {
  if (system.enabled && !system.isPlaying) {
    // A looping `prewarm` document fills its whole volume inside this call, so the storm is never
    // seen filling up from an empty sky.
    system.play();
  }
}

/**
 * Puts one document on a volume, and starts the fresh emitter it builds.
 *
 * @param system - The volume's system.
 * @param definition - The document to play.
 */
export function setDocument(system: ParticleSystem, definition: AssetHandle<ParticleAsset>): void {
  if (system.definition === definition) {
    return;
  }
  // A different document is a different effect: the component builds a new emitter for it, and the
  // new one has to be told to play. The drops already in the air are the old emitter's and go with
  // it.
  system.definition = definition;
  if (system.enabled) {
    system.play();
  }
}
