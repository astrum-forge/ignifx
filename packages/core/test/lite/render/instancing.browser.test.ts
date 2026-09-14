import { afterEach, describe, expect, it } from "vitest";
import { Vec3 } from "../../../src/math/vec3.js";
import { Camera } from "../../../src/render/camera.js";
import { InstancedMeshRenderer } from "../../../src/render/instanced-mesh-renderer.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "../../render/support/browser-harness.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { MaterialAsset } from "../../../src/render/material-asset.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";

/**
 * `InstancedMeshRenderer` on a real WebGPU device (the plan's §3.5, §6.3's `instancing-20k` row).
 *
 * Only a device can show that twenty thousand instances are one draw call, that `setCount` changes
 * what is drawn, that GPU culling changes nothing but cost, that a LOD partner swaps geometry at its
 * distance, and that the cloud casts a shadow — which needs `InstancedMeshInstance.applyBounds` to
 * have published the union of the placements, because a directional light's frustum is fitted from
 * `boundMin`/`boundMax` directly.
 *
 * `msaaSamples: 1` throughout, so a single-pixel assertion is exact rather than a resolve of four
 * samples. Each test builds and disposes its own app: a WebGPU device is expensive on SwiftShader
 * and two live at once exhausts the adapter.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge every scene here uses. Small keeps SwiftShader fast. */
const SIZE = 64;

/** How many floats one instance matrix occupies. */
const MATRIX_FLOATS = 16;

/** The instance count `§6.3` names for `instancing-20k`. */
const BIG_COUNT = 20_000;

/** How dark a pixel has to be to count as "nothing was drawn here". */
const BACKGROUND_LUMINANCE = 12;

/**
 * Writes a translation-only matrix into a slab.
 *
 * @param slab - The slab to write into.
 * @param index - The instance index.
 * @param x - The world X.
 * @param y - The world Y.
 * @param z - The world Z.
 */
function writeTranslation(slab: Float32Array, index: number, x: number, y: number, z: number): void {
  const base = index * MATRIX_FLOATS;
  slab[base] = 1;
  slab[base + 5] = 1;
  slab[base + 10] = 1;
  slab[base + 15] = 1;
  slab[base + 12] = x;
  slab[base + 13] = y;
  slab[base + 14] = z;
}

/**
 * A slab whose instances tile a square grid on the XZ plane, centred on the origin, with instance
 * zero deliberately at the centre so a centre-pixel assertion has something to hit.
 *
 * @param count - How many instances to place.
 * @param spacing - Metres between neighbours.
 * @param y - The height every instance sits at.
 * @returns The slab.
 */
function gridSlab(count: number, spacing: number, y = 0): Float32Array {
  const slab = new Float32Array(count * MATRIX_FLOATS);
  const side = Math.ceil(Math.sqrt(count));
  const half = (side - 1) * spacing * 0.5;
  writeTranslation(slab, 0, 0, y, 0);
  for (let index = 1; index < count; index += 1) {
    const column = index % side;
    const row = Math.floor(index / side);
    writeTranslation(slab, index, column * spacing - half, y, row * spacing - half);
  }
  return slab;
}

/** How a scene is set up. */
interface SceneOptions {
  /** Whether the `shadows` rendering feature is on. */
  readonly shadows?: boolean;
  /** How far back the camera sits along `-Z`, looking at the origin. */
  readonly distance?: number;
  /** The camera's height. */
  readonly height?: number;
  /** The canvas edge, when a test needs more than the default. */
  readonly size?: number;
}

/**
 * Builds a lit app with a camera looking at the origin.
 *
 * @param options - Shadows, and where the camera sits.
 * @returns The running (but unstarted) app and a red PBR material.
 */
async function buildApp(options: SceneOptions = {}): Promise<{
  readonly running: BrowserApp;
  readonly material: AssetHandle<MaterialAsset>;
}> {
  const running = await createBrowserApp({
    size: options.size ?? SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: options.shadows ?? false } } },
  });
  harness = running;
  running.app.registerComponents([InstancedMeshRenderer]);

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, options.height ?? 0, -(options.distance ?? 6));
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 1000, fov: 60 });

  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "instanced", baseColor: { r: 1, g: 0.25, b: 0.1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  return { running, material };
}

/**
 * Adds a hemispheric light, which lights every face without a shadow map.
 *
 * @param running - The app.
 */
function addAmbientLight(running: BrowserApp): void {
  const sun = running.world.createEntity("Sky");
  sun.addComponent(Light, { type: "hemispheric", intensity: 2.5 });
}

describe("twenty thousand instances", () => {
  it("cost the same one draw call as a single instance", async () => {
    const { running, material } = await buildApp({ distance: 80, height: 40 });
    addAmbientLight(running);

    const box = MeshAsset.box(running.app, { size: 0.5 });
    const cloud = running.world.createEntity("Asteroids");
    const renderer = cloud.addComponent(InstancedMeshRenderer, {
      mesh: box,
      materials: [material],
      capacity: BIG_COUNT,
      gpuCulling: false,
    });
    renderer.setMatrices(gridSlab(BIG_COUNT, 0.8), BIG_COUNT);
    renderer.setCount(1);

    await running.start();
    await running.advance(SETTLE_FRAMES * 2);
    const withOne = running.renderer.drawCalls;

    renderer.setCount(BIG_COUNT);
    await running.advance(SETTLE_FRAMES * 2);
    const withAll = running.renderer.drawCalls;

    expect(withAll).toBe(withOne);
    // The absolute number, measured on SwiftShader on 2026-09-08 and decomposed by a probe over
    // four scenes: an app with a camera and a light and nothing else reports 2, one `MeshRenderer`
    // makes it 3, three make it 5. So `2` is this app's fixed baseline — the warm-up probe
    // renderables ADR-0014 registers before the scene is registered — and the instanced mesh is the
    // one draw call on top of it, at any instance count. There is no `Environment` (no skybox), the
    // `shadows` feature is off (no shadow pass) and no `PostProcessStack` (no offscreen chain).
    expect(withAll).toBe(3);
    expect(renderer.count).toBe(BIG_COUNT);
    expect(renderer.lite.mesh).not.toBeNull();
    expect(renderer.lite.lodMesh).toBeNull();
  }, 180_000);
});

describe("the bounds an instanced caster publishes", () => {
  it("leave the shared template's own box alone, so a MeshRenderer clone still culls tightly", async () => {
    const { running, material } = await buildApp({ distance: 12 });
    addAmbientLight(running);
    const box = MeshAsset.box(running.app, { size: 1 });
    const template = box.value.lite.mesh;
    expect(template).not.toBeNull();
    const before = [...(template?.boundMax ?? [])];

    const cloud = running.world.createEntity("Cloud");
    const renderer = cloud.addComponent(InstancedMeshRenderer, {
      mesh: box,
      materials: [material],
      capacity: 4,
      gpuCulling: false,
      castShadows: true,
    });
    renderer.setMatrices(gridSlab(4, 40), 4);
    const plain = running.world.createEntity("Plain");
    plain.addComponent(MeshRenderer, { mesh: box, materials: [material] });

    await running.start();
    await running.advance(SETTLE_FRAMES);

    expect([...(template?.boundMax ?? [])]).toStrictEqual(before);
    const instanced = renderer.lite.mesh;
    expect(instanced?.boundMax?.[0] ?? 0).toBeGreaterThan(10);
  }, 120_000);
});

describe("setCount", () => {
  it("stops drawing the instances it drops", async () => {
    const { running, material } = await buildApp({ distance: 4 });
    addAmbientLight(running);
    const box = MeshAsset.box(running.app, { size: 1 });
    const cloud = running.world.createEntity("Cloud");
    const renderer = cloud.addComponent(InstancedMeshRenderer, {
      mesh: box,
      materials: [material],
      capacity: 4,
      gpuCulling: false,
    });
    renderer.setMatrices(gridSlab(4, 3), 4);

    await running.start();
    await running.advance(SETTLE_FRAMES * 2);
    const withAll = pixelLuminance(await running.centrePixel());
    expect(withAll).toBeGreaterThan(BACKGROUND_LUMINANCE);

    renderer.setCount(0);
    await running.advance(SETTLE_FRAMES * 2);
    const withNone = pixelLuminance(await running.centrePixel());
    expect(withNone).toBeLessThan(BACKGROUND_LUMINANCE);
  }, 120_000);
});

describe("GPU culling", () => {
  /**
   * Renders one nine-instance cloud and reports what its centre pixel shows.
   *
   * @param gpuCulling - Whether the compute culling pass runs.
   * @returns The centre pixel's luminance.
   */
  async function centreWithCulling(gpuCulling: boolean): Promise<number> {
    const { running, material } = await buildApp({ distance: 6 });
    addAmbientLight(running);
    const box = MeshAsset.box(running.app, { size: 1 });
    const cloud = running.world.createEntity("Cloud");
    const renderer = cloud.addComponent(InstancedMeshRenderer, {
      mesh: box,
      materials: [material],
      capacity: 9,
      gpuCulling,
    });
    renderer.setMatrices(gridSlab(9, 1.6), 9);
    await running.start();
    await running.advance(SETTLE_FRAMES * 3);
    const luminance = pixelLuminance(await running.centrePixel());
    running.dispose();
    harness = null;
    return luminance;
  }

  it("does not change what the centre pixel shows", async () => {
    const culled = await centreWithCulling(true);
    const uncalled = await centreWithCulling(false);
    // The instance at the origin covers the centre either way: culling removes what is outside the
    // frustum, and the centre of the frame never is.
    expect(culled).toBeGreaterThan(BACKGROUND_LUMINANCE);
    expect(uncalled).toBeGreaterThan(BACKGROUND_LUMINANCE);
    expect(Math.abs(culled - uncalled)).toBeLessThan(4);
  }, 180_000);
});

describe("a LOD partner", () => {
  /**
   * Renders one instance with a LOD partner and reports what its centre pixel shows.
   *
   * @remarks
   * The two meshes differ in **size**, not in material: the fixed component contract gives a
   * renderer one material list and `lod` names a mesh, so both buckets draw with `materials[0]`.
   * A one-metre box covers the centre of the frame; a two-centimetre one does not.
   *
   * @param distance - Where the camera sits along `-Z`.
   * @returns The centre pixel's luminance.
   */
  async function centreAtDistance(distance: number): Promise<number> {
    const { running, material } = await buildApp({ distance });
    addAmbientLight(running);
    const full = MeshAsset.box(running.app, { size: 1 });
    const coarse = MeshAsset.box(running.app, { size: 0.02 });
    const cloud = running.world.createEntity("Cloud");
    const renderer = cloud.addComponent(InstancedMeshRenderer, {
      mesh: full,
      materials: [material],
      capacity: 1,
      gpuCulling: true,
      lod: { mesh: coarse, distance: 10, band: 0 },
    });
    renderer.setMatrices(gridSlab(1, 1), 1);
    await running.start();
    await running.advance(SETTLE_FRAMES * 3);
    expect(renderer.lite.lodMesh).not.toBeNull();
    const luminance = pixelLuminance(await running.centrePixel());
    running.dispose();
    harness = null;
    return luminance;
  }

  it("draws the full mesh near and the coarse mesh far", async () => {
    const near = await centreAtDistance(3);
    const far = await centreAtDistance(40);
    expect(near).toBeGreaterThan(BACKGROUND_LUMINANCE);
    expect(far).toBeLessThan(near);
  }, 240_000);
});

describe("shadows", () => {
  it("darken the floor exactly where the instances block the light", async () => {
    // The light travels from (8, 12, 0) toward the origin, so a box centred four metres up drops
    // its shadow along -X, clear of its own screen footprint: the shadow point and its mirror are
    // both plain white floor, and only one of them can be in shadow.
    const boxHeight = 4;
    const shadowX = -8 * (boxHeight / 12);
    const { running, material } = await buildApp({ shadows: true, distance: 14, height: 10, size: 96 });
    const sun = running.world.createEntity("Sun");
    sun.transform.localPosition.set(8, 12, 0);
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
    light.shadows.enabled = true;
    light.shadows.technique = "pcf";
    light.shadows.mapSize = 1024;

    const white = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    const floor = MeshAsset.ground(running.app, { width: 60, height: 60, subdivisions: 1 });
    running.world
      .createEntity("Ground")
      .addComponent(MeshRenderer, { mesh: floor, materials: [white], castShadows: false });

    const box = MeshAsset.box(running.app, { size: 2 });
    const slab = new Float32Array(MATRIX_FLOATS);
    writeTranslation(slab, 0, 0, boxHeight, 0);
    const renderer = running.world.createEntity("Cloud").addComponent(InstancedMeshRenderer, {
      mesh: box,
      materials: [material],
      capacity: 1,
      gpuCulling: false,
      castShadows: true,
    });
    renderer.setMatrices(slab, 1);

    await running.start();
    await running.advance(SETTLE_FRAMES * 4);

    const camera = running.world.mainCamera;
    expect(camera).not.toBeNull();
    if (camera === null) {
      return;
    }
    const projected = new Vec3();
    expect(camera.worldToScreen(new Vec3(shadowX, 0.02, 0), projected)).toBe(true);
    const shadowPixelX = Math.round(projected.x);
    const shadowPixelY = Math.round(projected.y);
    expect(camera.worldToScreen(new Vec3(-shadowX, 0.02, 0), projected)).toBe(true);
    const litPixelX = Math.round(projected.x);
    const litPixelY = Math.round(projected.y);

    const shadowed = pixelLuminance(await running.pixelAt(shadowPixelX, shadowPixelY));
    const lit = pixelLuminance(await running.pixelAt(litPixelX, litPixelY));
    expect(lit).toBeGreaterThan(100);
    expect(shadowed).toBeLessThan(lit * 0.5);

    // The same pixel with the cloud out of the caster list: the shadow is gone and the floor is as
    // bright as its mirror, which is what makes the assertion above about the instances and not
    // about the framing.
    renderer.castShadows = false;
    await running.advance(SETTLE_FRAMES * 4);
    const relit = pixelLuminance(await running.pixelAt(shadowPixelX, shadowPixelY));
    expect(relit).toBeGreaterThan(100);
  }, 240_000);
});
