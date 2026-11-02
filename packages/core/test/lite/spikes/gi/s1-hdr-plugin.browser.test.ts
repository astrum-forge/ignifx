// Spike S1 (throwaway): can a PBR plugin carry the linear colour past Lite's tone map + encode + clamp
// (lib/material/pbr/pbr-template.js line 171) into an rgba16float scene target?
import {
  addTask,
  createRenderTask,
  createSurfaceRenderTargetTexture,
  enableMaterialPlugins,
  registerScene,
} from "@babylonjs/lite";
import type { MaterialPlugin } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createSpikeScene, frames, readTexel } from "./harness.js";

/** Saves `color` before the tone-map block and restores it before the fragment output. */
const LINEAR_OUTPUT_PLUGIN: MaterialPlugin = {
  name: "ignifx-spike-linear-output",
  getCustomCode: (shaderType) =>
    shaderType === "fragment"
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: "var<private> ignifxLinearColor: vec3<f32>;",
          // Lite injects this point at both /*AI*/ and /*NI*/; an assignment (not a `let`) is legal twice
          // and the second one, after indirect light, wins.
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "ignifxLinearColor = color;",
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color = ignifxLinearColor;",
        }
      : null,
};

async function centre(withPlugin: boolean): Promise<number[]> {
  const spike = await createSpikeScene(64, 8);
  try {
    if (withPlugin) {
      spike.material.plugins = [LINEAR_OUTPUT_PLUGIN];
      enableMaterialPlugins(spike.scene);
    }
    const hdr = createSurfaceRenderTargetTexture(spike.engine, {
      lbl: "spike:hdr",
      format: "rgba16float",
      dFormat: "depth24plus-stencil8",
      samples: 1,
      size: spike.engine,
    });
    addTask(spike.scene, createRenderTask({ name: "scene", rt: hdr.rt }, spike.engine, spike.scene));
    await registerScene(spike.scene);
    await frames(spike.engine, 8);
    const texel = await readTexel(spike.engine, hdr.texture.texture, 32, 20);
    console.log(`[S1] plugin=${String(withPlugin)} format=${hdr.texture.texture.format} centre-top texel=${JSON.stringify(texel)}`);
    return texel;
  } finally {
    spike.dispose();
  }
}

describe("spike S1: linear HDR output through a PBR plugin", () => {
  it("without the plugin the rgba16float target holds clamped, encoded colour (<= 1)", async () => {
    const texel = await centre(false);
    expect(texel[0]).toBeLessThanOrEqual(1);
    expect(texel[0]).toBeGreaterThan(0.5);
  }, 60_000);

  it("with the plugin the target holds linear colour above 1", async () => {
    const texel = await centre(true);
    expect(texel[0]).toBeGreaterThan(1.5);
  }, 60_000);
});
