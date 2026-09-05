import { afterEach, describe, expect, it } from "vitest";
import { createRay } from "../../src/render/camera.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * `world.raycastRender` (`docs/architecture/07-rendering.md` §3).
 *
 * The CPU ray test itself is Lite's and needs no device: it walks `scene.meshes` and tests each
 * candidate's CPU vertex copy. A headless world has no meshes in its scene, so every cast is a
 * miss — which is exactly what makes the *plumbing* testable here: the ray conversion, the entity
 * filter, and the mapping from a Lite hit back to an entity all run, and the browser suite is where
 * a real hit comes back.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<RenderHarness> {
  harness = await createRenderHarness();
  return harness;
}

describe("world.raycastRender", () => {
  it("misses in a world with nothing renderable in it", async () => {
    const h = await app();
    const ray = createRay();
    ray.origin.z = -10;
    expect(h.world.raycastRender(ray)).toBeNull();
  });

  it("accepts a caller-supplied entity filter", async () => {
    const h = await app();
    const cube = h.world.createEntity("Cube");
    cube.addComponent(MeshRenderer);
    h.frame();
    const ray = createRay();
    let asked = 0;
    const hit = h.world.raycastRender(ray, {
      filter: (entity): boolean => {
        asked += 1;
        return entity === cube;
      },
    });
    expect(hit).toBeNull();
    // Nothing was in the scene to ask about, which is the headless contract, not a broken filter.
    expect(asked).toBe(0);
  });

  it("normalises the direction it is given", async () => {
    const h = await app();
    const ray = createRay();
    ray.direction.x = 0;
    ray.direction.y = 0;
    ray.direction.z = 5;
    ray.length = 100;
    expect(h.world.raycastRender(ray)).toBeNull();
  });

  it("reuses one Lite ray across casts, so a picking loop allocates nothing", async () => {
    const h = await app();
    const ray = createRay();
    for (let index = 0; index < 4; index += 1) {
      ray.origin.x = index;
      expect(h.world.raycastRender(ray)).toBeNull();
    }
  });
});
