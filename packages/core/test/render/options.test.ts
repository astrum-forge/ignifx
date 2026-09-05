import { afterEach, describe, expect, it } from "vitest";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createModelAsset } from "../../src/render/model-asset.js";
import { Model } from "../../src/render/model.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * The option and field permutations the happy-path suites do not reach: every primitive factory
 * with and without options, an override map with a resolved and an unresolved entry, a light kind
 * with no range or cone, and a post-process chain reordered by its `order` fields.
 *
 * They are separated from the behavioural suites because they prove one thing between them — that
 * an omitted option really is omitted rather than silently defaulted somewhere else — and reading
 * them as a block is how a reviewer checks that quickly.
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

describe("primitive factories", () => {
  it("accepts every primitive with and without options", async () => {
    const h = await app();
    const handles = [
      MeshAsset.box(h.app),
      MeshAsset.box(h.app, { size: 2 }),
      MeshAsset.sphere(h.app),
      MeshAsset.sphere(h.app, { diameter: 2, segments: 8 }),
      MeshAsset.plane(h.app),
      MeshAsset.plane(h.app, { width: 3, height: 4 }),
      MeshAsset.ground(h.app),
      MeshAsset.ground(h.app, { width: 4 }),
      MeshAsset.ground(h.app, { height: 4 }),
      MeshAsset.ground(h.app, { uvScale: [2, 3] }),
      MeshAsset.cylinder(h.app),
      MeshAsset.cylinder(h.app, { height: 2, diameterTop: 0 }),
      MeshAsset.capsule(h.app),
      MeshAsset.capsule(h.app, { height: 2, radius: 0.5 }),
      MeshAsset.torus(h.app),
      MeshAsset.torus(h.app, { diameter: 2, thickness: 0.25 }),
    ];
    for (const handle of handles) {
      expect(handle.value).toBeInstanceOf(MeshAsset);
      handle.release();
    }
  });

  it("accepts raw geometry with and without texture coordinates", async () => {
    const h = await app();
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]);
    const indices = Uint32Array.from([0, 1, 2]);
    using bare = MeshAsset.fromData(h.app, "bare", { positions, normals, indices });
    using textured = MeshAsset.fromData(h.app, "textured", {
      positions,
      normals,
      indices,
      uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
    });
    expect(bare.value.name).toBe("bare");
    expect(textured.value.name).toBe("textured");
  });
});

describe("material override maps", () => {
  it("resolves the entries that loaded and skips the ones that did not", async () => {
    const h = await app();
    const material = createMaterialAsset(h.app, pbrMaterialDefinition({ name: "red" }), []);
    const model = h.app.assets.register(createModelAsset("models/hero.glb", null, null), { type: "model" });
    const component = h.world.createEntity("Hero").addComponent(Model, {
      model,
      materialOverrides: { Body: material, Missing: null },
    });
    h.frame();
    expect(component.materialOverrides["Body"]?.value.name).toBe("red");
    expect(component.materialOverrides["Missing"]).toBeNull();
    material.release();
    model.release();
  });

  it("survives a model whose asset handle never loaded", async () => {
    const h = await app();
    const component = h.world.createEntity("Hero").addComponent(Model);
    h.frame();
    h.frame();
    expect(component.nodes.size).toBe(0);
  });
});

describe("mesh renderers with no asset", () => {
  it("stays inert across frames and reports nothing to draw", async () => {
    const h = await app();
    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.frame();
    h.frame();
    expect(renderer.lite.mesh).toBeNull();
    expect(renderer.isVisible).toBe(false);
  });

  it("re-reads the mesh field when it changes to another asset", async () => {
    const h = await app();
    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer);
    using first = MeshAsset.box(h.app);
    renderer.mesh = first;
    h.frame();
    using second = MeshAsset.sphere(h.app);
    renderer.mesh = second;
    h.frame();
    expect(renderer.mesh.value).toBe(second.value);
  });
});

describe("lights with no range or cone", () => {
  it("leaves the punctual fields alone on a hemispheric light", async () => {
    const h = await app();
    const light = h.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", range: 99, spotAngle: 10 });
    h.frame();
    h.frame();
    expect(light.lite.light?.lightType).toBe("hemispheric");
    expect(Reflect.get(light.lite.light ?? {}, "range")).toBeUndefined();
  });

  it("keeps a directional light out of the range path", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light, { range: 40 });
    h.frame();
    expect(Reflect.get(light.lite.light ?? {}, "range")).toBeUndefined();
  });
});

describe("post-process chain ordering", () => {
  it("plans the chain in the order the effects' order fields ask for", async () => {
    const h = await app();
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    expect(stack.plannedChain()).toEqual([]);

    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    expect(stack.plannedChain()).toEqual(["bloom", "smaa"]);

    stack.smaa.order = -1;
    expect(stack.plannedChain()).toEqual(["smaa", "bloom"]);

    stack.imageProcessing.enabled = true;
    expect(stack.plannedChain()).toEqual(["smaa", "bloom", "imageProcessing"]);
  });

  it("records the plan once and then only enables and disables", async () => {
    const h = await app();
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    h.frame();
    h.frame();
    stack.enabled = false;
    h.frame();
    expect(stack.taskCount).toBe(0);
  });

  it("tears the chain down at detach", async () => {
    const h = await app();
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    h.frame();
    stack.destroy();
    h.frame();
    expect(stack.taskCount).toBe(0);
  });
});
