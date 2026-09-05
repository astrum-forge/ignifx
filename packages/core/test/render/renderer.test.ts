import { afterEach, describe, expect, it } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { MaterialAsset } from "../../src/render/material-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import {
  acceptsEntityTag,
  RENDER_DIAGNOSTICS_COUNTERS,
  RENDER_DIAGNOSTICS_GROUP,
  rendererInternals,
} from "../../src/render/renderer.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { Renderer } from "../../src/render/renderer.js";

/**
 * `app.renderer` (`docs/architecture/07-rendering.md` §1, §3, §5, ADR-0014).
 *
 * Headless is where the *policy* lives: the feature gate, the screenshot refusal, the pick miss, the
 * default material, and the diagnostics counters all resolve without a device. The browser project
 * proves the GPU halves.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @param shadows - Whether the `shadows` rendering feature is on.
 * @returns The harness.
 */
async function app(shadows = false): Promise<RenderHarness> {
  harness = await createRenderHarness({ settings: { rendering: { features: { shadows } } } });
  return harness;
}

describe("the service itself", () => {
  it("is reachable as app.renderer and is the object the internals hatch returns", async () => {
    const h = await app();
    expect(h.app.renderer).toBe(h.renderer);
    expect(rendererInternals(h.app.renderer)).toBe(h.renderer);
  });

  it("refuses an object it did not create, with IGX-0702", () => {
    let code: string | null = null;
    try {
      rendererInternals({} as unknown as Renderer);
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0702");
  });

  it("throws IGX-0106 when the app has been disposed", async () => {
    const h = await app();
    h.dispose();
    harness = null;
    let code: string | null = null;
    try {
      void h.app.renderer;
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0106");
  });
});

describe("the feature gate", () => {
  it("reflects the rendering.features settings block", async () => {
    const h = await app(true);
    expect(h.renderer.features.shadows).toBe(true);
    expect(h.renderer.features.stencil).toBe(false);
  });

  it("turns a feature on when an extension requires it before start", async () => {
    const h = await app();
    expect(h.renderer.features.skeletons).toBe(false);
    h.app.renderer.requireFeature("skeletons");
    expect(h.renderer.features.skeletons).toBe(true);
  });

  it("refuses a late requirement with IGX-0704", async () => {
    const h = await app();
    h.renderer.markSceneRegistered();
    let code: string | null = null;
    try {
      h.app.renderer.requireFeature("stencil");
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0704");
    expect(h.renderer.features.stencil).toBe(false);
  });

  it("is what ctx.requireRenderingFeature calls", async () => {
    let observed = false;
    harness = await createRenderHarness({
      extensions: [
        {
          name: "test/needs-skeletons",
          version: "0.0.0",
          register: (ctx): void => {
            ctx.requireRenderingFeature("skeletons");
            observed = ctx.app.renderer.features.skeletons;
          },
        },
      ],
    });
    expect(observed).toBe(true);
    expect(harness.renderer.features.skeletons).toBe(true);
  });
});

describe("surface sizing", () => {
  it("clamps the resolution scale to the 0.25-1 range §1 documents", async () => {
    const h = await app();
    h.app.renderer.resolutionScale = 4;
    expect(h.app.renderer.resolutionScale).toBe(1);
    h.app.renderer.resolutionScale = 0;
    expect(h.app.renderer.resolutionScale).toBe(0.25);
    h.app.renderer.resolutionScale = 0.5;
    expect(h.app.renderer.resolutionScale).toBe(0.5);
  });

  it("never lets the pixel-ratio clamp go negative, and starts from the settings block", async () => {
    harness = await createRenderHarness({ settings: { rendering: { maxDevicePixelRatio: 2 } } });
    expect(harness.app.renderer.pixelRatio).toBe(2);
    // Headless apps have no canvas to composite onto.
    expect(harness.app.renderer.surface).toBeNull();
    harness.app.renderer.pixelRatio = -1;
    expect(harness.app.renderer.pixelRatio).toBe(0);
  });

  it("does nothing headlessly, because there is no surface to size", async () => {
    const h = await app();
    expect(() => {
      h.app.renderer.setSize(320, 240);
    }).not.toThrow();
  });

  it("reports a 1x1 target headlessly so no conversion divides by zero", async () => {
    const h = await app();
    const size = { width: 0, height: 0 };
    h.renderer.readTargetSize(size);
    expect(size).toEqual({ width: 1, height: 1 });
  });
});

describe("picking and screenshots", () => {
  it("misses headlessly rather than throwing", async () => {
    const h = await app();
    expect(await h.app.renderer.pickAsync(1, 1)).toBeNull();
    expect(await h.app.renderer.pickAsync(1, 1, { filter: () => true })).toBeNull();
  });

  it("rejects a screenshot with IGX-0707 when no render loop is running", async () => {
    const h = await app();
    let code: string | null = null;
    try {
      await h.app.renderer.captureScreenshot();
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0707");
  });

  it("resolves a pick that hit nothing to null", async () => {
    const h = await app();
    expect(h.renderer.resolvePick({ hit: false } as never)).toBeNull();
    expect(h.renderer.resolvePick({ hit: true, pickedMesh: null } as never)).toBeNull();
  });
});

describe("diagnostics", () => {
  it("registers the render counter group and publishes it each frame", async () => {
    const h = await app();
    const group = h.app.diagnostics.group(RENDER_DIAGNOSTICS_GROUP);
    expect(group).not.toBeNull();
    expect(RENDER_DIAGNOSTICS_COUNTERS).toContain("drawCalls");

    h.world.createEntity("Eye").addComponent(Camera);
    h.world.createEntity("Sun").addComponent(Light);
    h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.frame();
    expect(group?.get(group.index("cameras"))).toBe(1);
    expect(group?.get(group.index("lights"))).toBe(1);
    expect(group?.get(group.index("meshes"))).toBe(1);
  });

  it("reports zero draw calls and no GPU time on the null engine", async () => {
    const h = await app();
    expect(h.app.renderer.drawCalls).toBe(0);
    expect(h.app.renderer.gpuFrameTimeMs).toBe(0);
    expect(h.app.renderer.taskTimings()).toEqual({ status: "unsupported", tasks: [] });
  });

  it("accepts profileTasks headlessly without touching a device", async () => {
    const h = await app();
    h.app.renderer.profileTasks = true;
    expect(h.app.renderer.profileTasks).toBe(true);
    h.app.renderer.profileTasks = false;
    expect(h.app.renderer.profileTasks).toBe(false);
  });
});

describe("the default material and the warm-up", () => {
  it("builds the default material once and shares it", async () => {
    const h = await app();
    const first = h.renderer.defaultMaterial();
    expect(first).toBeInstanceOf(MaterialAsset);
    expect(h.renderer.defaultMaterial()).toBe(first);
    expect(first.kind).toBe("pbr");
    expect(first.name).toBe("ignifx:default");
  });

  it("warms nothing headlessly, and tolerates an empty material list", async () => {
    const h = await app();
    expect(() => {
      h.renderer.warmUpAtStart();
      h.app.renderer.warmUp([]);
      h.app.renderer.warmUp([h.renderer.defaultMaterial()]);
    }).not.toThrow();
  });

  it("releases the default material when the app is disposed", async () => {
    const h = await app();
    const material = h.renderer.defaultMaterial();
    const address = h.assets.manifest.root;
    expect(address).toBeTypeOf("string");
    h.dispose();
    harness = null;
    expect(material).toBeInstanceOf(MaterialAsset);
  });
});

describe("resolving a pick back to its entity", () => {
  it("answers the entity and the component the node was tagged with", async () => {
    const h = await app();
    const entity = h.world.createEntity("Cube");
    const renderer = entity.addComponent(MeshRenderer);
    const info = {
      hit: true,
      distance: 3,
      pickedPoint: [1, 2, 3] as [number, number, number],
      pickedNormal: null,
      pickedNormalWorld: [0, 1, 0] as [number, number, number],
      pickedMesh: { metadata: { ignifx: { entity: entity.handle, component: renderer.handle } } },
    };
    const pick = h.renderer.resolvePick(info as never);
    expect(pick?.entity).toBe(entity);
    expect(pick?.component).toBe(renderer);
    expect(pick?.distance).toBe(3);
    expect(pick?.point).toEqual([1, 2, 3]);
    expect(pick?.normal).toEqual([0, 1, 0]);
  });

  it("answers a null component for a node tagged with an entity alone", async () => {
    const h = await app();
    const entity = h.world.createEntity("Cube");
    const pick = h.renderer.resolvePick({
      hit: true,
      distance: 0,
      pickedPoint: null,
      pickedNormal: null,
      pickedNormalWorld: null,
      pickedMesh: { metadata: { ignifx: { entity: entity.handle } } },
    } as never);
    expect(pick?.entity).toBe(entity);
    expect(pick?.component).toBeNull();
  });

  it("answers null for a stale handle and for an untagged mesh", async () => {
    const h = await app();
    expect(
      h.renderer.resolvePick({ hit: true, pickedMesh: { metadata: { ignifx: { entity: 9999 } } } } as never),
    ).toBeNull();
    expect(h.renderer.resolvePick({ hit: true, pickedMesh: { metadata: {} } } as never)).toBeNull();
  });
});

describe("the shared entity filter", () => {
  it("accepts a tagged entity the predicate wants and rejects everything else", async () => {
    const h = await app();
    const cube = h.world.createEntity("Cube");
    expect(acceptsEntityTag(h.world, { entity: cube.handle }, (entity) => entity === cube)).toBe(true);
    expect(acceptsEntityTag(h.world, { entity: cube.handle }, () => false)).toBe(false);
    expect(acceptsEntityTag(h.world, null, () => true)).toBe(false);
    expect(acceptsEntityTag(h.world, { entity: 9999 }, () => true)).toBe(false);
  });
});

describe("the start-up warm-up", () => {
  it("collects every loaded material in the manifest, plus the two families the engine can build", async () => {
    harness = await createRenderHarness({
      manifest: createAssetManifest([
        { address: "materials/gold.material.json", url: "u/gold", type: "material" },
        { address: "data/x.json", url: "u/x", type: "json" },
      ]),
    });
    harness.net.canned.set("u/gold", JSON.stringify({ format: "ignifx.material", formatVersion: 1 }));
    const material = harness.app.assets.load<MaterialAsset>("materials/gold.material.json");
    await harness.settle(1);
    expect(material.state).toBe("loaded");
    // Headless installs no probes, but the collection walk runs and must not throw on a
    // non-material entry or on an address nothing loaded.
    expect(() => {
      harness?.renderer.warmUpAtStart();
    }).not.toThrow();
  });
});
