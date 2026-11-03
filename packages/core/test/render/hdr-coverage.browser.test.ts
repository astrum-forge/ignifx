import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { loadPostEffectSupport } from "../../src/render/post-effect-support.js";
import { customEffect } from "../../src/render/post-effect.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { loadShaderSupport } from "../../src/render/shader-support.js";
import { createBrowserApp, fixtureUrl, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `rendering.hdr` for every colour writer besides plain PBR
 * (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G3): fog after the restore, Standard and
 * unlit materials, custom `.wgsl` materials, the environment skybox, and custom post effects that
 * run on linear colour ahead of the output pass. Each scene is rendered with HDR off and on; with
 * Lite's default image processing (no curve, exposure 1, contrast 1) the two must present the same
 * bytes, which is what a writer encoded twice would break.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

/** How far a channel may drift between the two paths: half-float rounding and SwiftShader. */
const TOLERANCE = 3;

/** A custom material that writes one mid-tone colour, as a particle or foliage shader would. */
const FLAT_WGSL = `// @ignifx shader
// @ignifx attributes position
// @ignifx system worldViewProjection
// @ignifx cull none

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(0.5, 0.35, 0.2, 1.0);
}
`;

/** A post effect that is white where its input is above 1 and black elsewhere. */
const ABOVE_ONE_POST_WGSL = `// @ignifx post

fn mainFragment(in: PostInput) -> vec4<f32> {
  let source = textureSample(inputTexture, inputTextureSampler, in.uv);
  return vec4<f32>(select(vec3<f32>(0.0), vec3<f32>(1.0), source.rgb > vec3<f32>(1.0)), 1.0);
}
`;

/** What one scene draws in front of the camera. */
type Subject = "pbr" | "standard" | "unlit" | "custom" | "sky";

/** How {@link render} builds a scene. */
interface SceneOptions {
  /** Whether `rendering.hdr` is on. */
  readonly hdr: boolean;
  /** What fills the centre of the frame. */
  readonly subject: Subject;
  /** `"partial"` for exp2 fog, `"full"` for linear fog that hides the box completely. */
  readonly fog?: "partial" | "full";
  /** The hemispheric light's intensity. */
  readonly intensity?: number;
  /** A custom post effect, pushed onto a `PostProcessStack`. */
  readonly post?: string;
}

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds and runs one scene.
 *
 * @param options - The scene.
 * @returns The running app.
 */
async function render(options: SceneOptions): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [
      { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
      { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
    ],
    settings: {
      rendering: {
        hdr: options.hdr,
        msaaSamples: 1,
        brdfLut: "environments/brdf-lut.png",
        features: { postProcessing: options.post !== undefined },
      },
    },
  });
  harness = running;
  await Promise.all([loadShaderSupport(), loadPostEffectSupport()]);
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0.2, g: 0.3, b: 0.4, a: 1 } });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: options.intensity ?? 0.6 });

  const environment = running.world.createEntity("Environment").addComponent(Environment, {});
  if (options.subject === "sky") {
    environment.environment = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
  }
  // `loadEnvironment` turns on its own curve, exposure and contrast; the comparison wants the identity.
  environment.imageProcessing.toneMapping = "none";
  environment.imageProcessing.exposure = 1;
  environment.imageProcessing.contrast = 1;
  if (options.fog === "partial") {
    environment.fog.mode = "exp2";
    environment.fog.density = 0.12;
    environment.fog.color = { r: 0.7, g: 0.6, b: 0.5, a: 1 };
  } else if (options.fog === "full") {
    environment.fog.mode = "linear";
    environment.fog.start = 0.5;
    environment.fog.end = 1;
    environment.fog.color = { r: 0.7, g: 0.6, b: 0.5, a: 1 };
  }

  if (options.subject !== "sky") {
    running.world.createEntity("Subject").addComponent(MeshRenderer, {
      mesh: MeshAsset.box(running.app, { size: 3 }),
      materials: [subject(running, options.subject)],
    });
  }
  if (options.post !== undefined) {
    const address = "shaders/test.post.wgsl";
    const shader = running.app.assets.register(
      new ShaderAsset(address, options.post, parseShaderDeclaration(options.post, address)),
      { type: SHADER_ASSET_TYPE, address },
    );
    eye.addComponent(PostProcessStack).custom.push(customEffect({ shader }));
  }
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  expect(running.errors).toEqual([]);
  return running;
}

/**
 * The material for a subject.
 *
 * @param running - The app.
 * @param kind - The subject; never `"sky"`.
 * @returns The material handle.
 */
function subject(running: BrowserApp, kind: Exclude<Subject, "sky">): ReturnType<typeof createMaterialAsset> {
  const mid = { r: 0.6, g: 0.45, b: 0.3, a: 1 };
  switch (kind) {
    case "pbr":
      return createMaterialAsset(running.app, pbrMaterialDefinition({ baseColor: mid, metallic: 0, roughness: 1 }), []);
    case "unlit":
      return createMaterialAsset(running.app, pbrMaterialDefinition({ baseColor: mid, unlit: true }), []);
    case "standard":
      return createMaterialAsset(running.app, standardMaterialDefinition({ diffuse: mid, specularPower: 1 }), []);
    case "custom": {
      const address = "shaders/flat.wgsl";
      running.app.assets.register(new ShaderAsset(address, FLAT_WGSL, parseShaderDeclaration(FLAT_WGSL, address)), {
        type: SHADER_ASSET_TYPE,
        address,
      });
      return createMaterialAsset(running.app, shaderMaterialDefinition({ shader: address }), []);
    }
    default:
      throw new Error("unreachable");
  }
}

/**
 * Renders a scene with HDR off, then on, and reads the centre pixel of each.
 *
 * @param options - The scene, without `hdr`.
 * @returns Both pixels.
 */
async function both(options: Omit<SceneOptions, "hdr">): Promise<{ plain: PixelRgba; hdr: PixelRgba }> {
  const plain = await (await render({ ...options, hdr: false })).centrePixel();
  harness?.dispose();
  harness = null;
  const hdr = await (await render({ ...options, hdr: true })).centrePixel();
  return { plain, hdr };
}

/**
 * Asserts two pixels match within {@link TOLERANCE}, and that the plain one is a mid-tone.
 *
 * @param pixels - The pixels.
 * @param pixels.plain - With HDR off.
 * @param pixels.hdr - With HDR on.
 */
function expectSame(pixels: { plain: PixelRgba; hdr: PixelRgba }): void {
  const { plain, hdr } = pixels;
  const read = `plain ${String(plain.r)},${String(plain.g)},${String(plain.b)}; hdr ${String(hdr.r)},${String(hdr.g)},${String(hdr.b)}`;
  // A mid-tone in at least one channel, so a second encode could not hide at 0 or 255.
  expect(Math.max(plain.r, plain.g, plain.b), read).toBeGreaterThan(40);
  expect(Math.min(plain.r, plain.g, plain.b), read).toBeLessThan(220);
  expect(Math.abs(hdr.r - plain.r), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(hdr.g - plain.g), read).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(hdr.b - plain.b), read).toBeLessThanOrEqual(TOLERANCE);
}

describe("rendering.hdr coverage", () => {
  it("re-applies partial fog to a PBR material after the restore", async () => {
    const pixels = await both({ subject: "pbr", fog: "partial" });
    expectSame(pixels);
    harness?.dispose();
    harness = null;
    // The fog is visible at all: a fogless HDR frame differs.
    const clear = await (await render({ subject: "pbr", hdr: true })).centrePixel();
    expect(Math.abs(clear.b - pixels.hdr.b) + Math.abs(clear.r - pixels.hdr.r)).toBeGreaterThan(20);
  }, 90_000);

  it("hides a fully fogged PBR box behind the fog colour", async () => {
    expectSame(await both({ subject: "pbr", fog: "full" }));
  }, 90_000);

  it("decodes a Standard material once", async () => {
    expectSame(await both({ subject: "standard" }));
  }, 90_000);

  it("decodes a fully fogged Standard material once", async () => {
    expectSame(await both({ subject: "standard", fog: "full" }));
  }, 90_000);

  it("keeps an unlit PBR material's colour", async () => {
    expectSame(await both({ subject: "unlit" }));
  }, 90_000);

  it("wraps a custom .wgsl material so its colour is encoded once", async () => {
    const pixels = await both({ subject: "custom" });
    expectSame(pixels);
    // The shader's 0.5 red presents as byte 128 on both paths.
    expect(Math.abs(pixels.plain.r - 128)).toBeLessThanOrEqual(TOLERANCE);
  }, 90_000);

  it("returns the environment skybox's linear colour", async () => {
    expectSame(await both({ subject: "sky" }));
  }, 90_000);

  it("runs a custom post effect on linear colour, ahead of the output pass", async () => {
    const device = gpuDeviceErrors();
    try {
      // A bright light pushes the box past 1: only a linear input can show it.
      const running = await render({ subject: "pbr", hdr: true, intensity: 8, post: ABOVE_ONE_POST_WGSL });
      const centre = await running.centrePixel();
      expect(centre.r).toBeGreaterThan(200);
      // The output pass still writes the swapchain: nothing after it took over.
      expect(running.renderer.presenter?.isPresentEnabled).toBe(true);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);
});
