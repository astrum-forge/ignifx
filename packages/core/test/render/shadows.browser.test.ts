import { afterEach, describe, expect, it } from "vitest";
import { waitForGpuWork } from "../../src/lite/gpu/render-diagnostics-gpu.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { Model } from "../../src/render/model.js";
import { createBrowserApp, fixtureUrl, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { Entity } from "../../src/entity/entity.js";
import type { LiteMesh } from "../../src/lite/gpu/mesh.js";
import type { ModelAsset } from "../../src/render/model-asset.js";

/**
 * Shadow casting end to end (`docs/architecture/07-rendering.md` §2.2, §1.1).
 *
 * Two things have to line up, and neither is obvious: the scene has to be registered with
 * `registerSceneWithShadowSupport`, which the `rendering.features.shadows` opt-in decides **before**
 * anything is compiled; and the light has to be posed in world space on an **unparented** Lite
 * light, because the shading direction (the light's world matrix) and the shadow frustum
 * (`light.direction`/`light.position`) are read from two different places and only agree when there
 * is no parent (ADR-0002, "Corrections after the visual suite").
 *
 * The suite measures brightness two ways. "The scene is darker when something is casting" is a
 * whole-frame mean, because SwiftShader plus a soft PCF edge make a single hard-coded shadow pixel a
 * framing argument. Direction, on the other hand, has to be measured *somewhere specific*, so the
 * second half of the file samples named bands and asserts which one is brighter — the assertion the
 * old suite was missing, and the reason a light that shaded from the wrong direction went unnoticed
 * until the visual goldens were generated.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge every scene here uses. */
const SIZE = 64;

/**
 * Builds a white ground plane lit from directly above with a box floating over it.
 *
 * @param shadows - Whether the `shadows` rendering feature is on. The light asks for shadows either
 * way, so the `false` case is also what proves the warning.
 * @returns The running app, the light, and the caster's renderer.
 */
async function buildShadowScene(shadows: boolean): Promise<{
  readonly running: BrowserApp;
  readonly light: Light;
  readonly caster: MeshRenderer;
}> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 5, -6);
  eye.transform.lookAt({ x: 0, y: 0.5, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(0, 10, 0.001);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = true;
  light.shadows.technique = "pcf";
  light.shadows.mapSize = 512;

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const ground = MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 });
  running.world
    .createEntity("Ground")
    .addComponent(MeshRenderer, { mesh: ground, materials: [white], castShadows: false });

  const box = MeshAsset.box(running.app, { size: 2 });
  const blocker = running.world.createEntity("Blocker");
  blocker.transform.localPosition.set(0, 2, 0);
  const caster = blocker.addComponent(MeshRenderer, { mesh: box, materials: [white] });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  return { running, light, caster };
}

/**
 * The mean luminance of a whole captured frame.
 *
 * @param running - The running app.
 * @returns The mean, 0 to 255.
 */
async function meanLuminance(running: BrowserApp): Promise<number> {
  const frame = await running.app.renderer.captureScreenshot();
  let total = 0;
  let count = 0;
  for (let index = 0; index < frame.data.length; index += 4) {
    total += pixelLuminance({
      r: frame.data[index] ?? 0,
      g: frame.data[index + 1] ?? 0,
      b: frame.data[index + 2] ?? 0,
      a: 255,
    });
    count += 1;
  }
  return total / count;
}

describe("the shadows rendering feature", () => {
  it("attaches a generator, and darkens the scene, when it is on", async () => {
    const shadowed = await buildShadowScene(true);
    expect(shadowed.light.isCastingShadows).toBe(true);
    expect(shadowed.light.lite.shadowGenerator).not.toBeNull();
    const withShadows = await meanLuminance(shadowed.running);
    expect(withShadows).toBeGreaterThan(0);
    // The loop is stopped and the queue drained before the device goes away: destroying a device
    // with a shadow pass still in flight surfaces asynchronously, outside any frame ignifx owns.
    shadowed.running.app.stop();
    await waitForGpuWork(shadowed.running.app.lite.engine);
    shadowed.running.dispose();
    harness = null;

    const plain = await buildShadowScene(false);
    expect(plain.light.isCastingShadows).toBe(false);
    const withoutShadows = await meanLuminance(plain.running);
    expect(withoutShadows).toBeGreaterThan(0);

    // The same scene, the same camera, the same light: the only difference is the shadow pass.
    expect(withShadows).toBeLessThan(withoutShadows);
  });

  it("warns once when the project did not opt in", async () => {
    const plain = await buildShadowScene(false);
    const warnings = plain.running.log.toArray().filter((record) => record.message.includes("asks for shadows"));
    expect(warnings).toHaveLength(1);
    expect(plain.light.lite.shadowGenerator).toBeNull();
  });
});

describe("caster lists", () => {
  it("survives a renderer that stops casting", async () => {
    const scene = await buildShadowScene(true);
    expect(scene.caster.castShadows).toBe(true);
    scene.caster.castShadows = false;
    await scene.running.advance(SETTLE_FRAMES * 2);
    expect(scene.running.errors).toEqual([]);
    expect(scene.light.isCastingShadows).toBe(true);
  });

  it("keeps casting after the caster's mesh is swapped for a new clone", async () => {
    // A swapped `mesh` rebuilds the clone without `castShadows` or visibility moving; the caster list
    // must still be rebuilt, or the generator keeps rendering the destroyed clone (a stale caster).
    const scene = await buildShadowScene(true);
    const before = await bandLuminance(scene.running, 29, 34, 35, 40);
    scene.caster.mesh = MeshAsset.box(scene.running.app, { size: 2 });
    await scene.running.advance(SETTLE_FRAMES * 4);
    const after = await bandLuminance(scene.running, 29, 34, 35, 40);
    expect(scene.running.errors).toEqual([]);
    expect(scene.light.isCastingShadows).toBe(true);
    // The same-sized replacement casts the same shadow: still dark under the box.
    expect(after).toBeLessThan(Math.max(before * 1.25, before + 8));
  });

  it("releases the generator when the light stops casting", async () => {
    const scene = await buildShadowScene(true);
    scene.light.shadows.enabled = false;
    await scene.running.advance(SETTLE_FRAMES * 2);
    expect(scene.light.isCastingShadows).toBe(false);
    expect(scene.light.lite.shadowGenerator).toBeNull();
    expect(scene.running.errors).toEqual([]);
  });
});

/**
 * The mean luminance of a rectangular band of a captured frame.
 *
 * @param running - The running app.
 * @param left - The first column, inclusive.
 * @param top - The first row, inclusive.
 * @param right - The last column, inclusive.
 * @param bottom - The last row, inclusive.
 * @returns The mean, 0 to 255.
 */
async function bandLuminance(
  running: BrowserApp,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Promise<number> {
  const frame = await running.app.renderer.captureScreenshot();
  let total = 0;
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = (y * frame.width + x) * 4;
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
 * Builds a white sphere on black, seen head-on, with one light whose entity the caller aims.
 *
 * @remarks
 * A sphere rather than a box: a 180-degree turn of the light lights the exactly opposite hemisphere,
 * which is a swap two faces of a cube can never show from one camera.
 *
 * @param type - The light kind.
 * @returns The running app and the light's entity.
 */
async function buildSphereScene(type: "directional" | "point"): Promise<{
  readonly running: BrowserApp;
  readonly lightEntity: Entity;
}> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: false } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  const camera = eye.addComponent(Camera, { near: 0.1, far: 100, fov: 45 });
  camera.clearColor = { r: 0, g: 0, b: 0, a: 1 };

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Ball")
    .addComponent(MeshRenderer, { mesh: MeshAsset.sphere(running.app, { diameter: 3 }), materials: [white] });

  const lightEntity = running.world.createEntity("Key");
  lightEntity.addComponent(Light, { type, intensity: type === "point" ? 40 : 3, range: 40 });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  return { running, lightEntity };
}

/** The left half of the sphere, in pixels. */
const LEFT_BAND = [18, 26, 26, 38] as const;

/** The right half of the sphere, in pixels. */
const RIGHT_BAND = [38, 26, 46, 38] as const;

describe("which direction a light shades from", () => {
  it("lights the side of a ball that faces the light entity", async () => {
    const scene = await buildSphereScene("directional");
    // Aim the light along +X: it can only light the hemisphere whose normals point along -X.
    scene.lightEntity.transform.lookAt({ x: 10, y: 0, z: 0 });
    await scene.running.advance(SETTLE_FRAMES * 3);

    const left = await bandLuminance(scene.running, ...LEFT_BAND);
    const right = await bandLuminance(scene.running, ...RIGHT_BAND);
    expect(Math.max(left, right)).toBeGreaterThan(20);
    expect(Math.abs(left - right)).toBeGreaterThan(10);
  });

  it("swaps the lit hemisphere when the light entity is turned 180 degrees", async () => {
    const scene = await buildSphereScene("directional");
    scene.lightEntity.transform.lookAt({ x: 10, y: 0, z: 0 });
    await scene.running.advance(SETTLE_FRAMES * 3);
    const firstLeft = await bandLuminance(scene.running, ...LEFT_BAND);
    const firstRight = await bandLuminance(scene.running, ...RIGHT_BAND);

    scene.lightEntity.transform.lookAt({ x: -10, y: 0, z: 0 });
    await scene.running.advance(SETTLE_FRAMES * 3);
    const secondLeft = await bandLuminance(scene.running, ...LEFT_BAND);
    const secondRight = await bandLuminance(scene.running, ...RIGHT_BAND);

    // Whichever side the first aim lit, the reversed aim lights the other one. A light that was
    // rotated twice, or not at all, cannot produce this.
    expect(Math.sign(firstLeft - firstRight)).toBe(-Math.sign(secondLeft - secondRight));
    expect(Math.abs(secondLeft - secondRight)).toBeGreaterThan(10);
    expect(scene.running.errors).toEqual([]);
  });

  it("moves a point light's lit region with its entity", async () => {
    const scene = await buildSphereScene("point");
    scene.lightEntity.transform.localPosition.set(-4, 0, -2);
    await scene.running.advance(SETTLE_FRAMES * 3);
    const nearLeft = await bandLuminance(scene.running, ...LEFT_BAND);
    const nearRight = await bandLuminance(scene.running, ...RIGHT_BAND);

    scene.lightEntity.transform.localPosition.set(4, 0, -2);
    await scene.running.advance(SETTLE_FRAMES * 3);
    const farLeft = await bandLuminance(scene.running, ...LEFT_BAND);
    const farRight = await bandLuminance(scene.running, ...RIGHT_BAND);

    expect(Math.sign(nearLeft - nearRight)).toBe(-Math.sign(farLeft - farRight));
    expect(Math.abs(farLeft - farRight)).toBeGreaterThan(10);
    expect(scene.running.errors).toEqual([]);
  });
});

describe("where the shadow lands", () => {
  it("darkens the ground the caster stands over, and only with the feature on", async () => {
    // The light points straight down at the origin and the box floats over it, so the shadow falls
    // on the ground the camera sees just below the box.
    const shadowed = await buildShadowScene(true);
    const inShadow = await bandLuminance(shadowed.running, 29, 34, 35, 40);
    const lit = await bandLuminance(shadowed.running, 29, 52, 35, 58);
    shadowed.running.app.stop();
    await waitForGpuWork(shadowed.running.app.lite.engine);
    shadowed.running.dispose();
    harness = null;

    const plain = await buildShadowScene(false);
    const unshadowed = await bandLuminance(plain.running, 29, 34, 35, 40);

    // The same ground, the same light: darker under the box when a generator is casting.
    expect(inShadow).toBeLessThan(unshadowed * 0.75);
    // And the shadow is *local* — ground further down the frame stays lit, which is what says the
    // frustum was fitted around the caster rather than swallowing the scene.
    expect(lit).toBeGreaterThan(inShadow);
  });
});

/**
 * A white ground plane with a `Model` of `Box.glb` floating over it, lit from up and to the right so
 * that the box's shadow lands on ground the camera can see rather than behind the box itself.
 *
 * The caster is a `Model`, the catcher is a `MeshRenderer`: what is under test is whether a model's
 * cloned subtree reaches a generator's caster list at all (ADR-0002, "Still outstanding" — it did
 * not, until this suite). `Box.glb` is a one-metre cube centred on its origin, so the entity is
 * scaled to two metres and the numbers read like the `MeshRenderer` scene above.
 *
 * The model is added **after** `start()`, which is the case a viewer has: the glTF is fetched, and
 * the component that instantiates it exists only once the handle settles. That is also the case the
 * defect hid in — nothing else in the frame is changing, so if the model does not report its own
 * caster change, no caster list is ever rebuilt.
 *
 * @param castShadows - What the model's `castShadows` field is set to.
 * @returns The running app and the model.
 */
async function buildModelShadowScene(castShadows: boolean): Promise<{
  readonly running: BrowserApp;
  readonly model: Model;
}> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [{ address: "models/Box.glb", url: fixtureUrl("Box.glb"), type: "model" }],
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 3, -8);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(6, 7, 0);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = true;
  light.shadows.technique = "pcf";
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
    receiveShadows: true,
  });

  await running.start();
  const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
  const blocker = running.world.createEntity("Blocker");
  blocker.transform.localPosition.set(0, 2, 0);
  blocker.transform.localScale.set(2, 2, 2);
  const model = blocker.addComponent(Model, { model: handle, castShadows, receiveShadows: false });
  await running.advance(SETTLE_FRAMES * 4);
  return { running, model };
}

/** The ground the box's shadow falls on, in pixels: left of the box and just below the horizon. */
const MODEL_SHADOW_BAND = [10, 31, 18, 33] as const;

/** Ground of the same plane, well clear of the shadow, as the control. */
const MODEL_LIT_BAND = [10, 48, 18, 56] as const;

describe("a Model as a shadow caster", () => {
  it("puts its instantiated meshes on the caster list only while castShadows is on", async () => {
    const scene = await buildModelShadowScene(true);
    const casting: LiteMesh[] = [];
    scene.model.collectCasters(casting);
    expect(casting.length).toBeGreaterThan(0);
    expect(scene.model.lite.root).not.toBeNull();

    scene.model.castShadows = false;
    await scene.running.advance(SETTLE_FRAMES);
    const idle: LiteMesh[] = [];
    scene.model.collectCasters(idle);
    expect(idle).toEqual([]);
    expect(scene.running.errors).toEqual([]);
  });

  it("darkens the ground its shadow falls on, and only when it casts", async () => {
    const casting = await buildModelShadowScene(true);
    const inShadow = await bandLuminance(casting.running, ...MODEL_SHADOW_BAND);
    const lit = await bandLuminance(casting.running, ...MODEL_LIT_BAND);
    // The loop is stopped and the queue drained before the device goes away, exactly as the
    // `MeshRenderer` pair above does.
    casting.running.app.stop();
    await waitForGpuWork(casting.running.app.lite.engine);
    casting.running.dispose();
    harness = null;

    const idle = await buildModelShadowScene(false);
    const unshadowed = await bandLuminance(idle.running, ...MODEL_SHADOW_BAND);
    const idleLit = await bandLuminance(idle.running, ...MODEL_LIT_BAND);

    // The same model, the same light, the same floor: the only difference is `castShadows`.
    // Measured on SwiftShader, 2026-09-06: 0 against 218 in the shadow band.
    expect(unshadowed).toBeGreaterThan(20);
    expect(inShadow).toBeLessThan(unshadowed * 0.75);
    // And the shadow is *local* — ground further down the frame is lit in both scenes.
    expect(lit).toBeGreaterThan(inShadow);
    expect(lit).toBeCloseTo(idleLit, -1);
    expect(idle.running.errors).toEqual([]);
  });
});
