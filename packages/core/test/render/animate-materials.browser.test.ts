import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { createMaterialAsset } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { loadShaderSupport } from "../../src/render/shader-support.js";
import { createBrowserApp, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * `app.renderer.animateMaterialsInEditMode` on a real device (ADR-0028, amendment of 2026-10-20):
 * an edit-mode app animates a time-driven shader material by default, and holds it on screen while
 * an editor's toggle is off. `shader-uniforms.test.ts` checks the uniform values headlessly; this
 * checks that what reaches the screen follows them.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A quad whose red channel is the fractional part of four times the shader clock. */
const CLOCK_RED_WGSL = `// @ignifx shader
// @ignifx attributes position
// @ignifx system worldViewProjection, time
// @ignifx cull none

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  return out;
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(fract(shaderUniforms.time * 4.0), 0.0, 0.0, 1.0);
}
`;

/** How many captures each test compares. */
const SAMPLES = 3;

/**
 * Builds an edit-mode app with the clock quad filling the view.
 *
 * @returns The running harness.
 */
async function clockScene(): Promise<BrowserApp> {
  const running = await createBrowserApp({ editMode: true, startEmpty: false });
  harness = running;
  await loadShaderSupport();
  const address = "memory:clock-red.wgsl";
  running.app.assets.register(
    new ShaderAsset(address, CLOCK_RED_WGSL, parseShaderDeclaration(CLOCK_RED_WGSL, address)),
    {
      type: SHADER_ASSET_TYPE,
      address,
    },
  );
  const material = createMaterialAsset(running.app, shaderMaterialDefinition({ shader: address }), []);
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -2);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  const quad = running.world.createEntity("Quad");
  quad.addComponent(MeshRenderer, {
    mesh: MeshAsset.plane(running.app, { width: 20, height: 20 }),
    materials: [material],
  });
  quad.transform.lookAt({ x: 0, y: 0, z: -10 });
  await running.start();
  await running.advance(SETTLE_FRAMES);
  return running;
}

/**
 * Reads the centre pixel's red channel several times, a few frames apart.
 *
 * @param running - The harness.
 * @returns The red values, in capture order.
 */
async function sampleReds(running: BrowserApp): Promise<number[]> {
  const reds: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each capture must follow the previous frames
    await running.advance(SETTLE_FRAMES);
    // oxlint-disable-next-line no-await-in-loop -- one capture at a time
    reds.push((await running.centrePixel()).r);
  }
  return reds;
}

describe("animateMaterialsInEditMode on screen", () => {
  it("animates a time-driven material in an edit-mode app by default", async () => {
    const running = await clockScene();
    expect(running.app.renderer.animateMaterialsInEditMode).toBe(true);
    const reds = await sampleReds(running);
    expect(new Set(reds).size).toBeGreaterThan(1);
  });

  it("holds it while the toggle is off", async () => {
    const running = await clockScene();
    running.app.renderer.animateMaterialsInEditMode = false;
    await running.advance(SETTLE_FRAMES);
    const reds = await sampleReds(running);
    expect(new Set(reds).size).toBe(1);
  });
});
