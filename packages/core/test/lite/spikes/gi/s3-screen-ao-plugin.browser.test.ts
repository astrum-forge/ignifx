// Spike S3 (throwaway): a PBR plugin samples a screen-sized texture at the fragment's screen position
// and applies it to indirect light only (Lite's `occlusion` var, which scales IBL irradiance and
// specular occlusion but not direct lights).
import {
  addTask,
  createRenderTask,
  createSurfaceRenderTargetTexture,
  enableMaterialPlugins,
  loadEnvironment,
  registerScene,
} from "@babylonjs/lite";
import type { MaterialPlugin, Texture2D } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createSpikeScene, device, frames, readTexel } from "./harness.js";

function screenAoPlugin(ao: Texture2D): MaterialPlugin {
  return {
    name: "ignifx-spike-screen-ao",
    getSamplers: () => [{ texture: "ignifxAo", sampler: "ignifxAoSampler" }],
    bindTextures: (out) => {
      out.push({ texture: ao });
    },
    getActiveTextures: (out) => {
      out.push(ao);
    },
    getCustomCode: (shaderType) =>
      shaderType === "fragment"
        ? {
            // `input.clipPos` is the fragment's @builtin(position): pixel coordinates.
            CUSTOM_FRAGMENT_BEFORE_LIGHTS:
              "let ignifxAoUv = input.clipPos.xy / vec2<f32>(textureDimensions(ignifxAo)); occlusion *= textureSampleLevel(ignifxAo, ignifxAoSampler, ignifxAoUv, 0.0).r;",
          }
        : null,
  };
}

/** Renders the sphere and returns [left, right] red values; the AO texture is 0 on the left half, 1 on the right. */
async function leftRight(options: { environment: boolean; plugin: boolean; hemi: number }): Promise<[number, number]> {
  const spike = await createSpikeScene(64, options.hemi);
  try {
    const { engine, scene } = spike;
    const ao = createSurfaceRenderTargetTexture(engine, { lbl: "spike:ao", format: "rgba8unorm", samples: 1, size: engine });
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        pixels.fill(x < 32 ? 0 : 255, (y * 64 + x) * 4, (y * 64 + x) * 4 + 4);
      }
    }
    // Stand-in for a GTAO pass writing the target.
    device(engine).queue.writeTexture({ texture: ao.texture.texture }, pixels, { bytesPerRow: 256 }, { width: 64, height: 64 });
    if (options.environment) {
      await loadEnvironment(scene, "/tests/fixtures/assets/studio.env", { brdfUrl: "/tests/fixtures/assets/brdf-lut.png", skipSkybox: true, skipGround: true });
    }
    if (options.plugin) {
      spike.material.plugins = [screenAoPlugin(ao.texture)];
      enableMaterialPlugins(scene);
    }
    const target = createSurfaceRenderTargetTexture(engine, {
      lbl: "spike:colour",
      format: "rgba16float",
      dFormat: "depth24plus-stencil8",
      samples: 1,
      size: engine,
    });
    addTask(scene, createRenderTask({ name: "scene", rt: target.rt }, engine, scene));
    await registerScene(scene);
    await frames(engine, 10);
    const left = await readTexel(engine, target.texture.texture, 22, 32);
    const right = await readTexel(engine, target.texture.texture, 41, 32);
    console.log(`[S3] ${JSON.stringify(options)} left=${JSON.stringify(left)} right=${JSON.stringify(right)}`);
    return [left[0] ?? Number.NaN, right[0] ?? Number.NaN];
  } finally {
    spike.dispose();
  }
}

describe("spike S3: screen-space AO through a PBR plugin, indirect light only", () => {
  it("IBL only, no plugin: both halves match", async () => {
    const [left, right] = await leftRight({ environment: true, plugin: false, hemi: 0 });
    expect(left).toBeGreaterThan(0.05);
    expect(Math.abs(left - right)).toBeLessThan(0.05);
  }, 60_000);

  it("IBL only, with the plugin: the AO=0 half is darker", async () => {
    const [left, right] = await leftRight({ environment: true, plugin: true, hemi: 0 });
    expect(left).toBeLessThan(right * 0.5);
  }, 60_000);

  it("direct (hemispheric) light only, with the plugin: AO leaves direct light alone", async () => {
    const [left, right] = await leftRight({ environment: false, plugin: true, hemi: 1 });
    expect(right).toBeGreaterThan(0.05);
    expect(Math.abs(left - right)).toBeLessThan(0.05);
  }, 60_000);
});
