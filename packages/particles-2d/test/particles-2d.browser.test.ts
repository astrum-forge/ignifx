import { SpriteRenderer, twoD, Camera2D } from "@ignifx/2d";
import { createApp, createAssetManifest } from "@ignifx/core";
import { defineParticles, particles, particleAssetFromDefinition } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import { ParticleSystem2D, particles2D } from "../src/index.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { App, ErrorReport } from "@ignifx/core";

/**
 * A `ParticleSystem2D` on a real WebGPU device.
 *
 * The node suites prove the arithmetic; this proves the pixels — that the sprites the component
 * writes reach the screen through an ordinary Lite sprite layer, and that the layer is the very one
 * a `SpriteRenderer` with the same atlas, blend and sorting layer already draws through.
 *
 * `idle_0`, atlas frame 0, is a flat red 32x32 frame, and a particle with no sheet draws frame 0.
 * The CI adapter is SwiftShader, so the colour assertions carry a per-channel tolerance
 * (coding standards §10).
 */

/** The canvas edge, in device pixels. */
const SIZE = 64;

/** How many frames a change is given to reach the screen before a test reads it. */
const SETTLE_FRAMES = 6;

/** How far a channel may drift on a software rasteriser and still count as the same colour. */
const TOLERANCE = 24;

/** One pixel of a capture, as straight RGBA bytes. */
interface Rgba {
  /** The red channel, `0` to `255`. */
  readonly r: number;
  /** The green channel. */
  readonly g: number;
  /** The blue channel. */
  readonly b: number;
  /** The alpha channel. */
  readonly a: number;
}

/** A running app with a particle system drawing into it. */
interface Scene {
  /** The app. */
  readonly app: App;
  /** The system under test. */
  readonly system: ParticleSystem2D;
  /** Every report `app.onError` emitted. */
  readonly errors: readonly ErrorReport[];
  /** Waits for several animation frames. */
  readonly advance: (frames: number) => Promise<void>;
  /** Captures a frame and reads one pixel of it. */
  readonly pixelAt: (x: number, y: number) => Promise<Rgba>;
  /** Disposes the app and removes the canvas. */
  readonly dispose: () => void;
}

/** Twenty still particles on the origin, each a fifth of the canvas wide. */
function stillEffect(): ReturnType<typeof defineParticles> {
  return defineParticles({
    main: { capacity: 64, duration: 4, looping: true, simulationSpace: "world", seed: 8 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 20 }] },
    shape: { kind: "point" },
    start: { lifetime: 30, speed: 0, size: 24 },
    renderer: { blend: "alpha" },
  });
}

/** Waits for one animation frame. */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * How near a pixel is to a colour, as the largest per-channel difference.
 *
 * @param pixel - The pixel read back.
 * @param r - The expected red channel.
 * @param g - The expected green channel.
 * @param b - The expected blue channel.
 * @returns The largest per-channel difference, in bytes.
 */
function distanceTo(pixel: Rgba, r: number, g: number, b: number): number {
  return Math.max(Math.abs(pixel.r - r), Math.abs(pixel.g - g), Math.abs(pixel.b - b));
}

/**
 * Builds a running 2D app whose camera shows exactly 64 world metres, with one particle system
 * playing on the origin.
 *
 * @param withSprite - Whether to add a `SpriteRenderer` on the same layer.
 * @returns The scene.
 */
async function createScene(withSprite: boolean): Promise<Scene> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.width = `${String(SIZE)}px`;
  canvas.style.height = `${String(SIZE)}px`;
  document.body.append(canvas);

  const errors: ErrorReport[] = [];
  // `pixelsPerUnit: 1` makes one world metre one layer pixel, so every coordinate below can be read
  // straight off the canvas.
  const app = await createApp({
    canvas,
    assets: {
      manifest: createAssetManifest([
        { address: "2d/hero.atlas.json", url: "/tests/fixtures/assets/2d/hero.atlas.json", type: "spriteatlas" },
        { address: "2d/hero.png", url: "/tests/fixtures/assets/2d/hero.png", type: "texture" },
      ]),
    },
    extensions: [twoD({ pixelsPerUnit: 1 }), particles(), particles2D()],
    settings: { rendering: { msaaSamples: 1 } },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  await app.start();
  const advance = (frames: number): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());

  const camera = app.world.createEntity("Camera").addComponent(Camera2D);
  camera.orthographicSize = SIZE / 2;
  const atlas = app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  await advance(SETTLE_FRAMES);
  await atlas.promise;

  if (withSprite) {
    const sprite = app.world.createEntity("sign").addComponent(SpriteRenderer);
    sprite.sprite = atlas.retain();
    // Centred rather than on the frame's own pivot, so the pixel the test reads is inside it.
    sprite.pivotOverride = { x: 0.5, y: 0.5 };
    sprite.entity.transform.position = { x: -22, y: 0, z: 0 };
  }
  const definition = particleAssetFromDefinition(app, stillEffect(), "memory:still.particles.json");
  const system = app.world.createEntity("fx").addComponent(ParticleSystem2D, { definition, atlas: atlas.retain() });
  await advance(SETTLE_FRAMES);

  return {
    app,
    system,
    errors,
    advance,
    pixelAt: async (x: number, y: number): Promise<Rgba> => {
      const frame = await app.renderer.captureScreenshot();
      const offset = (y * frame.width + x) * 4;
      return {
        r: frame.data[offset] ?? 0,
        g: frame.data[offset + 1] ?? 0,
        b: frame.data[offset + 2] ?? 0,
        a: frame.data[offset + 3] ?? 0,
      };
    },
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}

let scene: Scene | null = null;

afterEach(() => {
  scene?.dispose();
  scene = null;
});

describe("a 2D particle system on a device", () => {
  it("draws its particles into its sorting layer", async () => {
    scene = await createScene(false);
    expect(scene.system.aliveCount).toBe(20);
    expect(scene.system.spriteCount).toBe(20);

    const centre = await scene.pixelAt(SIZE >> 1, SIZE >> 1);
    expect(distanceTo(centre, 255, 0, 0)).toBeLessThan(TOLERANCE);
    const corner = await scene.pixelAt(2, 2);
    expect(distanceTo(corner, 255, 0, 0)).toBeGreaterThan(TOLERANCE);
    expect(scene.errors).toEqual([]);
  });

  it("takes them off the screen when the system is stopped and cleared", async () => {
    scene = await createScene(false);
    scene.system.stop({ clear: true });
    await scene.advance(SETTLE_FRAMES);

    const centre = await scene.pixelAt(SIZE >> 1, SIZE >> 1);
    expect(distanceTo(centre, 255, 0, 0)).toBeGreaterThan(TOLERANCE);
    expect(scene.system.spriteCount).toBe(0);
    expect(scene.errors).toEqual([]);
  });

  it("shares one Lite layer with a SpriteRenderer that matches its key", async () => {
    scene = await createScene(true);
    // One layer, holding the sprite and the batch's slots: 1 + the batch's capacity.
    expect(scene.app.twoD.layers).toHaveLength(1);
    expect(scene.app.twoD.layers[0]?.count).toBe(1 + scene.system.capacity);

    const particle = await scene.pixelAt(SIZE >> 1, SIZE >> 1);
    const sprite = await scene.pixelAt((SIZE >> 1) - 22, SIZE >> 1);
    expect(distanceTo(particle, 255, 0, 0)).toBeLessThan(TOLERANCE);
    expect(distanceTo(sprite, 255, 0, 0)).toBeLessThan(TOLERANCE);
    expect(scene.errors).toEqual([]);
  });
});
