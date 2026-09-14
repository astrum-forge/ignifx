import { Camera, createApp, createManualClock, Light } from "@ignifx/core";
import { particleAssetFromDefinition, ParticleSystem, defineParticles, particles } from "@ignifx/particles";
import type { BenchScene } from "./types.ts";

/**
 * One stateless particle system holding 10,000 live particles at 2,000 emitted per second — the
 * plan's §6.3 `particles-10k` row.
 *
 * ## What it is measuring
 *
 * The claim the design makes is that the CPU cost of a frame is the emission logic plus one buffer
 * upload, and nothing per live particle beyond a census walk. Headless there is no device, so the
 * upload never happens and what is left is exactly the CPU half: `emit` writing 33 records a frame
 * into the ring, and `reconcile` walking the live tail. Neither may scale with the 10,000 particles
 * behind them in a way that shows up as allocation.
 *
 * The lifetime and the rate are chosen so the ring is exactly full and steady: 2,000 per second for
 * five seconds is 10,000 records, and `prewarm` fills it before the first measured frame.
 */

/** How many particles the scene keeps alive. The name of the scene is the contract. */
export const PARTICLE_COUNT = 10_000;

/** How many particles are emitted per second. */
const RATE = 2000;

/** How long a particle lives; `RATE * LIFETIME` is {@link PARTICLE_COUNT}. */
const LIFETIME = PARTICLE_COUNT / RATE;

/**
 * A headless scene with one particle system at its steady state.
 *
 * @returns The running scene.
 */
export async function createParticles10kScene(): Promise<BenchScene> {
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logLevel: "silent",
    extensions: [particles({ maxParticles: PARTICLE_COUNT })],
  });

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 4, -14);
  eye.transform.lookAt({ x: 0, y: 2, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 200, fov: 60 });

  const sun = app.world.createEntity("Sun");
  sun.transform.lookAt({ x: -0.4, y: -1, z: 0.5 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  const definition = particleAssetFromDefinition(
    app,
    defineParticles({
      main: { capacity: PARTICLE_COUNT, duration: LIFETIME, looping: true, prewarm: true, seed: 1 },
      emission: { rateOverTime: RATE },
      shape: { kind: "cone", radius: 0.5, angle: 20 },
      forces: { gravityMultiplier: -0.2, drag: 0.4 },
      start: { lifetime: LIFETIME, speed: { min: 1, max: 3 }, size: { min: 0.1, max: 0.3 } },
      overLifetime: {
        color: {
          gradient: [
            [0, 1, 1, 1, 0],
            [0.1, 1, 0.8, 0.4, 1],
            [1, 1, 0.3, 0.1, 0],
          ],
        },
        size: {
          curve: {
            keys: [
              [0, 0.4, 0, 1],
              [1, 1, 1, 0],
            ],
          },
        },
      },
      renderer: { mode: "billboard", blend: "additive" },
    }),
    "bench/particles-10k",
  );

  const emitter = app.world.createEntity("Effect");
  emitter.addComponent(ParticleSystem, { definition, seed: 1 });

  await app.start();
  return {
    name: "particles-10k",
    app,
    dispose: () => {
      app.dispose();
    },
  };
}
