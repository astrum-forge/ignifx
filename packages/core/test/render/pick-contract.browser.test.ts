import { afterEach, describe, expect, it } from "vitest";
import { Vec3 } from "../../src/math/vec3.js";
import { createRay } from "../../src/render/camera.js";
import { InstancedMeshRenderer } from "../../src/render/instanced-mesh-renderer.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { Model } from "../../src/render/model.js";
import { addCameraAndLight, createBrowserApp, fixtureUrl, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { App } from "../../src/app/types.js";
import type { Entity } from "../../src/entity/entity.js";
import type { Camera } from "../../src/render/camera.js";
import type { ModelAsset } from "../../src/render/model-asset.js";
import type { RenderPick } from "../../src/render/renderer.js";

/**
 * The `app.renderer.pickAsync` contract (`docs/architecture/07-rendering.md` §3, engine ask E3):
 * coordinates are backing-store pixels at every device pixel ratio, a hit on any mesh of a glTF
 * `Model` resolves through the nearest node an entity owns, `ignore` looks through entities,
 * components and earlier hits, and a hit names its mesh, its instance, its point and its distance.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  // The ratio override is an own property shadowing `Window.prototype`'s getter.
  Reflect.deleteProperty(globalThis, "devicePixelRatio");
});

/** The canvas edge, in CSS pixels. */
const CSS_SIZE = 32;

/**
 * Builds a lit app on a canvas `CSS_SIZE` CSS pixels square.
 *
 * @param assets - Whether the manifest carries the `Box.glb` fixture.
 * @returns The running app and its camera.
 */
async function pickApp(assets = false): Promise<{ readonly running: BrowserApp; readonly camera: Camera }> {
  const running = await createBrowserApp({
    size: CSS_SIZE,
    assets: assets ? [{ address: "models/Box.glb", url: fixtureUrl("Box.glb"), type: "model" }] : [],
  });
  harness = running;
  const camera = addCameraAndLight(running, 4);
  return { running, camera };
}

/**
 * Adds a box with a `MeshRenderer`.
 *
 * @param running - The app.
 * @param name - The entity name.
 * @param size - The box edge, in metres.
 * @param z - Its depth; the camera sits at `z = -4` looking down `+Z`.
 * @returns The entity and its renderer.
 */
function addBox(
  running: BrowserApp,
  name: string,
  size: number,
  z: number,
): { readonly entity: Entity; readonly renderer: MeshRenderer } {
  const mesh = MeshAsset.box(running.app, { size });
  const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
  const entity = running.world.createEntity(name);
  entity.transform.localPosition.set(0, 0, z);
  const renderer = entity.addComponent(MeshRenderer, { mesh, materials: [material] });
  return { entity, renderer };
}

/**
 * A translation matrix along the camera's axis, column-major.
 *
 * @param z - The depth.
 * @returns The 16 floats.
 */
function at(z: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];
}

/**
 * Whether two hits name the same mesh, or the same instance of it.
 *
 * @param a - One hit.
 * @param b - The other.
 * @returns `true` for a repeat.
 */
function sameHit(a: RenderPick, b: RenderPick): boolean {
  return a.entity === b.entity && a.meshName === b.meshName && a.thinInstanceIndex === b.thinInstanceIndex;
}

/**
 * The walk-through loop of `skills/ignifx/references/concepts/rendering.md` §7, kept identical.
 *
 * @param app - The app.
 * @param x - The backing-store pixel x.
 * @param y - The backing-store pixel y.
 * @param limit - The most hits to collect.
 * @returns The hits, nearest first.
 */
async function pickAllAt(app: App, x: number, y: number, limit = 8): Promise<RenderPick[]> {
  const hits: RenderPick[] = [];
  while (hits.length < limit) {
    // oxlint-disable-next-line no-await-in-loop -- each pick looks through the ones before it
    const hit = await app.renderer.pickAsync(x, y, { ignore: hits });
    if (hit === null || hits.some((seen) => sameHit(seen, hit))) {
      break;
    }
    hits.push(hit);
  }
  return hits;
}

describe("pickAsync coordinates", () => {
  it("are backing-store pixels at device pixel ratio 2, converted to Lite's CSS pixels inside", async () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    const { running, camera } = await pickApp();
    const box = addBox(running, "Corner", 0.6, 0);
    // Off-centre, so the backing pixel and the same number read as a CSS pixel land apart.
    box.entity.transform.localPosition.set(-1.1, -1.1, 0);
    await running.advance(SETTLE_FRAMES);
    expect(running.canvas.clientWidth).toBe(CSS_SIZE);
    expect(running.canvas.width).toBe(CSS_SIZE * 2);

    const screen = new Vec3();
    expect(camera.worldToScreen(box.entity.transform.position, screen)).toBe(true);
    const half = running.canvas.width / 2;
    // The box sits in one quadrant, well away from the centre, so halving its pixel leaves it.
    expect(Math.min(Math.abs(screen.x - half), Math.abs(screen.y - half))).toBeGreaterThan(half / 3);

    const hit = await running.app.renderer.pickAsync(screen.x, screen.y);
    expect(hit?.entity).toBe(box.entity);
    // The CSS pixel under the same point is half the backing one; passed as backing it misses.
    expect(await running.app.renderer.pickAsync(screen.x / 2, screen.y / 2)).toBeNull();
    // A pick past the backing store's edge misses rather than clamping.
    expect(await running.app.renderer.pickAsync(running.canvas.width + 1, screen.y)).toBeNull();
  });

  it("hit the backing store's corner pixels, at their outer corners", async () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    const { running } = await pickApp();
    const wall = addBox(running, "Wall", 20, 2);
    await running.advance(SETTLE_FRAMES);
    const last = running.canvas.width - 1;
    for (const [x, y] of [
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- picks are serialised anyway
      expect((await running.app.renderer.pickAsync(x, y))?.entity).toBe(wall.entity);
    }
  });
});

describe("pickAsync on a glTF Model", () => {
  /**
   * Loads `Box.glb` onto an entity at the origin.
   *
   * @returns The app, the model's entity and its component.
   */
  async function modelScene(): Promise<{
    readonly running: BrowserApp;
    readonly entity: Entity;
    readonly model: Model;
  }> {
    const { running } = await pickApp(true);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    const entity = running.world.createEntity("Crate");
    const model = entity.addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES * 2);
    return { running, entity, model };
  }

  it("resolves a hit on the model's descendant mesh to the Model's entity and component", async () => {
    const { running, entity, model } = await modelScene();
    const centre = running.canvas.width >> 1;
    const hit = await running.app.renderer.pickAsync(centre, centre);
    expect(hit?.entity).toBe(entity);
    expect(hit?.component).toBe(model);
    expect(hit?.meshName).toMatch(/\S/u);
    expect(hit?.thinInstanceIndex).toBeNull();
    // The unit cube's near face is at z = -0.5, 3.5 m in front of the camera.
    expect(hit?.distance).toBeCloseTo(3.5, 1);
    expect(hit?.point?.[2]).toBeCloseTo(-0.5, 1);
  });

  it("applies the entity filter through the same ancestor walk", async () => {
    const { running, entity } = await modelScene();
    const centre = running.canvas.width >> 1;
    const kept = await running.app.renderer.pickAsync(centre, centre, { filter: (candidate) => candidate === entity });
    expect(kept?.entity).toBe(entity);
    expect(await running.app.renderer.pickAsync(centre, centre, { filter: (candidate) => candidate !== entity })).toBe(
      null,
    );
  });

  it("resolves a render raycast through the model too", async () => {
    const { running, entity, model } = await modelScene();
    const ray = createRay();
    ray.origin.z = -10;
    const hit = running.world.raycastRender(ray);
    expect(hit?.entity).toBe(entity);
    expect(hit?.component).toBe(model);
    expect(running.world.raycastRender(ray, { ignore: [entity] })).toBeNull();
  });
});

describe("pickAsync ignore", () => {
  /**
   * A small box in front of a large one, both under the centre pixel.
   *
   * @returns The app and the two boxes.
   */
  async function stacked(): Promise<{
    readonly running: BrowserApp;
    readonly front: ReturnType<typeof addBox>;
    readonly back: ReturnType<typeof addBox>;
    readonly centre: number;
  }> {
    const { running } = await pickApp();
    const front = addBox(running, "Front", 1, 0);
    const back = addBox(running, "Back", 4, 3);
    await running.advance(SETTLE_FRAMES);
    return { running, front, back, centre: running.canvas.width >> 1 };
  }

  it("looks through an earlier hit, an entity or a component, front to back", async () => {
    const { running, front, back, centre } = await stacked();
    const renderer = running.app.renderer;
    const first = await renderer.pickAsync(centre, centre);
    expect(first?.entity).toBe(front.entity);
    if (first === null) {
      return;
    }
    const second = await renderer.pickAsync(centre, centre, { ignore: [first] });
    expect(second?.entity).toBe(back.entity);
    expect(second?.distance ?? 0).toBeGreaterThan(first.distance);
    if (second === null) {
      return;
    }
    expect(await renderer.pickAsync(centre, centre, { ignore: [first, second] })).toBeNull();
    expect((await renderer.pickAsync(centre, centre, { ignore: [front.entity] }))?.entity).toBe(back.entity);
    expect((await renderer.pickAsync(centre, centre, { ignore: [front.renderer] }))?.entity).toBe(back.entity);
    // `ignore` and `filter` combine.
    expect(
      await renderer.pickAsync(centre, centre, { ignore: [front.entity], filter: (entity) => entity !== back.entity }),
    ).toBeNull();
  });

  it("is honoured by a render raycast", async () => {
    const { running, front, back } = await stacked();
    const ray = createRay();
    ray.origin.z = -10;
    const first = running.world.raycastRender(ray);
    expect(first?.entity).toBe(front.entity);
    if (first === null) {
      return;
    }
    expect(running.world.raycastRender(ray, { ignore: [first] })?.entity).toBe(back.entity);
    expect(running.world.raycastRender(ray, { ignore: [front.renderer] })?.entity).toBe(back.entity);
  });

  it("names the instance an instanced renderer drew, and can skip just that instance", async () => {
    const running = await createBrowserApp({ size: CSS_SIZE, startEmpty: false });
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    addCameraAndLight(running, 4);
    const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    const entity = running.world.createEntity("Stack");
    const instanced = entity.addComponent(InstancedMeshRenderer, {
      mesh: MeshAsset.box(running.app, { size: 1 }),
      materials: [material],
      capacity: 2,
      castShadows: false,
      pickable: true,
    });
    // Instance 0 at z = 2 behind instance 1 at z = 0, both on the camera's axis.
    instanced.setMatrices(
      Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      2,
    );
    await running.start();
    await running.advance(SETTLE_FRAMES);
    const centre = running.canvas.width >> 1;
    const first = await running.app.renderer.pickAsync(centre, centre);
    expect(first?.entity).toBe(entity);
    expect(first?.component).toBe(instanced);
    expect(first?.thinInstanceIndex).toBe(1);
    if (first === null) {
      return;
    }
    const behind = await running.app.renderer.pickAsync(centre, centre, { ignore: [first] });
    expect(behind?.thinInstanceIndex).toBe(0);
    expect(running.errors).toEqual([]);
  });

  it("can return an ignored instance again, and the walk-through loop stops there", async () => {
    const running = await createBrowserApp({ size: CSS_SIZE, startEmpty: false });
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    addCameraAndLight(running, 4);
    const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    const instanced = running.world.createEntity("Row").addComponent(InstancedMeshRenderer, {
      mesh: MeshAsset.box(running.app, { size: 1 }),
      materials: [material],
      capacity: 3,
      castShadows: false,
      pickable: true,
    });
    // Front to back along the camera's axis: instance 0 (z = 0), 2 (z = 2), 1 (z = 4).
    instanced.setMatrices(Float32Array.from([...at(0), ...at(4), ...at(2)]), 3);
    await running.start();
    await running.advance(SETTLE_FRAMES);
    const centre = running.canvas.width >> 1;
    const renderer = running.app.renderer;

    const first = await renderer.pickAsync(centre, centre);
    const second = first === null ? null : await renderer.pickAsync(centre, centre, { ignore: [first] });
    expect([first?.thinInstanceIndex, second?.thinInstanceIndex]).toEqual([0, 2]);
    if (first === null || second === null) {
      return;
    }
    // Instances 0 and 2 are not contiguous: Lite keeps one entry per mesh, so only 0 is skipped.
    const third = await renderer.pickAsync(centre, centre, { ignore: [first, second] });
    expect(third?.thinInstanceIndex).toBe(2);

    const walked = await pickAllAt(running.app, centre, centre);
    expect(walked.map((hit) => hit.thinInstanceIndex)).toEqual([0, 2]);
    expect(running.errors).toEqual([]);
  });
});
