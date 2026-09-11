import { afterEach, describe, expect, it, vi } from "vitest";
import { Color } from "../../src/math/color.js";
import { Camera } from "../../src/render/camera.js";
import { environmentDefinition, EnvironmentAsset } from "../../src/render/environment-asset.js";
import { Environment } from "../../src/render/environment.js";
import { readInstalledEnvironment } from "../../src/render/gpu/environment-install.js";
import { imageProcessingLast } from "../../src/render/gpu/post-process-chain.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createModelAsset } from "../../src/render/model-asset.js";
import { Model } from "../../src/render/model.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { createRenderHarness, warningsOf } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { LiteEnvironmentTextures } from "../../src/lite/gpu/environment.js";
import type { EnvironmentDefinition } from "../../src/render/environment-asset.js";
import type { PostProcessEffectRequest } from "../../src/render/gpu/post-process-chain.js";

/**
 * The `PreRender` render-sync system (`docs/architecture/07-rendering.md` §2,
 * `01-lifecycle-and-time.md` §3 step 6).
 *
 * The headline assertion is the batching one: however many topology changes a frame contains, the
 * system fires exactly one renderable rebuild. `renderer.renderableRebuilds` counts the *intent*,
 * before the headless gate, which is what makes it observable on the null engine.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @param postProcessing - Whether the `postProcessing` rendering feature is declared.
 * @returns The harness.
 */
async function app(postProcessing = false): Promise<RenderHarness> {
  harness = await createRenderHarness(
    postProcessing ? { settings: { rendering: { features: { postProcessing: true } } } } : undefined,
  );
  return harness;
}

/**
 * Registers an environment asset that carries GPU handles, the way a device-backed load would.
 *
 * @remarks
 * The handles are the *identity* the scene's environment slot is asserted against, and nothing in
 * the swap path dereferences them — `installLoadedEnvironment` assigns the field and the render-sync
 * system counts a rebuild — so a headless test can prove the swap without a device. What the
 * browser project proves is the other half: that the slot is the field Lite actually reads
 * (`test/lite/render/environment.browser.test.ts`).
 *
 * @param h - The harness.
 * @param address - The address to register it under.
 * @param definition - Declaration overrides, for the skybox assertions.
 * @returns A retained handle. Release it at the end of the test.
 */
function registerEnvironment(
  h: RenderHarness,
  address: string,
  definition: Partial<EnvironmentDefinition> = {},
): AssetHandle<EnvironmentAsset> {
  // A stand-in for the GPU handle set, asserted on by
  // identity only.
  const textures = {
    sphericalHarmonics: new Float32Array(36),
    lodGenerationScale: 0.8,
  } as unknown as LiteEnvironmentTextures;
  const asset = new EnvironmentAsset(address, environmentDefinition(definition), "brdf-lut.png", textures);
  return h.app.assets.register(asset, { type: "environment" });
}

describe("renderable rebuild batching", () => {
  // The rebuild lands on the frame *after* the one that changed the topology: a mesh added inside
  // the before-render callback only joins its renderable group when Lite drains the material-swap
  // queue at the start of the next frame (`RenderSyncSystem.#rebuildRenderables`). Every count here
  // is therefore read one frame later than the change that earned it.
  it("fires exactly one rebuild for many topology changes in one frame", async () => {
    const h = await app();
    expect(h.renderer.renderableRebuilds).toBe(0);

    for (let index = 0; index < 8; index += 1) {
      h.world.createEntity(`Light${String(index)}`).addComponent(Light);
    }
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(0);
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(1);
  });

  it("fires nothing in a frame where nothing changed", async () => {
    const h = await app();
    h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    h.frame();
    const after = h.renderer.renderableRebuilds;
    expect(after).toBe(1);
    h.frame();
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(after);
  });

  it("fires again when the topology changes a second time", async () => {
    const h = await app();
    h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    h.frame();
    h.world.createEntity("Moon").addComponent(Light);
    h.frame();
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(2);
  });

  it("counts a light kind swap as a topology change", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    h.frame();
    const before = h.renderer.renderableRebuilds;
    light.type = "point";
    h.frame();
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(before + 1);
  });
});

describe("the environment", () => {
  it("applies the winning environment's fog and clear colour, headlessly", async () => {
    const h = await app();
    const environment = h.world.createEntity("Env").addComponent(Environment, {
      clearColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    environment.fog.mode = "linear";
    environment.fog.start = 5;
    environment.fog.end = 50;
    h.frame();
    expect(h.world.lite.scene.clearColor.r).toBeCloseTo(Color.srgbToLinear(1), 6);
    expect(h.world.lite.scene.fog).not.toBeNull();
    expect(h.world.lite.scene.fog?.start).toBe(5);

    environment.fog.mode = "none";
    h.frame();
    expect(h.world.lite.scene.fog).toBeNull();
  });

  it("warns once with IGX-0705 while two are enabled, and the latest wins", async () => {
    const h = await app();
    const first = h.world.createEntity("EnvA").addComponent(Environment, {
      clearColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    const second = h.world.createEntity("EnvB").addComponent(Environment, {
      clearColor: { r: 0, g: 0, b: 1, a: 1 },
    });
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("IGX-0705"))).toHaveLength(1);
    expect(h.world.lite.scene.clearColor.b).toBeCloseTo(Color.srgbToLinear(1), 6);
    expect(second).not.toBe(first);

    second.enabled = false;
    h.frame();
    expect(h.world.lite.scene.clearColor.r).toBeCloseTo(Color.srgbToLinear(1), 6);
  });

  it("records the loaded environment asset and skips the GPU half headlessly", async () => {
    const h = await app();
    const handle = h.app.assets.register(
      new EnvironmentAsset("environments/studio.env", environmentDefinition(), "", null),
      { type: "environment" },
    );
    const environment = h.world.createEntity("Env").addComponent(Environment, { environment: handle });
    h.frame();
    // The asset is recorded even headlessly; what is skipped is the rotation and the blur, which
    // are properties of a cube map a headless load never produced.
    expect(environment.installed).toBe(handle.value);
    handle.release();
  });

  it("installs a different loaded environment, and back again, one rebuild each", async () => {
    const h = await app();
    const a = registerEnvironment(h, "environments/a.env");
    const b = registerEnvironment(h, "environments/b.env");
    const scene = h.world.lite.scene;
    const environment = h.world.createEntity("Env").addComponent(Environment, { environment: a });

    h.frame();
    expect(environment.installed).toBe(a.value);
    expect(readInstalledEnvironment(scene)).toBe(a.value.lite.textures);
    // The rebuild lands on the frame *after* the one that changed the topology, exactly as a mesh's
    // does (`RenderSyncSystem.#rebuildRenderables`).
    h.frame();
    const afterFirst = h.renderer.renderableRebuilds;
    expect(afterFirst).toBe(1);

    environment.environment = b;
    h.frame();
    expect(environment.installed).toBe(b.value);
    expect(readInstalledEnvironment(scene)).toBe(b.value.lite.textures);
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(afterFirst + 1);

    environment.environment = a;
    h.frame();
    h.frame();
    expect(readInstalledEnvironment(scene)).toBe(a.value.lite.textures);
    expect(h.renderer.renderableRebuilds).toBe(afterFirst + 2);

    // Frames that change nothing write nothing and rebuild nothing.
    h.frame();
    h.frame();
    expect(h.renderer.renderableRebuilds).toBe(afterFirst + 2);
    expect(readInstalledEnvironment(scene)).toBe(a.value.lite.textures);
    a.release();
    b.release();
  });

  it("leaves the scene lit when the handle goes back to null", async () => {
    const h = await app();
    const a = registerEnvironment(h, "environments/a.env");
    const scene = h.world.lite.scene;
    const environment = h.world.createEntity("Env").addComponent(Environment, { environment: a });
    h.frame();
    h.frame();
    const rebuilds = h.renderer.renderableRebuilds;

    environment.environment = null;
    h.frame();
    h.frame();
    // Lite has no inverse of `loadEnvironment`, so `null` means "stop steering", not "go dark".
    expect(readInstalledEnvironment(scene)).toBe(a.value.lite.textures);
    expect(environment.installed).toBe(a.value);
    expect(h.renderer.renderableRebuilds).toBe(rebuilds);
    a.release();
  });

  it("logs IGX-0711 once when the skybox record asks for what the environment was not loaded with", async () => {
    const h = await app();
    const handle = registerEnvironment(h, "environments/a.env");
    const environment = h.world.createEntity("Env").addComponent(Environment, {
      environment: handle,
      // The declaration draws a background at its default size; this asks for neither.
      skybox: { enabled: false, size: 400 },
    });
    h.frame();
    h.frame();
    h.frame();
    expect(environment.skybox.enabled).toBe(false);
    expect(warningsOf(h).filter((line) => line.includes("IGX-0711"))).toHaveLength(1);
    handle.release();
  });

  it("says nothing about a skybox record nobody touched, whatever the declaration says", async () => {
    const h = await app();
    // The shape a project that wants no background has: the declaration says so and the component
    // is left alone. Warning here would tell off every such project for doing nothing.
    const off = registerEnvironment(h, "environments/off.env", { skyboxEnabled: false });
    h.world.createEntity("EnvOff").addComponent(Environment, { environment: off });
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("IGX-0711"))).toHaveLength(0);
    off.release();
  });

  it("says nothing about the skybox while the component and the declaration agree", async () => {
    const h = await app();
    const handle = registerEnvironment(h, "environments/a.env", { skyboxEnabled: false });
    h.world.createEntity("Env").addComponent(Environment, {
      environment: handle,
      skybox: { enabled: false, size: 20 },
    });
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("IGX-0711"))).toHaveLength(0);
    handle.release();
  });
});

describe("mesh renderers", () => {
  it("keeps its state and touches no scene when the mesh asset is headless", async () => {
    const h = await app();
    using box = MeshAsset.box(h.app);
    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer, { mesh: box });
    h.frame();
    expect(renderer.lite.mesh).toBeNull();
    expect(renderer.isVisible).toBe(false);
    expect(renderer.mesh?.value).toBe(box.value);
  });

  it("reports no caster change while nothing is drawn", async () => {
    const h = await app();
    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.frame();
    // The frame already consumed the transition from "assumed casting" to "draws nothing".
    expect(renderer.consumeCasterChange()).toBe(false);
    renderer.castShadows = false;
    expect(renderer.consumeCasterChange()).toBe(false);
    const casters: never[] = [];
    renderer.collectCasters(casters);
    expect(casters).toEqual([]);
  });

  it("takes the default material when the materials list is empty", async () => {
    const h = await app();
    h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.frame();
    expect(h.renderer.defaultMaterial().name).toBe("ignifx:default");
  });

  it("accepts a declared material without disturbing the default", async () => {
    const h = await app();
    const material = createMaterialAsset(h.app, pbrMaterialDefinition({ name: "red" }), []);
    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer, { materials: [material] });
    h.frame();
    expect(renderer.materials[0]?.value.name).toBe("red");
    material.release();
  });
});

describe("models", () => {
  it("keeps its fields and reports an empty node map headlessly", async () => {
    const h = await app();
    const handle = h.app.assets.register(createModelAsset("models/hero.glb", null, null), { type: "model" });
    const model = h.world.createEntity("Hero").addComponent(Model, { model: handle });
    h.frame();
    expect(model.lite.root).toBeNull();
    expect(model.nodes.size).toBe(0);
    expect(model.animations).toEqual([]);
    expect(model.skeletons).toEqual([]);
    expect(model.attachToNode("hand.R", h.world.createEntity("Sword"))).toBe(false);
    handle.release();
  });

  it("counts no instance when there is nothing to clone", async () => {
    const h = await app();
    const asset = createModelAsset("models/hero.glb", null, null);
    const handle = h.app.assets.register(asset, { type: "model" });
    h.world.createEntity("Hero").addComponent(Model, { model: handle });
    h.frame();
    expect(asset.instanceCount).toBe(0);
    handle.release();
  });

  // The caster half of the same contract `MeshRenderer` has: a `Model` answers `collectCasters`
  // and `consumeCasterChange`, and the sync system asks it. Headlessly there is no clone, so the
  // answer is "nothing", and it settles after the first frame exactly as a mesh renderer's does.
  // What a real subtree contributes needs a device and is asserted in `shadows.browser.test.ts`.
  it("reports no caster and no caster change while nothing is instantiated", async () => {
    const h = await app();
    const handle = h.app.assets.register(createModelAsset("models/hero.glb", null, null), { type: "model" });
    const model = h.world.createEntity("Hero").addComponent(Model, { model: handle, castShadows: true });
    h.frame();
    expect(model.consumeCasterChange()).toBe(false);
    const casters: never[] = [];
    model.collectCasters(casters);
    expect(casters).toEqual([]);
    model.castShadows = false;
    expect(model.consumeCasterChange()).toBe(false);
    model.collectCasters(casters);
    expect(casters).toEqual([]);
    handle.release();
  });

  it("asks every model for casters when a light starts casting", async () => {
    const h = await app();
    const handle = h.app.assets.register(createModelAsset("models/hero.glb", null, null), { type: "model" });
    const model = h.world.createEntity("Hero").addComponent(Model, { model: handle });
    // The system reaches models through `collectCasters`; that it is called at all is the defect
    // this test pins — before the fix, `#rebuildCasters` walked the world's `MeshRenderer`s only
    // (ADR-0002, "Still outstanding").
    const spy = vi.spyOn(model, "collectCasters");
    h.world.createEntity("Sun").addComponent(Light, { type: "directional" });
    // Two frames: the caster lists are held until the renderable rebuild the light earned has been
    // fired, because Lite's shadow task cannot record a caster whose material family the scene has
    // not registered yet (`RenderSyncSystem.#rebuildCasters`).
    h.frame();
    h.frame();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    handle.release();
  });

  it("rebuilds the caster lists on the frame after a model is destroyed", async () => {
    const h = await app();
    const handle = h.app.assets.register(createModelAsset("models/hero.glb", null, null), { type: "model" });
    const model = h.world.createEntity("Hero").addComponent(Model, { model: handle });
    const mesh = h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.frame();
    h.frame();

    // A settled world rebuilds nothing: the lists are only rebuilt in a frame where the caster set
    // actually moved, because Lite re-preloads the shadow pipeline for every new array it is given.
    const spy = vi.spyOn(mesh, "collectCasters");
    h.frame();
    expect(spy).not.toHaveBeenCalled();

    // Destruction is deferred, and by the time it lands the component is gone from
    // `world.components(Model)` — so `onDetach` raises `renderer.needsCasterRebuild` and the next
    // reconciliation picks it up. Without that flag a destroyed model's meshes would stay in every
    // generator's list.
    model.destroy();
    h.frame();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    handle.release();
  });
});

describe("post-process stacks", () => {
  it("records nothing headlessly, however the effects are configured", async () => {
    const h = await app(true);
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    h.frame();
    expect(stack.taskCount).toBe(0);
  });

  it("plans the chain with image processing last, whatever the order fields say", async () => {
    // Lite's image-processing task writes the swapchain and takes no target, so nothing can read
    // what it produced; the chain moves it to the end rather than recording a broken graph.
    const h = await app(true);
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.imageProcessing.enabled = true;
    stack.imageProcessing.order = -10;
    stack.bloom.enabled = true;
    stack.bloom.order = 0;
    h.frame();
    expect(stack.plannedChain()).toEqual(["imageProcessing", "bloom"]);
    expect(imageProcessingLast(requestsOf(stack)).map((effect) => effect.name)).toEqual(["bloom", "imageProcessing"]);
  });

  it("logs IGX-0710 once when the postProcessing feature is off", async () => {
    const h = await app(false);
    const stack = h.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    h.frame();
    h.frame();
    expect(h.renderer.features.postProcessing).toBe(false);
    expect(stack.taskCount).toBe(0);
    expect(warningsOf(h).filter((line) => line.includes("IGX-0710"))).toHaveLength(1);
  });

  it("says nothing when the feature is off but no effect is enabled", async () => {
    const h = await app(false);
    h.world.createEntity("Eye").addComponent(PostProcessStack);
    h.frame();
    h.frame();
    expect(warningsOf(h).filter((line) => line.includes("IGX-0710"))).toHaveLength(0);
  });
});

/**
 * The effect requests a stack's fields currently ask for, in the component's declared order.
 *
 * @param stack - The component.
 * @returns One request per enabled effect.
 */
function requestsOf(stack: PostProcessStack): readonly PostProcessEffectRequest[] {
  return stack.plannedChain().map((name) => ({
    // The chain only reads `name` for ordering; the tuning records ride along untouched.
    name: name as "bloom" | "smaa" | "imageProcessing",
    bloom: stack.bloom,
    smaa: stack.smaa,
    sourceIsSrgb: false,
  }));
}

describe("counter publication", () => {
  it("reports the component counts of the frame it just reconciled", async () => {
    const h = await app();
    h.world.createEntity("Eye").addComponent(Camera);
    h.world.createEntity("Cube").addComponent(MeshRenderer);
    h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    const group = h.app.diagnostics.group("render");
    expect(group?.get(group.index("renderableRebuilds"))).toBe(h.renderer.renderableRebuilds);
  });
});
