import { afterEach, describe, expect, it } from "vitest";
import { createRay } from "../../src/render/camera.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { Entity } from "../../src/entity/entity.js";

/**
 * GPU picking and CPU ray picking against a real device
 * (`docs/architecture/07-rendering.md` §3, `02-scene-graph.md` §10).
 *
 * What is being proved is the round trip through Lite's node metadata: `MeshRenderer` tags its
 * clone with `{ entity, component }`, Lite hands the picked mesh back, and the renderer resolves
 * those handles to the objects a script holds. `faceId` is deliberately never asserted — it stays
 * `-1` on SwiftShader (ADR-0002 Validation).
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a lit scene with one box at the origin.
 *
 * @returns The running app, the box's entity, and its renderer.
 */
async function buildPickableScene(): Promise<{
  readonly running: BrowserApp;
  readonly cube: Entity;
  readonly renderer: MeshRenderer;
}> {
  const running = await createBrowserApp({ size: 48 });
  harness = running;
  addCameraAndLight(running, 4);
  const mesh = MeshAsset.box(running.app, { size: 2 });
  const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
  const cube = running.world.createEntity("Cube");
  const renderer = cube.addComponent(MeshRenderer, { mesh, materials: [material] });
  await running.advance(SETTLE_FRAMES);
  return { running, cube, renderer };
}

describe("app.renderer.pickAsync", () => {
  it("resolves the centre of the canvas to the entity and the component that drew it", async () => {
    const scene = await buildPickableScene();
    const centre = scene.running.canvas.width >> 1;
    const hit = await scene.running.app.renderer.pickAsync(centre, centre);
    expect(hit?.entity).toBe(scene.cube);
    expect(hit?.component).toBe(scene.renderer);
    expect(hit?.distance).toBeGreaterThan(0);
  });

  it("misses a corner the box does not cover", async () => {
    const scene = await buildPickableScene();
    expect(await scene.running.app.renderer.pickAsync(1, 1)).toBeNull();
  });

  it("honours an entity filter, so a rejected entity neither occludes nor returns", async () => {
    const scene = await buildPickableScene();
    const centre = scene.running.canvas.width >> 1;
    expect(await scene.running.app.renderer.pickAsync(centre, centre, { filter: () => false })).toBeNull();
    const kept = await scene.running.app.renderer.pickAsync(centre, centre, {
      filter: (entity) => entity === scene.cube,
    });
    expect(kept?.entity).toBe(scene.cube);
  });

  it("misses a mesh whose renderer is not pickable", async () => {
    const scene = await buildPickableScene();
    scene.renderer.pickable = false;
    await scene.running.advance(SETTLE_FRAMES);
    const centre = scene.running.canvas.width >> 1;
    expect(await scene.running.app.renderer.pickAsync(centre, centre)).toBeNull();
  });

  it("serialises concurrent picks rather than interleaving them", async () => {
    const scene = await buildPickableScene();
    const centre = scene.running.canvas.width >> 1;
    const hits = await Promise.all([
      scene.running.app.renderer.pickAsync(centre, centre),
      scene.running.app.renderer.pickAsync(centre, centre),
      scene.running.app.renderer.pickAsync(1, 1),
    ]);
    expect(hits[0]?.entity).toBe(scene.cube);
    expect(hits[1]?.entity).toBe(scene.cube);
    expect(hits[2]).toBeNull();
  });
});

describe("world.raycastRender", () => {
  it("hits the box along the camera's own ray and resolves it to the entity", async () => {
    const scene = await buildPickableScene();
    const camera = scene.running.world.mainCamera;
    expect(camera).not.toBeNull();
    const centre = scene.running.canvas.width >> 1;
    const ray = camera?.screenToRay(centre, centre, createRay()) ?? null;
    expect(ray).not.toBeNull();
    if (ray === null) {
      return;
    }
    const hit = scene.running.world.raycastRender(ray);
    expect(hit?.entity).toBe(scene.cube);
    expect(hit?.component).toBe(scene.renderer);
  });

  it("still hits a hidden mesh, which is Lite's documented behaviour", async () => {
    const scene = await buildPickableScene();
    scene.renderer.enabled = false;
    await scene.running.advance(SETTLE_FRAMES);
    const ray = createRay();
    ray.origin.z = -10;
    // §3: visibility is ignored by a CPU pick; only `pickable` and the predicate filter.
    expect(scene.running.world.raycastRender(ray)?.entity).toBe(scene.cube);
  });

  it("misses once the renderer is not pickable", async () => {
    const scene = await buildPickableScene();
    scene.renderer.pickable = false;
    await scene.running.advance(SETTLE_FRAMES);
    const ray = createRay();
    ray.origin.z = -10;
    expect(scene.running.world.raycastRender(ray)).toBeNull();
  });

  it("misses a ray pointing away from everything", async () => {
    const scene = await buildPickableScene();
    const ray = createRay();
    ray.origin.z = -10;
    ray.direction.z = -1;
    expect(scene.running.world.raycastRender(ray)).toBeNull();
  });
});
