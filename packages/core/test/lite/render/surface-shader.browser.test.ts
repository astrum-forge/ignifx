import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../../src/errors/ignifx-error.js";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { attachSurfaceShaders, detachSurfaceShaders } from "../../../src/render/surface-shader.js";
import { createSurfaceBrowserApp, SURFACE_SETTLE_FRAMES } from "../../fixtures/shaders/surface-browser.js";
import {
  BENT_NORMAL_SURFACE_WGSL,
  FLAT_RED_SURFACE_WGSL,
  INVERT_COMPOSITE_WGSL,
  LIFT_DISPLACE_WGSL,
  SNOW_SURFACE_WGSL,
} from "../../fixtures/shaders/surfaces.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { MaterialAsset } from "../../../src/render/material-asset.js";
import type { SurfaceShaderBinding, SurfaceShaderInit } from "../../../src/render/surface-shader.js";
import type { SurfaceBrowserApp } from "../../fixtures/shaders/surface-browser.js";

/**
 * Surface shaders on a real WebGPU device: the whole point of the feature is that the engine's own
 * lighting, shadows and image-based lighting survive, and the only way to prove that is to draw and
 * read the pixels.
 *
 * The scene every test builds is a lit sphere over a ground plane with one shadow-casting
 * directional light, which is what makes both halves checkable: the sphere's own pixels prove the
 * fragment hooks, and the ground's pixels under it prove that the vertex hook reached the shadow
 * caster pass (spike S0.2 measured that it does; this is the regression guard).
 */

let harness: SurfaceBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge every scene here uses. Small keeps SwiftShader fast. */
const SIZE = 64;

/**
 * Where the sphere's own pixels are, in the framing below. Measured rather than derived: the whole
 * frame was dumped as a luminance map while the suite was written, which is the only honest way to
 * pick a pixel for an assertion.
 */
const SPHERE_X = 32;

/** A row through the sphere's middle. */
const SPHERE_Y = 24;

/** A point on the ground that the sphere's shadow covers while the sphere is *not* displaced. */
const SHADOW_X = 24;

/** The row that point is on. */
const SHADOW_Y = 42;

/** The scene one test drives. */
interface Scene {
  /** The running app. */
  readonly running: SurfaceBrowserApp;
  /** The sphere's material, the surface shaders' host. */
  readonly material: MaterialAsset;
  /** The sphere's renderer. */
  readonly sphere: MeshRenderer;
}

/**
 * Builds a lit, shadowed scene: a white ground plane, a directional light above and behind, and a
 * sphere at the origin wearing `material`.
 *
 * @param build - Builds the sphere's material, so a test can make it PBR or Standard.
 * @param beforeStart - Runs once the material exists and before the app starts.
 * @returns The scene.
 */
async function buildScene(
  build: (running: SurfaceBrowserApp) => AssetHandle<MaterialAsset>,
  beforeStart?: (running: SurfaceBrowserApp, material: MaterialAsset) => void,
): Promise<Scene> {
  const running = await createSurfaceBrowserApp({
    size: SIZE,
    start: false,
    settings: { rendering: { msaaSamples: 1, features: { materialPlugins: true, shadows: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 2.2, -4.5);
  eye.transform.lookAt({ x: 0, y: 1, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 55 });

  // Lit from 45 degrees rather than from overhead, so a vertical displacement moves the shadow
  // *sideways* by the same distance and the move is measurable at a fixed pixel.
  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(6, 6, 0);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = true;
  light.shadows.technique = "pcf";
  light.shadows.mapSize = 512;

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "ground", baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const ground = MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 });
  running.world
    .createEntity("Ground")
    .addComponent(MeshRenderer, { mesh: ground, materials: [white], castShadows: false });

  const material = build(running);
  const mesh = MeshAsset.sphere(running.app, { diameter: 1.6, segments: 16 });
  const entity = running.world.createEntity("Sphere");
  entity.transform.localPosition.set(0, 1.4, 0);
  const sphere = entity.addComponent(MeshRenderer, { mesh, materials: [material] });

  beforeStart?.(running, material.value);
  await running.start();
  await running.advance(SURFACE_SETTLE_FRAMES);
  return { running, material: material.value, sphere };
}

/**
 * A PBR material for the sphere.
 *
 * @param running - The app.
 * @param name - The material's name.
 * @returns The material.
 */
function pbrSphere(running: SurfaceBrowserApp, name = "rock"): AssetHandle<MaterialAsset> {
  return createMaterialAsset(
    running.app,
    pbrMaterialDefinition({
      name,
      baseColor: { r: 0.25, g: 0.25, b: 0.3, a: 1 },
      metallic: 0,
      roughness: 0.8,
    }),
    [],
  );
}

/**
 * A Standard material for the sphere.
 *
 * @remarks
 * White diffuse and no specular: Standard multiplies its lit diffuse by `baseColor`, which is what
 * the hook writes, so a dark `diffuse` would leave nothing to read — and its specular term is added
 * after* that multiply, so a highlight would wash the tint back to white.
 *
 * @param running - The app.
 * @returns The material.
 */
function standardSphere(running: SurfaceBrowserApp): AssetHandle<MaterialAsset> {
  return createMaterialAsset(
    running.app,
    standardMaterialDefinition({
      name: "wall",
      diffuse: { r: 1, g: 1, b: 1, a: 1 },
      specular: { r: 0, g: 0, b: 0, a: 1 },
    }),
    [],
  );
}

/**
 * Attaches one surface shader from a source.
 *
 * @param scene - The scene.
 * @param address - The shader's address.
 * @param source - The `.surface.wgsl` text.
 * @param overrides - What the material declares beyond the shader.
 * @returns The bindings.
 */
function attach(
  scene: Scene,
  address: string,
  source: string,
  overrides: Omit<SurfaceShaderInit, "shader"> = {},
): readonly SurfaceShaderBinding[] {
  const shader = scene.running.publishShader(address, source);
  return attachSurfaceShaders(scene.material, scene.running.app, [{ shader, ...overrides }]);
}

describe("the surface hook", () => {
  it("replaces the base colour and keeps the engine's lighting", async () => {
    const scene = await buildScene(pbrSphere);
    attach(scene, "shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const lit = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    // Red, and not saturated: a shaded sphere's own pixel is the base colour times the lighting, so
    // an unlit `1.0` would read 255 and a lit one reads well below it.
    expect(lit.r).toBeGreaterThan(lit.g + 40);
    expect(lit.r).toBeGreaterThan(lit.b + 40);
    expect(lit.r).toBeLessThan(255);
  });

  it("still shades, so the sphere's top and bottom differ", async () => {
    const scene = await buildScene(pbrSphere);
    attach(scene, "shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const top = await scene.running.pixelAt(SPHERE_X, SPHERE_Y - 6);
    const bottom = await scene.running.pixelAt(SPHERE_X, SPHERE_Y + 6);
    expect(Math.abs(top.r - bottom.r)).toBeGreaterThan(8);
  });

  it("changes the frame when a declared value is written", async () => {
    const scene = await buildScene(pbrSphere);
    const [binding] = attach(scene, "shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL, { values: { amount: 0 } });
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const before = await scene.running.meanLuminance();
    binding?.set("amount", 1);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const after = await scene.running.meanLuminance();
    // The snow colour is much brighter than the rock, so the frame gets brighter.
    expect(after).toBeGreaterThan(before + 0.005);
  });

  it("perturbs the shading normal, which changes how the sphere is lit", async () => {
    const scene = await buildScene(pbrSphere);
    const plain = await scene.running.meanLuminance();
    attach(scene, "shaders/bent.surface.wgsl", BENT_NORMAL_SURFACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect(Math.abs((await scene.running.meanLuminance()) - plain)).toBeGreaterThan(0.001);
  });

  it("refuses a surface shader on a device without the materialPlugins opt-in", async () => {
    const running = await createSurfaceBrowserApp({
      size: 32,
      settings: { rendering: { msaaSamples: 1, features: { materialPlugins: false } } },
    });
    harness = running;
    const material = createMaterialAsset(running.app, pbrMaterialDefinition({ name: "rock" }), []).value;
    const shader = running.publishShader("shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    let code = "none";
    try {
      attachSurfaceShaders(material, running.app, [{ shader }]);
    } catch (failure: unknown) {
      code = isIgnifxError(failure) ? failure.code : "not-an-ignifx-error";
    }
    expect(code).toBe("IGX-0716");
  });

  it("refuses a standard material host, which Babylon Lite would silently ignore", async () => {
    const scene = await buildScene(standardSphere);
    const before = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    const shader = scene.running.publishShader("shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    let code = "none";
    try {
      attachSurfaceShaders(scene.material, scene.running.app, [{ shader }]);
    } catch (failure: unknown) {
      code = isIgnifxError(failure) ? failure.code : "not-an-ignifx-error";
    }
    // The standard plugin bridge bakes a material's plugin signature from the meshes already in the
    // scene, and ignifx creates a MeshRenderer's Lite mesh in the first frame — so the WGSL never
    // reaches the shader and the material draws exactly as before. Refused, not ignored.
    expect(code).toBe("IGX-0723");
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect((await scene.running.pixelAt(SPHERE_X, SPHERE_Y)).r).toBe(before.r);
  });
});

describe("the composite hook", () => {
  it("inverts the lit colour exactly once, though Lite injects the point twice", async () => {
    const scene = await buildScene(pbrSphere);
    const plain = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    attach(scene, "shaders/invert.surface.wgsl", INVERT_COMPOSITE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const inverted = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    // Injected twice with no guard, a double inversion would land back on the plain pixel.
    expect(inverted.r).toBeGreaterThan(plain.r + 30);
  });
});

describe("the displace hook", () => {
  it("moves the mesh and its shadow, because the caster pass honours the vertex slot", async () => {
    const scene = await buildScene(pbrSphere);
    const groundBefore = await scene.running.pixelAt(SHADOW_X, SHADOW_Y);
    const sphereBefore = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);

    attach(scene, "shaders/lift.surface.wgsl", LIFT_DISPLACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);

    const sphereAfter = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    const groundAfter = await scene.running.pixelAt(SHADOW_X, SHADOW_Y);
    // The sphere left the row it was in: a dark pixel became the white ground behind it.
    expect(sphereAfter.r).toBeGreaterThan(sphereBefore.r + 40);
    // And its shadow left with it, which is the claim spike S0.2 made about the caster pass: the
    // point it used to darken is now lit.
    expect(groundAfter.r).toBeGreaterThan(groundBefore.r + 40);
  });
});

describe("several shaders on one material", () => {
  it("attaches two and applies both", async () => {
    const scene = await buildScene(pbrSphere);
    const flat = scene.running.publishShader("shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    const invert = scene.running.publishShader("shaders/invert.surface.wgsl", INVERT_COMPOSITE_WGSL);
    attachSurfaceShaders(scene.material, scene.running.app, [
      { shader: flat, priority: 100 },
      { shader: invert, priority: 200 },
    ]);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const pixel = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    // Red base colour, then inverted: the red channel is the *brightest* of the three before the
    // inversion, so it is the darkest after it.
    expect(pixel.r).toBeLessThan(pixel.g);
    expect(pixel.r).toBeLessThan(pixel.b);
    expect(scene.running.errors).toStrictEqual([]);
  });
});

describe("switching a surface shader off", () => {
  it("restores the host material's plain look", async () => {
    const scene = await buildScene(pbrSphere);
    const plain = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    const [binding] = attach(scene, "shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    expect((await scene.running.pixelAt(SPHERE_X, SPHERE_Y)).r).toBeGreaterThan(plain.r + 20);

    if (binding !== undefined) {
      binding.enabled = false;
    }
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const restored = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    expect(Math.abs(restored.r - plain.r)).toBeLessThan(6);
  });

  it("detaching restores it too", async () => {
    const scene = await buildScene(pbrSphere);
    const plain = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    attach(scene, "shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    detachSurfaceShaders(scene.material);
    await scene.running.advance(SURFACE_SETTLE_FRAMES);
    const restored = await scene.running.pixelAt(SPHERE_X, SPHERE_Y);
    expect(Math.abs(restored.r - plain.r)).toBeLessThan(6);
  });
});
