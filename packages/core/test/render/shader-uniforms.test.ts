import { afterEach, describe, expect, it } from "vitest";
import { Color } from "../../src/math/color.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset } from "../../src/render/material-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { createShaderHarness } from "../fixtures/shaders/harness.js";
import { LIT_WGSL, TINT_WGSL } from "../fixtures/shaders/sources.js";
import { warningsOf } from "./support/render-harness.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";
import type { ShaderAsset } from "../../src/render/shader-asset.js";
import type { ShaderHarness } from "../fixtures/shaders/harness.js";

/**
 * The `PreRender` system that writes the ignifx-provided uniforms
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * Every assertion here reads the material's own CPU-side copy through `getUniform`, which is what
 * the system wrote and what the adapter forwarded to Babylon Lite. Whether the bytes reach the GPU
 * is the browser suite's job.
 */

let harness: ShaderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A harness with the shader layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<ShaderHarness> {
  harness = await createShaderHarness();
  return harness;
}

/**
 * Loads a source and builds a material on it.
 *
 * @param h - The harness.
 * @param address - The shader address.
 * @param source - The `.wgsl` text.
 * @returns The material.
 */
async function materialFor(h: ShaderHarness, address: string, source: string): Promise<MaterialAsset> {
  const shader = await h.load<ShaderAsset>(address, { [address]: source });
  return createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
}

/**
 * Puts a spherical-harmonics block on the scene's environment slot, which is what `loadEnvironment`
 * installs on a real device (`src/lite/gpu/environment.ts`). Stubbing it is how a headless test
 * reaches the ambient path without a `.env` file and a GPU.
 *
 * @param h - The harness.
 * @param sphericalHarmonics - The harmonic bands; the first three floats are the `L00` band.
 */
function installHarmonics(h: ShaderHarness, sphericalHarmonics: Float32Array): void {
  // Boundary assertion: `_envTextures` is the undeclared Lite field the environment adapter owns,
  // and `sphericalHarmonics` is a declared member of what it holds (`index.d.ts`).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const scene = h.renderer.scene as unknown as { _envTextures?: { sphericalHarmonics: Float32Array } };
  // oxlint-disable-next-line no-underscore-dangle
  scene._envTextures = { sphericalHarmonics };
}

/**
 * Reads a `vec3<f32>` uniform as three numbers.
 *
 * @param material - The material.
 * @param name - The uniform's name.
 * @returns The three floats.
 */
function triple(material: MaterialAsset, name: string): readonly number[] {
  const out = new Float32Array(3);
  material.getUniform(name, out);
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

describe("the clock uniforms", () => {
  it("advance with the app's scaled clock", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame(0.5);
    const first = material.getUniform("time");
    h.frame(0.5);
    expect(material.getUniform("time")).toBeGreaterThan(typeof first === "number" ? first : 0);
  });

  it("freeze while the app is paused", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame(0.5);
    const frozen = material.getUniform("time");
    h.app.pause();
    h.frame(0.5);
    h.frame(0.5);
    expect(material.getUniform("time")).toBe(frozen);
  });

  it("resume without a jump: a paused frame advances nothing", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame(0.25);
    const before = Number(material.getUniform("time"));
    h.app.pause();
    h.frame(4);
    h.app.resume();
    h.frame(0.25);
    expect(Number(material.getUniform("time")) - before).toBeCloseTo(0.25);
  });

  it("match app.time.time exactly for an app that never paused", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame(0.25);
    expect(material.getUniform("time")).toBeCloseTo(h.app.time.time);
    h.frame(0.25);
    expect(material.getUniform("time")).toBeCloseTo(h.app.time.time);
  });

  it("write unscaledTime and deltaTime when the shader declares them", async () => {
    const h = await app();
    const material = await materialFor(
      h,
      "shaders/clock.wgsl",
      "// @ignifx shader\n// @ignifx system time, unscaledTime, deltaTime\n",
    );
    h.frame(0.25);
    expect(material.getUniform("unscaledTime")).toBeCloseTo(h.app.time.unscaledTime);
    expect(material.getUniform("deltaTime")).toBeCloseTo(0.25);
    h.app.pause();
    h.frame(0.25);
    expect(material.getUniform("deltaTime")).toBe(0);
  });

  it("are not written at all when the shader declares none", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/plain.wgsl", "// @ignifx shader\n// @ignifx uniform n: f32 = 3\n");
    h.frame(0.5);
    expect(material.getUniform("n")).toBeCloseTo(3);
  });
});

describe("the main-light uniforms", () => {
  it("take the highest-intensity enabled directional light", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const dim = h.world.createEntity("dim");
    dim.addComponent(Light, { type: "directional", intensity: 1, color: { r: 1, g: 0, b: 0, a: 1 } });
    const bright = h.world.createEntity("bright");
    bright.addComponent(Light, { type: "directional", intensity: 4, color: { r: 0, g: 1, b: 0, a: 1 } });
    h.frame();
    const color = triple(material, "mainLightColor");
    expect(color[0]).toBeCloseTo(0);
    expect(color[1]).toBeCloseTo(Color.srgbToLinear(1) * 4);
  });

  it("read the entity's world forward axis as the direction", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const sun = h.world.createEntity("sun");
    sun.addComponent(Light, { type: "directional", intensity: 1 });
    sun.transform.lookAt({ x: 10, y: 0, z: 0 });
    h.frame();
    const direction = triple(material, "mainLightDirection");
    expect(direction[0]).toBeCloseTo(1);
    expect(direction[2]).toBeCloseTo(0);
  });

  it("normalise the direction of a scaled light entity", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const sun = h.world.createEntity("sun");
    sun.addComponent(Light, { type: "directional", intensity: 1 });
    sun.transform.localScale.set(3, 3, 3);
    sun.transform.lookAt({ x: 10, y: 0, z: 0 });
    h.frame();
    const direction = triple(material, "mainLightDirection");
    expect(Math.hypot(direction[0] ?? 0, direction[1] ?? 0, direction[2] ?? 0)).toBeCloseTo(1);
  });

  it("name the material and the uniform in the no-light warning", async () => {
    const h = await app();
    await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    h.frame();
    const warning = warningsOf(h).find((message) => message.includes("IGX-0714")) ?? "";
    expect(warning).toContain("shaders/lit.wgsl");
    expect(warning).toContain("mainLightDirection");
    expect(warning).not.toContain("{material}");
  });

  it("upload a zero direction for a light whose transform collapsed", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const sun = h.world.createEntity("sun");
    sun.addComponent(Light, { type: "directional", intensity: 1 });
    sun.transform.localScale.set(0, 0, 0);
    h.frame();
    expect(triple(material, "mainLightDirection")).toEqual([0, 0, 0]);
  });

  it("ignore a point light", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const lamp = h.world.createEntity("lamp");
    lamp.addComponent(Light, { type: "point", intensity: 9 });
    h.frame();
    expect(triple(material, "mainLightColor")).toEqual([0, 0, 0]);
  });

  it("ignore a disabled directional light", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const sun = h.world.createEntity("sun");
    const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
    light.enabled = false;
    h.frame();
    expect(triple(material, "mainLightColor")).toEqual([0, 0, 0]);
  });

  it("upload zeros and warn exactly once when no light is present", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    h.frame();
    h.frame();
    h.frame();
    expect(triple(material, "mainLightDirection")).toEqual([0, 0, 0]);
    const warnings = warningsOf(h).filter((message) => message.includes("IGX-0714"));
    expect(warnings).toHaveLength(1);
  });

  it("do not warn for a shader that declares only the clock", async () => {
    const h = await app();
    await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame();
    expect(warningsOf(h).filter((message) => message.includes("IGX-0714"))).toHaveLength(0);
  });

  it("upload zeros for the ambient colour when no environment is installed", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    h.frame();
    expect(triple(material, "ambientColor")).toEqual([0, 0, 0]);
  });

  it("upload the installed environment's L00 harmonic band as the ambient colour", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    installHarmonics(h, Float32Array.from([0.25, 0.5, 0.75]));
    h.frame();
    const ambient = triple(material, "ambientColor");
    expect(ambient[0]).toBeCloseTo(0.25);
    expect(ambient[1]).toBeCloseTo(0.5);
    expect(ambient[2]).toBeCloseTo(0.75);
  });

  it("ignore an environment whose harmonics are too short to read", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    installHarmonics(h, Float32Array.from([0.25]));
    h.frame();
    expect(triple(material, "ambientColor")).toEqual([0, 0, 0]);
  });

  it("follow a light whose intensity changed", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/lit.wgsl", LIT_WGSL);
    const sun = h.world.createEntity("sun");
    const light = sun.addComponent(Light, { type: "directional", intensity: 1 });
    h.frame();
    light.intensity = 2;
    h.frame();
    expect(triple(material, "mainLightColor")[0]).toBeCloseTo(Color.srgbToLinear(1) * 2);
  });
});

describe("the registry", () => {
  it("stops writing a material that has been disposed", async () => {
    const h = await app();
    const material = await materialFor(h, "shaders/tint.wgsl", TINT_WGSL);
    h.frame(0.5);
    const written = material.getUniform("time");
    material.dispose();
    h.frame(0.5);
    expect(material.getUniform("time")).toBe(written);
  });

  it("survives disposing one of two materials", async () => {
    const h = await app();
    const first = await materialFor(h, "shaders/a.wgsl", TINT_WGSL);
    const second = await materialFor(h, "shaders/b.wgsl", TINT_WGSL);
    first.dispose();
    h.frame(0.5);
    expect(second.getUniform("time")).toBeGreaterThan(0);
  });

  it("does nothing at all when no shader material is live", async () => {
    const h = await app();
    expect(() => {
      h.frame();
    }).not.toThrow();
  });
});
