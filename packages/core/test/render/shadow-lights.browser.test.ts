import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * Two shadow-casting lights, one switched off and on again (`docs/architecture/07-rendering.md`
 * §2.2).
 *
 * Each receiver's shadow bind group holds one map per casting light, and its layout is fixed when
 * the renderable is built. Re-attaching one light's generator while the other kept its map used to
 * leave a bind group built for a different number of maps than its layout, and WebGPU rejected
 * every frame from then on.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 64;

/** The scene the tests drive. */
interface TwoLightScene {
  /** The running app. */
  readonly running: BrowserApp;
  /** The light that casts the shadow to the right of the box. */
  readonly left: Light;
  /** The light that casts the shadow to the left of the box. */
  readonly right: Light;
}

/**
 * Builds a white ground with a box standing on it, lit by two tilted directional lights that both
 * cast, so the box throws one shadow to each side.
 *
 * @returns The scene.
 */
async function buildTwoLightScene(): Promise<TwoLightScene> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 9, -0.01);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const addLight = (name: string, x: number): Light => {
    const entity = running.world.createEntity(name);
    entity.transform.localPosition.set(x, 8, 0.001);
    entity.transform.lookAt({ x: 0, y: 0, z: 0 });
    return entity.addComponent(Light, {
      type: "directional",
      intensity: 1.5,
      shadows: { enabled: true, mapSize: 512 },
    });
  };
  const left = addLight("Left", -6);
  const right = addLight("Right", 6);

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 }),
    materials: [white],
    castShadows: false,
  });
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 1.5, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1 }), materials: [white] });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  return { running, left, right };
}

/**
 * The mean luminance of the frame's left and right thirds, where the two shadows fall.
 *
 * @param running - The running app.
 * @returns Both means, 0 to 255.
 */
async function sideLuminance(running: BrowserApp): Promise<{ readonly left: number; readonly right: number }> {
  const frame = await running.app.renderer.captureScreenshot();
  let left = 0;
  let right = 0;
  let count = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width / 3; x += 1) {
      const at = (offset: number): number => {
        const index = (y * frame.width + offset) * 4;
        return pixelLuminance({
          r: frame.data[index] ?? 0,
          g: frame.data[index + 1] ?? 0,
          b: frame.data[index + 2] ?? 0,
          a: 255,
        });
      };
      left += at(x);
      right += at(frame.width - 1 - x);
      count += 1;
    }
  }
  return { left: left / count, right: right / count };
}

describe("two shadow-casting lights", () => {
  for (const toggle of ["shadows.enabled", "Light.enabled"] as const) {
    it(`keeps presenting, with both shadows, after one light's ${toggle} goes off and on`, async () => {
      const device = gpuDeviceErrors();
      const scene = await buildTwoLightScene();
      device.stop();
      const before = await sideLuminance(scene.running);

      const set = (value: boolean): void => {
        if (toggle === "shadows.enabled") {
          scene.left.shadows.enabled = value;
        } else {
          scene.left.enabled = value;
        }
      };
      set(false);
      await scene.running.advance(SETTLE_FRAMES * 2);
      expect(device.errors).toEqual([]);
      set(true);
      await scene.running.advance(SETTLE_FRAMES * 4);

      expect(device.errors).toEqual([]);
      expect(scene.running.errors).toEqual([]);
      expect(scene.left.isCastingShadows).toBe(true);
      expect(scene.right.isCastingShadows).toBe(true);
      // The frame is the frame both lights rendered before the toggle: both shadows are back.
      const after = await sideLuminance(scene.running);
      expect(Math.abs(after.left - before.left)).toBeLessThan(3);
      expect(Math.abs(after.right - before.right)).toBeLessThan(3);
    });
  }
});
