import {
  Camera,
  CharacterController,
  Environment,
  HeightfieldCollider,
  Light,
  MODEL_ASSET_TYPE,
  Model,
  particleAssetFromDefinition,
  particleDefinition,
  particles,
  ParticleSystem,
  physics,
  Terrain,
  terrain,
  terrainAssetFromDefinition,
  ThirdPersonCamera,
  ThirdPersonController,
  threeD,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, readout, slider, toggle } from "../_kit/panel.ts";
import { DragToLook, PLAYER_ACTIONS } from "./controls.ts";
import { Footsteps } from "./footsteps.ts";
import type { ModelAsset } from "ignifx";

/**
 * A character walking on a terrain, and the one line that makes the ground solid.
 *
 * ## Physics by data, not by dependency
 *
 * `@ignifx/terrain` does not import `@ignifx/physics`: a terrain in a game with no physics costs no
 * physics code. The join is `terrain.colliderInit()`, which answers the exact fields a
 * `HeightfieldCollider` declares — a row-major `heights` array, its sample counts, the size in
 * metres, and the `center` that offsets the shape onto the field. Passing it straight into
 * `addComponent` is the whole integration, and re-reading it inside `onHeightsChanged` is how a
 * sculpted terrain stays solid.
 *
 * ## What the terrain answers without a collider
 *
 * `heightAt` and `slopeAt` read the height field itself, so the readouts below work whether or not
 * physics is running — which is the point of keeping queries out of the collider.
 *
 * ## The dust
 *
 * `footsteps.ts` counts stride length and calls `ParticleSystem.emit()`. Emission runs late in
 * `Update`, after every script, so a burst asked for this frame is uploaded and drawn this frame.
 */

/** The repository's own rigged "box-man". */
const RIG_ADDRESS = "models/rig.glb";

/** Where Havok's WebAssembly is served from; an extension's public asset is copied unhashed. */
const HAVOK_WASM_URL = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

/** The sky the hills stand against. */
const SKY = { r: 0.57, g: 0.7, b: 0.84, a: 1 } as const;

/** The character capsule's height, in metres. The rig is about 1.45 m tall. */
const CAPSULE_HEIGHT = 1.6;

/** Where the character starts, in metres along X and Z; Y comes from the height field. */
const SPAWN = { x: -6, z: -14 } as const;

/**
 * Writes a metre count.
 *
 * @param value - Metres.
 * @returns The text for the value cell.
 */
function metres(value: number): string {
  return `${value.toFixed(1)} m`;
}

bootExample({
  title: "Walk on terrain",
  // `threeD()` requires `physics()` and `input()` before it; the kit registers `input()` first.
  extensions: [physics(), threeD(), terrain(), particles()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
    physics: { havokWasm: HAVOK_WASM_URL },
  },

  async setup({ app, panel, afterStart }) {
    app.registerComponents([DragToLook, Footsteps]);
    app.input.loadActions(PLAYER_ACTIONS);

    const hills = await terrainAssetFromDefinition(app, {
      name: "hills",
      size: { width: 128, depth: 128, height: 13 },
      resolution: 257,
      chunks: { size: 32, lodLevels: 3, lodDistance: 48, skirtDepth: 1 },
      noise: { seed: 21, octaves: 5, frequency: 0.02, persistence: 0.45 },
      layers: [
        { name: "grass", color: [0.33, 0.45, 0.23] },
        { name: "dirt", color: [0.44, 0.36, 0.26] },
        { name: "rock", color: [0.45, 0.44, 0.42] },
      ],
      splatRules: [
        { layer: "grass", slope: [0, 22] },
        { layer: "dirt", slope: [16, 34] },
        { layer: "rock", slope: [30, 90] },
      ],
      material: { roughness: 0.95, metallic: 0 },
    });
    const rig = app.assets.load<ModelAsset>(RIG_ADDRESS, { type: MODEL_ASSET_TYPE });
    await rig.promise;

    // Placed above the ground rather than at the origin: a directional shadow map is fitted around
    // the light's own node, so a sun sitting inside the terrain casts nothing onto it.
    const sun = app.world.createEntity("Sun", { position: { x: -26, y: 40, z: -22 } });
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    const key = sun.addComponent(Light, { type: "directional", intensity: 3, color: { r: 1, g: 0.97, b: 0.91, a: 1 } });
    key.shadows.enabled = true;
    key.shadows.mapSize = 2048;
    key.shadows.maxDistance = 60;
    key.shadows.darkness = 0.32;
    key.shadows.normalBias = 0.02;
    app.world.createEntity("Sky light").addComponent(Light, {
      type: "hemispheric",
      intensity: 0.9,
      color: SKY,
      groundColor: { r: 0.28, g: 0.3, b: 0.22, a: 1 },
    });
    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: SKY });
    sky.imageProcessing.toneMapping = "aces";

    const groundEntity = app.world.createEntity("Hills");
    const ground = groundEntity.addComponent(Terrain, { definition: hills });
    // The whole physics integration: the terrain answers in the shape the collider declares, and
    // an entity with a collider and no `Rigidbody` gets an implicit static body.
    const collider = groundEntity.addComponent(HeightfieldCollider, ground.colliderInit());

    const spawnY = hills.value.field.heightAt(SPAWN.x, SPAWN.z) + CAPSULE_HEIGHT / 2 + 0.02;
    const character = app.world.createEntity("Walker", { position: { x: SPAWN.x, y: spawnY, z: SPAWN.z } });
    character.addComponent(CharacterController, { height: CAPSULE_HEIGHT, radius: 0.32, slopeLimit: 48 });
    const controller = character.addComponent(ThirdPersonController, {
      walkSpeed: 3.4,
      sprintSpeed: 6.6,
      jumpHeight: 1.1,
      stepHeight: 0.35,
      rotateToMovement: true,
    });
    character.addComponent(DragToLook);
    // The model hangs off a child: a `CharacterController`'s capsule is centred on its own entity
    // and the rig's origin is between its feet.
    const body = app.world.createEntity("Walker Body", { parent: character });
    body.transform.localPosition.set(0, -CAPSULE_HEIGHT / 2, 0);
    body.addComponent(Model, { model: rig.retain(), castShadows: true, receiveShadows: true });

    const dustEntity = app.world.createEntity("Footstep dust", { parent: character });
    dustEntity.transform.localPosition.set(0, -CAPSULE_HEIGHT / 2 + 0.05, 0);
    const dust = dustEntity.addComponent(ParticleSystem, {
      definition: particleAssetFromDefinition(app, particleDefinition("dust"), "fx/footstep-dust"),
      playOnAwake: false,
      seed: 5,
    });
    const steps = character.addComponent(Footsteps);
    steps.controller = controller;
    steps.dust = dust;

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 400, fov: 56 });
    eye.transform.localEulerAngles = { x: 16, y: 28, z: 0 };
    const boom = eye.addComponent(ThirdPersonCamera, {
      target: character,
      distance: 5.2,
      shoulderOffset: { x: 0.4, y: 0.6, z: 0 },
      damping: 0.07,
      minPitch: -12,
      maxPitch: 55,
      sensitivity: 0.2,
      // Nothing to sweep against: the terrain's chunks are renderables, not physics bodies, and the
      // only collider in the world is the ground the camera is already above.
      collisionEnabled: false,
    });
    afterStart((): void => {
      boom.snap();
    });

    panel({
      title: "Walk on terrain",
      groups: [
        {
          label: "Character",
          controls: [
            slider(
              "Walk",
              { min: 1, max: 7, step: 0.1, format: (v): string => `${v.toFixed(1)} m/s` },
              bind(controller, "walkSpeed"),
            ),
            slider("Jump", { min: 0.2, max: 2.5, step: 0.05, format: metres }, bind(controller, "jumpHeight")),
            readout("Speed", (): string => `${controller.speed.toFixed(1)} m/s`),
            readout("Grounded", (): string => (controller.isGrounded ? "yes" : "no")),
          ],
        },
        {
          label: "The ground under it",
          controls: [
            readout("Terrain height", (): string =>
              metres(ground.heightAt(character.transform.position.x, character.transform.position.z)),
            ),
            readout(
              "Slope",
              (): string =>
                `${ground.slopeAt(character.transform.position.x, character.transform.position.z).toFixed(0)}°`,
            ),
            readout("Collider samples", (): string => `${String(collider.samplesX)} x ${String(collider.samplesZ)}`),
          ],
        },
        {
          label: "Dust",
          controls: [
            toggle("Footstep dust", bind(steps, "dustEnabled")),
            slider("Stride", { min: 0.6, max: 4, step: 0.1, format: metres }, bind(steps, "strideLength")),
            readout("Particles alive", (): string => String(dust.aliveCount)),
          ],
        },
      ],
    });
  },
});
