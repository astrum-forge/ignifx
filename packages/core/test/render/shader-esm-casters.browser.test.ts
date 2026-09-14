import { afterEach, describe, expect, it } from "vitest";
import { waitForGpuWork } from "../../src/lite/gpu/render-diagnostics-gpu.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { loadShaderSupport } from "../../src/render/shader-support.js";
import { createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { ShadowTechniqueName } from "../../src/render/light.js";

/**
 * Shader-material meshes and shadow techniques (`docs/adr/0021-custom-shader-authoring.md`,
 * validation): a shader material casts a PCF shadow with no flag, but Babylon Lite 1.27.0 has no
 * ESM view for the shader family and would write the fragment colour into the map, so the render
 * sync system leaves such a mesh out of every ESM generator's caster list and says so once
 * (`IGX-0724`). Measured on 2026-09-08 (spike S0.1.2): a colour fragment gave an orange ESM
 * "shadow", a black one none at all.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 64;

/** An unlit constant-white shader material: the simplest caster a shader material can be. */
const WHITE_WGSL = `// @ignifx shader
// @ignifx attributes position
// @ignifx system worldViewProjection

struct VertexOutput { @builtin(position) position: vec4<f32> }

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

/**
 * Builds a white ground lit from above with a shader-material box floating over it.
 *
 * @param technique - The directional light's shadow technique.
 * @returns The running app and the shader-material caster.
 */
async function buildScene(
  technique: ShadowTechniqueName,
  shaderCaster = true,
  initialCasting = true,
): Promise<{ readonly running: BrowserApp; readonly caster: MeshRenderer }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;
  await loadShaderSupport();

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 5, -6);
  eye.transform.lookAt({ x: 0, y: 0.5, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(0, 10, 0.001);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = true;
  light.shadows.technique = technique;
  light.shadows.mapSize = 512;

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

  const address = "memory:shaders/white.wgsl";
  const shader = running.app.assets.register(
    new ShaderAsset(address, WHITE_WGSL, parseShaderDeclaration(WHITE_WGSL, address)),
    { type: SHADER_ASSET_TYPE, address },
  );
  const caster = createMaterialAsset(running.app, shaderMaterialDefinition({ shader, name: "white" }), []);
  // A second, PBR caster keeps the shadow pass alive whatever the shader box does: with an empty
  // caster list Lite skips the pass and the previous map stays, so a frame would never change.
  const anchor = running.world.createEntity("Anchor");
  anchor.transform.localPosition.set(-2.5, 2, 0);
  anchor.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [white] });

  const blocker = running.world.createEntity("Blocker");
  blocker.transform.localPosition.set(2.5, 2, 0);
  const renderer = blocker.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(running.app, { size: 2 }),
    materials: [shaderCaster ? caster : white],
    castShadows: initialCasting,
  });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  return { running, caster: renderer };
}

/**
 * The mean luminance of the lower-right quarter of the frame: the ground under the shader box.
 *
 * @param running - The running app.
 * @returns The mean, 0 to 255.
 */
async function groundLuminance(running: BrowserApp): Promise<number> {
  const frame = await running.app.renderer.captureScreenshot();
  let total = 0;
  let count = 0;
  const rowBytes = frame.width * 4;
  const firstRow = Math.floor(frame.height / 2);
  const firstColumn = Math.floor(frame.width / 2);
  for (let row = firstRow; row < frame.height; row += 1) {
    for (let column = firstColumn; column < frame.width; column += 1) {
      const index = row * rowBytes + column * 4;
      total += pixelLuminance({
        r: frame.data[index] ?? 0,
        g: frame.data[index + 1] ?? 0,
        b: frame.data[index + 2] ?? 0,
        a: 255,
      });
      count += 1;
    }
  }
  return total / count;
}

/**
 * Stops the loop and drains the queue before disposing, so a shadow pass in flight cannot surface
 * after the device is gone.
 *
 * @param running - The running app.
 */
async function teardown(running: BrowserApp): Promise<void> {
  running.app.stop();
  await waitForGpuWork(running.app.lite.engine);
  running.dispose();
  harness = null;
}

describe("shader-material shadow casters", () => {
  /**
   * Measures the ground with the caster casting, then with `castShadows` off, under one technique.
   *
   * @param technique - The shadow technique.
   * @returns The two luminances and the `IGX-0724` records.
   */
  async function measure(
    technique: ShadowTechniqueName,
    shaderCaster = true,
  ): Promise<{ readonly casting: number; readonly notCasting: number; readonly warnings: number }> {
    const { running, caster } = await buildScene(technique, shaderCaster);
    const casting = await groundLuminance(running);
    caster.castShadows = false;
    await running.advance(SETTLE_FRAMES * 4);
    const notCasting = await groundLuminance(running);
    const warnings = running.log.toArray().filter((record) => record.message.includes("IGX-0724")).length;
    await teardown(running);
    return { casting, notCasting, warnings };
  }

  it("casts a pcf shadow with no flag at all", async () => {
    const pcf = await measure("pcf");
    expect(pcf.casting).toBeLessThan(pcf.notCasting - 2);
    expect(pcf.warnings).toBe(0);
  }, 60_000);

  it("is left out of an esm generator's caster list, and says so once", async () => {
    const esm = await measure("esm");
    // With the mesh excluded, casting and not casting are the same frame.
    expect(Math.abs(esm.casting - esm.notCasting)).toBeLessThan(1);
    expect(esm.warnings).toBe(1);
  }, 60_000);
});
