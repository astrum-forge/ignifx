import { Vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { particleAssetFromDefinition } from "../../src/assets/loader.js";
import { defineParticles } from "../../src/definition/define-particles.js";
import { PARTICLE_PRESETS, particleDefinition } from "../../src/definition/presets/index.js";
import { createParticleState } from "../../src/evaluate/particle-math.js";
import { ParticleSystem } from "../../src/gpu/particle-system.js";
import {
  brightCentroid,
  createParticlesBrowserApp,
  meanBrightColor,
  SETTLE_FRAMES,
} from "../support/browser-harness.js";
import type { ParticlesBrowserApp } from "../support/browser-harness.js";

/**
 * Every shipped preset on a real device. Capacities are cut to 32 records apiece so SwiftShader
 * draws a few hundred instances rather than a few thousand (the particles ADR's validation note).
 */

/** How many records each preset is given here. */
const BROWSER_CAPACITY = 32;

/** How long SwiftShader is given to compile nine generated programs. */
const COMPILE_TIMEOUT_MS = 120_000;

let harness: ParticlesBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the shipped presets on a WebGPU device", () => {
  it("compile and draw, with no shader failure reported", { timeout: COMPILE_TIMEOUT_MS }, async () => {
    const running = await createParticlesBrowserApp({ options: { maxParticles: 4096 }, cameraDistance: 12 });
    harness = running;
    const systems = PARTICLE_PRESETS.map((name) => {
      const handle = particleAssetFromDefinition(
        running.app,
        particleDefinition(name, { main: { capacity: BROWSER_CAPACITY } }),
        name,
      );
      return running.world.createEntity(name).addComponent(ParticleSystem, { definition: handle });
    });

    await running.advance(SETTLE_FRAMES);

    for (const [index, system] of systems.entries()) {
      const name = PARTICLE_PRESETS[index] ?? "?";
      expect(system.renderer, name).not.toBeNull();
      expect(system.capacity, name).toBe(BROWSER_CAPACITY);
      expect(system.material?.state, name).toBe("loaded");
    }
    expect(systems.some((system) => system.drawCount > 0)).toBe(true);

    const logged = running.log
      .toArray()
      .map((record) => record.message)
      .join("\n");
    expect(logged).not.toContain("IGX-0715");
    expect(logged).not.toContain("IGX-1706");
    expect(running.errors).toEqual([]);
  });
});

describe("the renderer's instance count", () => {
  it("follows the live tail as particles are born and die", async () => {
    const running = await createParticlesBrowserApp({ cameraDistance: 8 });
    harness = running;
    const handle = particleAssetFromDefinition(
      running.app,
      defineParticles({
        main: { capacity: 64, simulationSpace: "world" },
        emission: { rateOverTime: 0 },
        shape: { kind: "point" },
        start: { lifetime: 0.25, speed: 0, size: 0.4 },
        renderer: { blend: "alpha" },
      }),
      "tail",
    );
    const system = running.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    await running.advance(SETTLE_FRAMES);
    expect(system.renderer).not.toBeNull();
    expect(system.renderer?.count).toBe(0);

    system.emit(5);
    await running.advance(3);
    expect(system.drawCount).toBe(5);
    expect(system.renderer?.count).toBe(5);

    system.simulate(1);
    await running.advance(3);
    expect(system.aliveCount).toBe(0);
    expect(system.renderer?.count).toBe(0);
    expect(running.errors).toEqual([]);
  });
});

describe("a drawn particle", () => {
  it("is where the definition's closed form says it is", async () => {
    const running = await createParticlesBrowserApp({ width: 128, height: 128, cameraDistance: 10 });
    harness = running;
    const handle = particleAssetFromDefinition(
      running.app,
      defineParticles({
        main: { capacity: 4, simulationSpace: "world" },
        emission: { rateOverTime: 0 },
        shape: { kind: "point" },
        forces: { gravity: { x: 0, y: -4, z: 0 }, drag: 0.8 },
        start: { lifetime: 10, speed: 3, size: 0.8, color: [1, 1, 1, 1] },
        renderer: { blend: "alpha" },
      }),
      "conformance",
    );
    const system = running.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    await running.advance(SETTLE_FRAMES);
    expect(system.renderer).not.toBeNull();

    // The app is paused before the particle is emitted, so the only thing that moves the system
    // clock is `simulate` and the shader evaluates at exactly the age the test asks about.
    running.app.pause();
    await running.advance(3);
    const spawnClock = system.time;
    system.emit(1);
    await running.advance(3);

    const state = createParticleState();
    const expected = new Vec3();
    for (const target of [0.25, 0.75, 1.5]) {
      system.simulate(spawnClock + target - system.time);
      // oxlint-disable-next-line eslint/no-await-in-loop -- each capture is of the frame this age drew.
      await running.advance(4);
      expect(system.evaluate(0, state), `alive at ${String(target)}s`).toBe(true);
      const position = { x: state.position[0] ?? 0, y: state.position[1] ?? 0, z: state.position[2] ?? 0 };
      expect(running.camera.worldToScreen(position, expected)).toBe(true);

      // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
      const frame = await running.capture();
      const centroid = brightCentroid(frame);
      expect(centroid.count, `drawn at ${String(target)}s`).toBeGreaterThan(8);
      // Three device pixels on a 128-pixel canvas: the centroid of a soft radial sprite under
      // SwiftShader, against a projection computed on the CPU.
      expect(Math.abs(centroid.x - expected.x), `x at ${String(target)}s`).toBeLessThan(3);
      expect(Math.abs(centroid.y - expected.y), `y at ${String(target)}s`).toBeLessThan(3);
    }
    expect(running.errors).toEqual([]);
  });

  it("takes its colour from the gradient at the particle's own age", async () => {
    const running = await createParticlesBrowserApp({ width: 96, height: 96, cameraDistance: 8 });
    harness = running;
    const handle = particleAssetFromDefinition(
      running.app,
      defineParticles({
        main: { capacity: 4, simulationSpace: "world" },
        emission: { rateOverTime: 0 },
        shape: { kind: "point" },
        start: { lifetime: 4, speed: 0, size: 2.5, color: [1, 1, 1, 1] },
        overLifetime: {
          color: {
            gradient: [
              [0, 1, 0, 0, 1],
              [1, 0, 0, 1, 1],
            ],
          },
        },
        renderer: { blend: "alpha" },
      }),
      "gradient",
    );
    const system = running.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    await running.advance(SETTLE_FRAMES);
    running.app.pause();
    await running.advance(3);
    const spawnClock = system.time;
    system.emit(1);
    await running.advance(4);

    const early = meanBrightColor(await running.capture());
    expect(early.r).toBeGreaterThan(early.b + 30);

    system.simulate(spawnClock + 3.9 - system.time);
    await running.advance(4);
    const late = meanBrightColor(await running.capture());
    expect(late.b).toBeGreaterThan(late.r + 30);
    expect(running.errors).toEqual([]);
  });
});
