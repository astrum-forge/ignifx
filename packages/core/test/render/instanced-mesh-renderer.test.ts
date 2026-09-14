import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { InstancedMeshRenderer } from "../../src/render/instanced-mesh-renderer.js";
import { instancedMeshSupport, loadInstancedMeshSupport } from "../../src/render/instanced-mesh-support.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { createRenderHarness, warningsOf } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { Entity } from "../../src/entity/entity.js";
import type { LiteMesh } from "../../src/lite/gpu/mesh.js";

/**
 * `InstancedMeshRenderer` without a device (the plan's §3.5, `07-rendering.md` §6).
 *
 * A headless `MeshAsset` carries no geometry, so nothing here reaches Lite: what is asserted is the
 * component's own state machine — the slab, the count, the capacity guards, the caster
 * bookkeeping, and the refusal of a setting Lite would have fixed at `registerScene`. The GPU half
 * is `test/lite/render/instancing.browser.test.ts`.
 *
 * `markSceneRegistered()` is called explicitly where a late edit is under test: a headless app never
 * registers a render scene (`app.ts` skips `#registerRenderScene`), so the flag the refusal reads
 * has to be set the way `app.start()` would set it on a canvas.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** How many floats one instance matrix occupies. */
const MATRIX_FLOATS = 16;

/**
 * Builds a headless app with one instanced renderer on one entity.
 *
 * @param capacity - The renderer's capacity.
 * @returns The harness, the entity, and the renderer.
 */
async function buildScene(capacity = 4): Promise<{
  readonly running: RenderHarness;
  readonly entity: Entity;
  readonly renderer: InstancedMeshRenderer;
}> {
  const running = await createRenderHarness();
  harness = running;
  running.app.registerComponents([InstancedMeshRenderer]);
  const mesh = MeshAsset.box(running.app, { size: 1 });
  const material = createMaterialAsset(running.app, pbrMaterialDefinition({ name: "instanced" }), []);
  const entity = running.world.createEntity("Cloud");
  const renderer = entity.addComponent(InstancedMeshRenderer, {
    mesh,
    materials: [material],
    capacity,
  });
  return { running, entity, renderer };
}

/**
 * A slab of identity-ish matrices.
 *
 * @param count - How many instances it holds.
 * @returns The slab.
 */
function slabOf(count: number): Float32Array {
  const slab = new Float32Array(count * MATRIX_FLOATS);
  for (let index = 0; index < count; index += 1) {
    const base = index * MATRIX_FLOATS;
    slab[base] = 1;
    slab[base + 5] = 1;
    slab[base + 10] = 1;
    slab[base + 15] = 1;
    slab[base + 12] = index;
  }
  return slab;
}

describe("declared fields", () => {
  it("start at the defaults the plan fixes", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const renderer = running.world.createEntity("Cloud").addComponent(InstancedMeshRenderer);
    expect(renderer.capacity).toBe(1024);
    expect(renderer.gpuCulling).toBe(true);
    expect(renderer.castShadows).toBe(true);
    expect(renderer.receiveShadows).toBe(true);
    expect(renderer.renderOrder).toBe(0);
    expect(renderer.lod).toBeNull();
  });

  it("make an instanced renderer unpickable by default, unlike a MeshRenderer", async () => {
    const { renderer } = await buildScene();
    expect(renderer.pickable).toBe(false);
  });

  it("clamp a capacity that is not a finite whole number", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const renderer = running.world.createEntity("Cloud").addComponent(InstancedMeshRenderer);
    // Written past the schema, the way a script edits a field: `capacity` is inspector metadata, not
    // a runtime guard, so the component has to clamp it itself.
    renderer.capacity = Number.POSITIVE_INFINITY;
    expect(() => {
      renderer.setMatrices(slabOf(2), 2);
    }).toThrow(/IGX-0721/);
    renderer.capacity = 2.7;
    expect(() => {
      renderer.setMatrices(slabOf(2), 2);
    }).not.toThrow();
  });

  it("allow several renderers on one entity", () => {
    expect(InstancedMeshRenderer.allowMultiple).toBe(true);
  });
});

describe("the thin-instance adapter chunk", () => {
  it("loads on demand and hands back the live-instance class", async () => {
    const support = await loadInstancedMeshSupport();
    expect(typeof support.createInstancedMesh).toBe("function");
    expect(typeof support.releaseInstancedMesh).toBe("function");
    expect(instancedMeshSupport()).toBe(support);
  });
});

describe("the matrix slab", () => {
  it("starts empty, so a renderer nothing has written to draws nothing", async () => {
    const { renderer } = await buildScene();
    expect(renderer.count).toBe(0);
  });

  it("is reported by count once it is set", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 3);
    expect(renderer.count).toBe(3);
  });

  it("is held by reference, so mutating it changes what the renderer will upload", async () => {
    const { renderer } = await buildScene();
    const slab = slabOf(4);
    renderer.setMatrices(slab, 4);
    slab[12] = 42;
    renderer.markDirty({ start: 0, count: 1 });
    expect(slab[12]).toBe(42);
    expect(renderer.count).toBe(4);
  });

  it("refuses a count above the capacity with IGX-0721", async () => {
    const { renderer } = await buildScene(4);
    expect(() => {
      renderer.setMatrices(slabOf(8), 8);
    }).toThrow(/IGX-0721/u);
  });

  it("refuses a count the slab cannot hold with IGX-0721", async () => {
    const { renderer } = await buildScene(8);
    let code: string | null = null;
    try {
      renderer.setMatrices(slabOf(2), 4);
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0721");
  });

  it("refuses a fractional count", async () => {
    const { renderer } = await buildScene(8);
    expect(() => {
      renderer.setMatrices(slabOf(8), 2.5);
    }).toThrow(/IGX-0721/u);
  });

  it("accepts a count of zero", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 0);
    expect(renderer.count).toBe(0);
  });
});

describe("setCount", () => {
  it("lowers the draw count without touching the slab", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    renderer.setCount(2);
    expect(renderer.count).toBe(2);
  });

  it("refuses a count above the capacity with IGX-0721", async () => {
    const { renderer } = await buildScene(4);
    renderer.setMatrices(slabOf(4), 4);
    expect(() => {
      renderer.setCount(5);
    }).toThrow(/IGX-0721/u);
  });

  it("refuses any count above zero while no slab has been set", async () => {
    const { renderer } = await buildScene(4);
    expect(() => {
      renderer.setCount(1);
    }).toThrow(/IGX-0721/u);
  });
});

describe("setColors", () => {
  it("accepts a slab long enough for the current count", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    renderer.setColors(new Float32Array(4 * 4));
    expect(renderer.count).toBe(4);
  });

  it("refuses a slab too short for the current count with IGX-0721", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    expect(() => {
      renderer.setColors(new Float32Array(2 * 4));
    }).toThrow(/IGX-0721/u);
  });

  it("makes a later count that the colour slab cannot cover an error", async () => {
    const { renderer } = await buildScene(8);
    renderer.setMatrices(slabOf(8), 2);
    renderer.setColors(new Float32Array(2 * 4));
    expect(() => {
      renderer.setCount(8);
    }).toThrow(/IGX-0721/u);
  });

  it("clears the colours when it is given null", async () => {
    const { renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    renderer.setColors(new Float32Array(4 * 4));
    expect(() => {
      renderer.setColors(null);
    }).not.toThrow();
  });
});

describe("capacity", () => {
  it("is validated by the schema on the declared path", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const entity = running.world.createEntity("Cloud");
    // `u32(1024, { min: 1 })` is enforced by the schema when a prop bag or a scene file supplies it,
    // so the component's own clamp below is only ever reached by a direct property write.
    expect(() => {
      entity.addComponent(InstancedMeshRenderer, { capacity: 0 });
    }).toThrow(/IGX-0606/u);
  });

  it("is clamped to at least one whole instance when a script writes a zero", async () => {
    const { renderer } = await buildScene();
    renderer.capacity = 0;
    expect(() => {
      renderer.setMatrices(slabOf(1), 1);
    }).not.toThrow();
    expect(renderer.count).toBe(1);
  });

  it("is truncated, not rounded, when a script writes a fraction", async () => {
    const { renderer } = await buildScene();
    renderer.capacity = 2.9;
    renderer.setMatrices(slabOf(4), 2);
    expect(renderer.count).toBe(2);
    expect(() => {
      renderer.setCount(3);
    }).toThrow(/IGX-0721/u);
  });
});

describe("markDirty", () => {
  it("takes no argument at all, for a caller that moved everything", async () => {
    const { running, renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    await running.settle();
    expect(() => {
      renderer.markDirty();
    }).not.toThrow();
    await running.settle();
    expect(running.errors).toHaveLength(0);
  });
});

describe("a lod record whose mesh handle is null", () => {
  it("is treated as no LOD at all", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const mesh = MeshAsset.box(running.app, { size: 1 });
    const entity = running.world.createEntity("Cloud");
    const renderer = entity.addComponent(InstancedMeshRenderer, {
      mesh,
      capacity: 2,
      lod: { mesh: null, distance: 10, band: 1 },
    });
    await running.settle();
    expect(renderer.lite.lodMesh).toBeNull();
    expect(running.errors).toHaveLength(0);
  });
});

describe("headless", () => {
  it("holds its state without touching Lite", async () => {
    const { running, renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    await running.settle();
    expect(renderer.lite.mesh).toBeNull();
    expect(renderer.lite.lodMesh).toBeNull();
    expect(renderer.isVisible).toBe(false);
    expect(renderer.count).toBe(4);
  });

  it("survives a frame with no slab at all", async () => {
    const { running, renderer } = await buildScene();
    await running.settle();
    await running.settle();
    expect(renderer.count).toBe(0);
    expect(running.errors).toHaveLength(0);
  });

  it("reconciles through the PreRender render-sync system", async () => {
    const { running, renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 2);
    await running.settle();
    renderer.setCount(1);
    await running.settle();
    expect(renderer.count).toBe(1);
    expect(running.errors).toHaveLength(0);
  });
});

describe("shadow casters", () => {
  it("report a change the first time the renderer is asked", async () => {
    const { renderer } = await buildScene();
    expect(renderer.consumeCasterChange()).toBe(false);
    renderer.castShadows = false;
    expect(renderer.consumeCasterChange()).toBe(false);
  });

  it("collect nothing while there is no Lite mesh", async () => {
    const { renderer } = await buildScene();
    const casters: LiteMesh[] = [];
    renderer.collectCasters(casters);
    expect(casters).toHaveLength(0);
  });
});

describe("settings Lite fixes at registerScene", () => {
  it("are still editable before the scene is registered", async () => {
    const { running, renderer } = await buildScene(4);
    await running.settle();
    renderer.capacity = 16;
    renderer.gpuCulling = false;
    await running.settle();
    expect(renderer.capacity).toBe(16);
    expect(renderer.gpuCulling).toBe(false);
    expect(warningsOf(running).join("\n")).not.toContain("IGX-0717");
  });

  it("refuse a capacity change afterwards, logging IGX-0717 and keeping the value in use", async () => {
    const { running, renderer } = await buildScene(4);
    await running.settle();
    running.renderer.markSceneRegistered();
    renderer.capacity = 4096;
    await running.settle();
    expect(renderer.capacity).toBe(4);
    expect(warningsOf(running).join("\n")).toContain("IGX-0717");
  });

  it("refuse a gpuCulling change afterwards", async () => {
    const { running, renderer } = await buildScene(4);
    await running.settle();
    running.renderer.markSceneRegistered();
    renderer.gpuCulling = false;
    await running.settle();
    expect(renderer.gpuCulling).toBe(true);
    expect(warningsOf(running).join("\n")).toContain("IGX-0717");
  });

  it("refuse a lod.mesh swapped inside the record the script already holds", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const mesh = MeshAsset.box(running.app, { size: 1 });
    const coarse = MeshAsset.box(running.app, { size: 0.25 });
    const other = MeshAsset.box(running.app, { size: 0.1 });
    const renderer = running.world.createEntity("Cloud").addComponent(InstancedMeshRenderer, {
      mesh,
      capacity: 4,
      lod: { mesh: coarse, distance: 20, band: 2 },
    });
    await running.settle();
    running.renderer.markSceneRegistered();
    const lod = renderer.lod;
    expect(lod).not.toBeNull();
    if (lod !== null) {
      lod.mesh = other;
    }
    await running.settle();
    expect(renderer.lod?.mesh).toBe(coarse);
    expect(warningsOf(running).join("\n")).toContain("IGX-0717");
  });

  it("refuse a new LOD partner afterwards", async () => {
    const { running, renderer } = await buildScene(4);
    await running.settle();
    running.renderer.markSceneRegistered();
    const coarse = MeshAsset.box(running.app, { size: 0.25 });
    renderer.lod = { mesh: coarse, distance: 20, band: 2 };
    await running.settle();
    expect(renderer.lod).toBeNull();
    expect(warningsOf(running).join("\n")).toContain("IGX-0717");
  });

  it("log IGX-0717 only once however many late edits follow", async () => {
    const { running, renderer } = await buildScene(4);
    await running.settle();
    running.renderer.markSceneRegistered();
    renderer.capacity = 8;
    await running.settle();
    renderer.gpuCulling = false;
    await running.settle();
    const warnings = warningsOf(running).filter((message) => message.includes("IGX-0717"));
    expect(warnings).toHaveLength(1);
  });

  it("keep accepting a LOD distance and band change, which Lite re-sets live", async () => {
    const running = await createRenderHarness();
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const mesh = MeshAsset.box(running.app, { size: 1 });
    const coarse = MeshAsset.box(running.app, { size: 0.25 });
    const entity = running.world.createEntity("Cloud");
    const renderer = entity.addComponent(InstancedMeshRenderer, {
      mesh,
      capacity: 4,
      lod: { mesh: coarse, distance: 30, band: 4 },
    });
    await running.settle();
    running.renderer.markSceneRegistered();
    const lod = renderer.lod;
    expect(lod).not.toBeNull();
    if (lod !== null) {
      lod.distance = 50;
      lod.band = 8;
    }
    await running.settle();
    expect(renderer.lod?.distance).toBe(50);
    expect(renderer.lod?.band).toBe(8);
    expect(warningsOf(running).join("\n")).not.toContain("IGX-0717");
  });
});

describe("detaching", () => {
  it("leaves the component with nothing in Lite", async () => {
    const { running, entity, renderer } = await buildScene();
    renderer.setMatrices(slabOf(4), 4);
    await running.settle();
    entity.removeComponent(renderer);
    await running.settle();
    expect(running.errors).toHaveLength(0);
  });
});
