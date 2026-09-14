import { afterEach, describe, expect, it } from "vitest";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { createStorageBufferAsset } from "../../../src/render/storage-buffer-asset.js";
import { createShaderBrowserApp, SHADER_SETTLE_FRAMES } from "../../fixtures/shaders/browser-harness.js";
import { STORAGE_WGSL, TINT_WGSL } from "../../fixtures/shaders/sources.js";
import type { ShaderBrowserApp } from "../../fixtures/shaders/browser-harness.js";

/**
 * Custom WGSL materials on a real device: a `.wgsl` file's pragmas become a Babylon Lite shader
 * material, the quad it draws reaches the swapchain, `setUniform` changes it on the next frame, the
 * ignifx clock animates it, `app.pause()` freezes it, and a storage buffer moves it.
 *
 * Every assertion is a pixel, because "did the declaration compile into something that draws" is
 * the only question this layer exists to answer. The margins are generous on purpose: CI renders on
 * SwiftShader (coding standards §10). `gpuFrameTimeMs` is not read anywhere — it returns `0` on
 * Apple Metal.
 */

let harness: ShaderBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a scene with one 2x2 quad at the origin wearing a shader material.
 *
 * @param source - The `.wgsl` text.
 * @param values - Uniform overrides.
 * @returns The harness and the material.
 */
async function quadScene(
  source: string,
  values: Readonly<Record<string, number | readonly number[]>> = {},
): Promise<{ readonly app: ShaderBrowserApp; readonly material: ReturnType<ShaderBrowserApp["shaderMaterial"]> }> {
  const running = await createShaderBrowserApp();
  harness = running;
  const material = running.shaderMaterial("shaders/quad.wgsl", source, values);
  const mesh = MeshAsset.plane(running.app, { width: 2, height: 2 });
  const quad = running.world.createEntity("Quad");
  quad.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: false });
  await running.advance(SHADER_SETTLE_FRAMES);
  return { app: running, material };
}

describe("a shader material drawing a quad", () => {
  it("paints the declared tint at the centre of the screen", async () => {
    const scene = await quadScene(TINT_WGSL, { tint: [0, 0, 1] });
    const centre = await scene.app.centrePixel();
    expect(centre.b).toBeGreaterThan(200);
    expect(centre.r).toBeLessThan(40);
    expect(scene.app.errors).toEqual([]);
  });

  it("changes colour on a later frame when setUniform is called", async () => {
    const scene = await quadScene(TINT_WGSL, { tint: [0, 0, 1] });
    scene.material.value.setUniform("tint", { r: 1, g: 0, b: 0, a: 1 });
    await scene.app.advance(4);
    const centre = await scene.app.centrePixel();
    expect(centre.r).toBeGreaterThan(200);
    expect(centre.b).toBeLessThan(40);
  });

  it("animates from the ignifx clock and freezes under app.pause()", async () => {
    const scene = await quadScene(TINT_WGSL, { tint: [0, 0, 1], pulse: 1 });
    const first = await scene.app.centrePixel();
    await scene.app.advance(6);
    const second = await scene.app.centrePixel();
    expect(Math.abs(second.b - first.b)).toBeGreaterThan(4);
    scene.app.app.pause();
    await scene.app.advance(4);
    const paused = await scene.app.centrePixel();
    await scene.app.advance(6);
    const stillPaused = await scene.app.centrePixel();
    expect(stillPaused.b).toBe(paused.b);
  });
});

describe("a storage-buffer-driven shader material", () => {
  it("moves the quad when the buffer is rewritten", async () => {
    const running = await createShaderBrowserApp();
    harness = running;
    const material = running.shaderMaterial("shaders/storage.wgsl", STORAGE_WGSL);
    expect(material.value.isDrawable).toBe(false);
    using offsets = createStorageBufferAsset(running.app, "offsets", Float32Array.from([0, 0, 0, 0]));
    material.value.setStorageBuffer("offsets", offsets);
    expect(material.value.isDrawable).toBe(true);
    const mesh = MeshAsset.plane(running.app, { width: 2, height: 2 });
    const quad = running.world.createEntity("Quad");
    quad.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: false });
    await running.advance(SHADER_SETTLE_FRAMES);
    const centred = await running.centrePixel();
    expect(centred.g).toBeGreaterThan(200);
    offsets.value.update(Float32Array.from([40, 0, 0, 0]));
    await running.advance(6);
    const moved = await running.centrePixel();
    expect(moved.g).toBeLessThan(40);
    expect(running.errors).toEqual([]);
  });
});

describe("warm-up", () => {
  it("accepts a shader material before the scene is registered", async () => {
    const running = await createShaderBrowserApp({ start: false });
    harness = running;
    const material = running.shaderMaterial("shaders/quad.wgsl", TINT_WGSL, { tint: [0, 0, 1] });
    running.app.renderer.warmUp([material.value]);
    await running.start();
    const mesh = MeshAsset.plane(running.app, { width: 2, height: 2 });
    const quad = running.world.createEntity("Quad");
    quad.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: false });
    await running.advance(SHADER_SETTLE_FRAMES);
    const centre = await running.centrePixel();
    expect(centre.b).toBeGreaterThan(200);
    expect(running.errors).toEqual([]);
  });

  it("skips a material whose declared storage buffer is unbound, instead of throwing", async () => {
    const running = await createShaderBrowserApp({ start: false });
    harness = running;
    const material = running.shaderMaterial("shaders/storage.wgsl", STORAGE_WGSL);
    running.app.renderer.warmUp([material.value]);
    await running.start();
    await running.advance(4);
    expect(running.errors).toEqual([]);
  });
});
