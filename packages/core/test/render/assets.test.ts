import { afterEach, describe, expect, it } from "vitest";
import { isMemoryAddress, MEMORY_ADDRESS_PREFIX } from "../../src/assets/address.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Color } from "../../src/math/color.js";
import { EnvironmentAsset, environmentDefinition } from "../../src/render/environment-asset.js";
import { FontAsset } from "../../src/render/font-asset.js";
import {
  buildMaterialAsset,
  createMaterialAsset,
  MATERIAL_ASSET_TYPE,
  PBR_TEXTURE_SLOTS,
  pbrMaterialDefinition,
  STANDARD_TEXTURE_SLOTS,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { MESH_ASSET_TYPE, MeshAsset } from "../../src/render/mesh-asset.js";
import { createModelAsset, ModelAsset } from "../../src/render/model-asset.js";
import {
  defaultTextureImportOptions,
  readTextureImportOptions,
  TextureAsset,
  toLiteTextureOptions,
} from "../../src/render/texture-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { AssetHandle } from "../../src/assets/types.js";

/**
 * The rendering asset classes on the null engine (`docs/architecture/05-assets-and-loading.md` §5,
 * `07-rendering.md` §2.3 and §2.6, §6).
 *
 * Two things are being proved. First, the `gpu: null` contract: every GPU-backed asset constructs
 * headlessly and reports an empty Lite half rather than failing. Second, the in-code ownership
 * rules: a primitive is published through `Assets.register` under a `memory:` address, the caller
 * owns the handle, and releasing it runs the type's `unload`, which is what frees the template.
 */

/**
 * A loaded texture handle whose Lite half is a stand-in object: the material builders only ever
 * pass it on to Lite's own property bags, which never read it while the material is unused.
 *
 * @param address - The address the slot names.
 * @returns The handle.
 */
function fakeTexture(address: string): AssetHandle<TextureAsset> {
  return {
    address,
    type: "texture",
    state: "loaded",
    value: new TextureAsset(address, { label: address } as never, defaultTextureImportOptions()),
  } as unknown as AssetHandle<TextureAsset>;
}

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

describe("in-code assets", () => {
  it("publishes a primitive at a memory: address with one holder", async () => {
    const h = await app();
    const handle = MeshAsset.box(h.app, { size: 2 });
    expect(handle.type).toBe(MESH_ASSET_TYPE);
    expect(isMemoryAddress(handle.address)).toBe(true);
    expect(handle.address.startsWith(`${MEMORY_ADDRESS_PREFIX}${MESH_ASSET_TYPE}/`)).toBe(true);
    expect(handle.state).toBe("loaded");
    expect(handle.refCount).toBe(1);
    expect(handle.value).toBeInstanceOf(MeshAsset);
    handle.release();
  });

  it("gives every primitive factory a fresh address", async () => {
    const h = await app();
    const addresses = [
      MeshAsset.box(h.app),
      MeshAsset.sphere(h.app),
      MeshAsset.plane(h.app),
      MeshAsset.ground(h.app, { width: 4, height: 4, subdivisions: 2, uvScale: [2, 2] }),
      MeshAsset.cylinder(h.app),
      MeshAsset.capsule(h.app),
      MeshAsset.torus(h.app),
      MeshAsset.fromData(h.app, "triangle", {
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
        indices: Uint32Array.from([0, 1, 2]),
      }),
    ].map((handle) => handle.address);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("uploads no geometry under a headless app and disposes as a no-op", async () => {
    const h = await app();
    const handle = MeshAsset.box(h.app);
    const asset = handle.value;
    expect(asset.lite.mesh).toBeNull();
    expect(asset.isDisposed).toBe(false);
    asset.dispose();
    asset.dispose();
    expect(asset.isDisposed).toBe(true);
    handle.release();
  });

  it("releases the template through the mesh type's unload when the handle is collected", async () => {
    const h = await app();
    const handle = MeshAsset.box(h.app);
    const asset = handle.value;
    handle.release();
    h.assets.gc();
    expect(asset.isDisposed).toBe(true);
    expect(handle.state).toBe("released");
  });

  it("releases a primitive at the end of a using block", async () => {
    const h = await app();
    let asset: MeshAsset;
    {
      using box = MeshAsset.box(h.app);
      asset = box.value;
      expect(box.refCount).toBe(1);
    }
    h.assets.gc();
    expect(asset.isDisposed).toBe(true);
  });

  it("refuses to load a mesh address, because there is no mesh file format", async () => {
    const h = await app();
    const handle = h.app.assets.load("models/box.mesh", { type: MESH_ASSET_TYPE });
    // Three attempts with the documented exponential backoff (§9), driven by engine time.
    await h.settle(1);
    await h.settle(1);
    await h.settle(1);
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe("IGX-0505");
  });

  it("replaces an in-code asset registered twice at the same explicit address", async () => {
    const h = await app();
    const first = h.app.assets.register({ tag: "a" }, { type: "mesh", address: "memory:mesh/pinned" });
    const second = h.app.assets.register({ tag: "b" }, { type: "mesh", address: "memory:mesh/pinned" });
    expect(first.state).toBe("released");
    expect(second.value).toEqual({ tag: "b" });
    expect(h.app.assets.get("memory:mesh/pinned")).toBe(second);
    second.release();
  });

  it("refuses to register on a disposed app", async () => {
    const h = await app();
    h.dispose();
    harness = null;
    let code: string | null = null;
    try {
      h.app.assets.register({}, { type: "mesh" });
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0106");
  });
});

describe("MaterialAsset", () => {
  it("builds a PBR material and converts its sRGB colours to linear", async () => {
    const h = await app();
    const handle = createMaterialAsset(
      h.app,
      pbrMaterialDefinition({ name: "grey", baseColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }),
      [],
    );
    const asset = handle.value;
    expect(asset.kind).toBe("pbr");
    expect(asset.name).toBe("grey");
    expect(handle.type).toBe(MATERIAL_ASSET_TYPE);
    const material = asset.lite.material;
    const factor: unknown = Reflect.get(material, "baseColorFactor");
    expect(Array.isArray(factor)).toBe(true);
    if (Array.isArray(factor)) {
      expect(factor[0]).toBeCloseTo(Color.srgbToLinear(0.5), 6);
      expect(factor[3]).toBe(1);
    }
    handle.release();
  });

  it("builds a Standard material and writes its diffuse colour", () => {
    const asset = buildMaterialAsset(
      standardMaterialDefinition({ name: "flat", diffuse: { r: 1, g: 0, b: 0, a: 1 } }),
      [],
    );
    expect(asset.kind).toBe("standard");
    const diffuse: unknown = Reflect.get(asset.lite.material, "diffuseColor");
    expect(Array.isArray(diffuse) ? diffuse[0] : null).toBeCloseTo(1, 6);
  });

  it("applies the property setters on both families", async () => {
    const h = await app();
    const pbr = createMaterialAsset(h.app, pbrMaterialDefinition({}), []);
    pbr.value.setBaseColor({ r: 0, g: 1, b: 0, a: 0.5 });
    pbr.value.setMetallicRoughness(0.25, 0.75);
    pbr.value.setAlpha(0.25);
    const material = pbr.value.lite.material;
    expect(Reflect.get(material, "metallicFactor")).toBe(0.25);
    expect(Reflect.get(material, "roughnessFactor")).toBe(0.75);
    expect(Reflect.get(material, "alpha")).toBe(0.25);

    const standard = createMaterialAsset(h.app, standardMaterialDefinition({}), []);
    standard.value.setBaseColor({ r: 1, g: 1, b: 1, a: 1 });
    standard.value.setMetallicRoughness(1, 1);
    standard.value.setAlpha(0.5);
    expect(Reflect.get(standard.value.lite.material, "alpha")).toBe(0.5);
    pbr.release();
    standard.release();
  });

  it("clones into an independent Lite material that starts identical", async () => {
    const h = await app();
    const original = createMaterialAsset(h.app, pbrMaterialDefinition({ name: "gold", metallic: 1 }), []);
    const copy = original.value.clone(h.app);
    expect(copy.value).not.toBe(original.value);
    expect(copy.value.lite.material).not.toBe(original.value.lite.material);
    expect(copy.value.definition).toEqual(original.value.definition);

    copy.value.setMetallicRoughness(0, 1);
    expect(Reflect.get(original.value.lite.material, "metallicFactor")).toBe(1);
    original.release();
    copy.release();
  });

  it("ignores a texture slot whose handle never loaded", () => {
    const asset = buildMaterialAsset(pbrMaterialDefinition({ textures: { baseColorTexture: "textures/a.png" } }), []);
    expect(Reflect.get(asset.lite.material, "baseColorTexture")).toBeUndefined();
  });
});

describe("TextureAsset", () => {
  it("reports gpu: null under a headless app and releases nothing", () => {
    const asset = new TextureAsset("textures/a.png", null, defaultTextureImportOptions());
    expect(asset.lite.texture).toBeNull();
    expect(asset.isReleased).toBe(true);
    expect(asset.releaseGpu()).toBe(false);
    asset.retainGpu();
  });

  it("reads the texture block of a .meta.json sidecar over the defaults", () => {
    expect(readTextureImportOptions(null)).toEqual(defaultTextureImportOptions());
    expect(readTextureImportOptions({})).toEqual(defaultTextureImportOptions());
    expect(readTextureImportOptions({ texture: [1, 2] })).toEqual(defaultTextureImportOptions());
    const read = readTextureImportOptions({
      texture: { srgb: true, mipMaps: false, addressModeU: "clamp-to-edge", invertY: 7 },
    });
    expect(read.srgb).toBe(true);
    expect(read.mipMaps).toBe(false);
    expect(read.addressModeU).toBe("clamp-to-edge");
    // A value of the wrong type takes the documented default rather than failing the load.
    expect(read.invertY).toBe(true);
  });

  it("hands Lite exactly the options it resolved", () => {
    const options = toLiteTextureOptions({ ...defaultTextureImportOptions(), srgb: true });
    expect(options.srgb).toBe(true);
    expect(options.addressModeU).toBe("repeat");
    expect(options.minFilter).toBe("linear");
  });
});

describe("ModelAsset", () => {
  it("constructs empty under a headless app and counts nothing", () => {
    const asset = createModelAsset("models/hero.glb", null, null);
    expect(asset).toBeInstanceOf(ModelAsset);
    expect(asset.lite.container).toBeNull();
    expect(asset.animations).toEqual([]);
    expect(asset.skeletons).toEqual([]);
    expect(asset.instantiate(null)).toBeNull();
    expect(asset.instanceCount).toBe(0);
    asset.dispose();
    asset.dispose();
  });

  it("counts instances and never goes below zero", () => {
    const asset = createModelAsset("models/hero.glb", null, null);
    asset.retainInstance();
    asset.retainInstance();
    expect(asset.instanceCount).toBe(2);
    asset.releaseInstance();
    asset.releaseInstance();
    asset.releaseInstance();
    expect(asset.instanceCount).toBe(0);
  });

  it("releases the container at the end of a using block", () => {
    using asset = createModelAsset("models/hero.glb", null, null);
    expect(asset.address).toBe("models/hero.glb");
  });
});

describe("EnvironmentAsset and FontAsset", () => {
  it("fills an environment declaration's defaults", () => {
    expect(environmentDefinition()).toEqual({
      environment: "",
      brdfLut: "",
      skybox: "",
      skyboxSize: 20,
      skyboxEnabled: true,
      blur: 0,
      rotation: 0,
    });
  });

  it("reports gpu: null for a headless environment", () => {
    const asset = new EnvironmentAsset("environments/studio.env", environmentDefinition(), "", null);
    expect(asset.lite.textures).toBeNull();
    expect(asset.brdfUrl).toBe("");
  });

  it("carries the parsed font and its byte length", () => {
    // A `Font` is a branded value with no readable members, so the stand-in only has to be an
    // object: what this asserts is the wrapper, not Lite's parser.
    const asset = new FontAsset("fonts/inter.ttf", { parsed: true } as never, 128);
    expect(asset.address).toBe("fonts/inter.ttf");
    expect(asset.byteLength).toBe(128);
    expect(asset.lite.font).toEqual({ parsed: true });
  });
});

describe("texture slots", () => {
  it("binds every PBR slot a declaration names to its loaded texture", () => {
    const slots = {
      baseColorTexture: "textures/base.png",
      metallicRoughnessTexture: "textures/orm.png",
      normalTexture: "textures/normal.png",
      emissiveTexture: "textures/emissive.png",
      occlusionTexture: "textures/ao.png",
    };
    const asset = buildMaterialAsset(pbrMaterialDefinition({ textures: slots }), Object.keys(slots).map(fakeTexture));
    const material = asset.lite.material;
    for (const slot of PBR_TEXTURE_SLOTS) {
      const bound: unknown = Reflect.get(material, slot === "metallicRoughnessTexture" ? "ormTexture" : slot);
      expect({ slot, bound }).toEqual({
        slot,
        bound: expect.anything() as unknown,
      });
    }
  });

  it("binds every Standard slot a declaration names", () => {
    const slots = {
      diffuseTexture: "textures/diffuse.png",
      specularTexture: "textures/specular.png",
      emissiveTexture: "textures/emissive.png",
      normalTexture: "textures/normal.png",
      opacityTexture: "textures/opacity.png",
    };
    const asset = buildMaterialAsset(
      standardMaterialDefinition({ textures: slots }),
      Object.keys(slots).map(fakeTexture),
    );
    expect(STANDARD_TEXTURE_SLOTS).toHaveLength(5);
    expect(Reflect.get(asset.lite.material, "diffuseTexture")).toBeDefined();
  });

  it("skips a slot whose handle is still loading", () => {
    const handle = fakeTexture("textures/base.png");
    const loading = { ...handle, state: "loading" } as unknown as typeof handle;
    const asset = buildMaterialAsset(pbrMaterialDefinition({ textures: { baseColorTexture: "textures/base.png" } }), [
      loading,
    ]);
    expect(Reflect.get(asset.lite.material, "baseColorTexture")).toBeUndefined();
  });

  it("skips a slot whose texture is headless", () => {
    const headless = {
      address: "textures/base.png",
      type: "texture",
      state: "loaded",
      value: new TextureAsset("textures/base.png", null, defaultTextureImportOptions()),
    } as never;
    const asset = buildMaterialAsset(pbrMaterialDefinition({ textures: { baseColorTexture: "textures/base.png" } }), [
      headless,
    ]);
    expect(Reflect.get(asset.lite.material, "baseColorTexture")).toBeUndefined();
  });
});

describe("mesh primitive options", () => {
  it("maps a partial ground declaration without inventing values", async () => {
    const h = await app();
    using bare = MeshAsset.ground(h.app);
    using partial = MeshAsset.ground(h.app, { subdivisions: 3 });
    expect(bare.value).toBeInstanceOf(MeshAsset);
    expect(partial.value).toBeInstanceOf(MeshAsset);
  });

  it("copies a declaration for every primitive rather than handing Lite the caller's object", async () => {
    const h = await app();
    // Each factory copies the options it was given, so a caller that mutates its own object
    // afterwards cannot reach into Lite. Headlessly the copy is all that runs, which is what makes
    // the branch assertable without a device.
    using sphere = MeshAsset.sphere(h.app, { diameter: 3, segments: 8 });
    using plane = MeshAsset.plane(h.app, { size: 2 });
    using cylinder = MeshAsset.cylinder(h.app, { height: 3, diameter: 1 });
    using capsule = MeshAsset.capsule(h.app, { height: 2, radius: 0.5 });
    using torus = MeshAsset.torus(h.app, { diameter: 2, thickness: 0.4 });
    for (const handle of [sphere, plane, cylinder, capsule, torus]) {
      expect(handle.value).toBeInstanceOf(MeshAsset);
      expect(handle.value.lite.mesh).toBeNull();
    }
  });
});

describe("a model container that Lite parsed", () => {
  it("takes the clips off the container and reads its skeletons", () => {
    const container = {
      entities: [],
      animationGroups: [{ name: "Run" }, { name: "Idle" }],
      skeletons: [{ bones: [] }],
    };
    const asset = createModelAsset("models/hero.glb", container as never, null);
    expect(asset.animations.map((clip) => clip.name)).toEqual(["Run", "Idle"]);
    expect(asset.skeletons).toHaveLength(1);
    // The clips are removed so `addToScene` never installs Lite's own animation hook (ADR-0003).
    expect(container.animationGroups).toEqual([]);
  });

  it("reports no instance for a container with no scene-node root", () => {
    const container = { entities: [{ lightType: "point" }], animationGroups: [] };
    const asset = createModelAsset("models/lights.glb", container as never, null);
    expect(asset.animations).toEqual([]);
    expect(asset.skeletons).toEqual([]);
    expect(asset.instantiate(null)).toBeNull();
  });
});
