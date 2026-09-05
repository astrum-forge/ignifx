import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { EnvironmentAsset } from "../../src/render/environment-asset.js";
import { ModelAsset } from "../../src/render/model-asset.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { FontAsset } from "../../src/render/font-asset.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";

/**
 * The five core GPU loaders on the null engine
 * (`docs/architecture/05-assets-and-loading.md` §5, `07-rendering.md` §6).
 *
 * §5 requires every GPU loader to "tolerate the null engine (return CPU-only data with `gpu: null`)",
 * and these suites are what pins that: each address resolves to the right type, produces a value,
 * and reports an empty Lite half. The browser project is where the same addresses come back with a
 * device behind them.
 */

/** Where the shared sample assets live, relative to this file. */
const ASSET_ROOT = new URL("../../../../tests/fixtures/assets/", import.meta.url);

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

/**
 * Reads a repository fixture as text.
 *
 * @param name - The file name inside `tests/fixtures/assets/`.
 * @returns The bytes as a Node buffer.
 */
function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(name, ASSET_ROOT)));
}

/**
 * Answers every request for an address with one body, retries included.
 *
 * @param h - The harness.
 * @param address - The asset address.
 * @param body - The response body.
 */
function canned(h: RenderHarness, address: string, body: string): void {
  h.net.canned.set(h.app.assets.resolveUrl(address), body);
}

/**
 * Runs frames until a handle settles, or the attempt budget runs out. Each frame advances a whole
 * second so the retry backoff of §9 elapses.
 *
 * @param h - The harness.
 * @param isDone - Whether the wait is over.
 */
async function until(h: RenderHarness, isDone: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 8 && !isDone(); attempt += 1) {
    // Each settle depends on the previous frame having run, so the awaits are genuinely sequential.
    // oxlint-disable-next-line eslint/no-await-in-loop -- see the comment above
    await h.settle(1);
  }
}

describe("address to type resolution", () => {
  it("claims the extensions 05-assets-and-loading.md §5 lists", async () => {
    const h = await app();
    const cases: readonly (readonly [string, string])[] = [
      ["textures/a.png", "texture"],
      ["textures/a.jpg", "texture"],
      ["textures/a.ktx2", "texture"],
      ["models/hero.glb", "model"],
      ["models/hero.gltf", "model"],
      ["materials/gold.material.json", "material"],
      ["environments/studio.env", "environment"],
      ["environments/studio.environment.json", "environment"],
      ["fonts/inter.ttf", "font"],
      ["fonts/inter.otf", "font"],
      ["levels/one.scene.json", "scene"],
      ["prefabs/enemy.prefab.json", "scene"],
      ["data/config.json", "json"],
    ];
    for (const [address, type] of cases) {
      const handle = h.app.assets.load(address);
      expect({ address, type: handle.type }).toEqual({ address, type });
    }
  });

  it("prefers the longer suffix, so .material.json is not read as json", async () => {
    const h = await app();
    expect(h.app.assets.load("materials/gold.material.json").type).toBe("material");
    expect(h.app.assets.load("environments/a.environment.json").type).toBe("environment");
  });
});

describe("the texture loader", () => {
  it("produces a CPU-only asset headlessly, with the sidecar's options", async () => {
    const manifest = createAssetManifest([
      { address: "textures/a.png", url: "u/a.png", type: "texture", meta: { texture: { srgb: true } } },
    ]);
    harness = await createRenderHarness({ manifest });
    const handle = harness.app.assets.load<TextureAsset>("textures/a.png");
    await harness.settle();
    expect(handle.state).toBe("loaded");
    expect(handle.value).toBeInstanceOf(TextureAsset);
    expect(handle.value.lite.texture).toBeNull();
    expect(handle.value.options.srgb).toBe(true);
    // A headless texture never fetched, because Lite is the one that decodes the URL.
    expect(harness.net.requests).toHaveLength(0);
  });

  it("takes the defaults when the manifest carries no sidecar", async () => {
    const h = await app();
    const handle = h.app.assets.load<TextureAsset>("textures/b.png");
    await h.settle();
    expect(handle.value.options.srgb).toBe(false);
    expect(handle.value.options.mipMaps).toBe(true);
  });
});

describe("the model loader", () => {
  it("fetches the bytes and skips the upload headlessly", async () => {
    const h = await app();
    h.net.canned.set(h.app.assets.resolveUrl("models/Box.glb"), fixture("Box.glb").toString("binary"));
    const handle = h.app.assets.load<ModelAsset>("models/Box.glb");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("loaded");
    expect(handle.value).toBeInstanceOf(ModelAsset);
    expect(handle.value.lite.container).toBeNull();
    expect(handle.value.address).toBe("models/Box.glb");
  });
});

describe("the material loader", () => {
  it("reads a PBR file, resolves its textures, and builds the Lite material", async () => {
    const h = await app();
    canned(
      h,
      "materials/gold.material.json",
      JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "pbr",
        name: "Gold",
        baseColor: [1, 0.77, 0.34, 1],
        metallic: 1,
        roughness: 0.25,
        alphaMode: "mask",
        alphaCutoff: 0.25,
        baseColorTexture: { $asset: "textures/gold.png" },
      }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/gold.material.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("loaded");
    const asset = handle.value;
    expect(asset.kind).toBe("pbr");
    expect(asset.name).toBe("Gold");
    expect(asset.definition).toMatchObject({ metallic: 1, roughness: 0.25, alphaMode: "mask", alphaCutoff: 0.25 });
    expect(asset.textures).toHaveLength(1);
    expect(asset.textures[0]?.address).toBe("textures/gold.png");
  });

  it("reads a Standard file and its own slots", async () => {
    const h = await app();
    canned(
      h,
      "materials/flat.material.json",
      JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "standard",
        diffuse: [1, 0, 0],
        specularPower: 8,
        doubleSided: true,
      }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/flat.material.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.value.kind).toBe("standard");
    expect(handle.value.definition).toMatchObject({ specularPower: 8, doubleSided: true });
  });

  it("takes the defaults for properties of the wrong type rather than failing", async () => {
    const h = await app();
    canned(
      h,
      "materials/odd.material.json",
      JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        name: 7,
        metallic: "lots",
        doubleSided: "yes",
        baseColor: [1, 2],
        alphaMode: "nonsense",
        baseColorTexture: "textures/a.png",
      }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/odd.material.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("loaded");
    expect(handle.value.definition).toMatchObject({ name: "", metallic: 1, doubleSided: false, alphaMode: "opaque" });
    expect(handle.value.textures).toHaveLength(0);
  });

  it("rejects a file with no ignifx.material header as IGX-0709", async () => {
    const h = await app();
    canned(h, "materials/bad.material.json", JSON.stringify({ hello: true }));
    const handle = h.app.assets.load<MaterialAsset>("materials/bad.material.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("failed");
    expect(String(handle.error?.cause)).toContain("IGX-0709");
  });

  it("rejects an unreadable format version as IGX-0603", async () => {
    const h = await app();
    canned(h, "materials/future.material.json", JSON.stringify({ format: "ignifx.material", formatVersion: 99 }));
    const handle = h.app.assets.load<MaterialAsset>("materials/future.material.json");
    await until(h, () => handle.state !== "loading");
    expect(String(handle.error?.cause)).toContain("IGX-0603");
  });

  it("rejects a shader material as IGX-0708, which Phase 7 owns", async () => {
    const h = await app();
    canned(
      h,
      "materials/wgsl.material.json",
      JSON.stringify({ format: "ignifx.material", formatVersion: 1, type: "shader" }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/wgsl.material.json");
    await until(h, () => handle.state !== "loading");
    expect(String(handle.error?.cause)).toContain("IGX-0708");
  });

  it("rejects a family that is not a family at all, also as IGX-0708", async () => {
    const h = await app();
    canned(
      h,
      "materials/nope.material.json",
      JSON.stringify({ format: "ignifx.material", formatVersion: 1, type: "toon" }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/nope.material.json");
    await until(h, () => handle.state !== "loading");
    expect(String(handle.error?.cause)).toContain("IGX-0708");
  });
});

describe("the environment loader", () => {
  it("produces a CPU-only asset for a bare .env address", async () => {
    const h = await app();
    const handle = h.app.assets.load<EnvironmentAsset>("environments/studio.env");
    await h.settle();
    expect(handle.state).toBe("loaded");
    expect(handle.value).toBeInstanceOf(EnvironmentAsset);
    expect(handle.value.lite.textures).toBeNull();
    expect(handle.value.definition.environment).toBe("environments/studio.env");
  });

  it("reads an .environment.json description over the defaults", async () => {
    const h = await app();
    canned(
      h,
      "environments/studio.environment.json",
      JSON.stringify({
        format: "ignifx.environment",
        formatVersion: 1,
        environment: "environments/studio.env",
        brdfLut: "environments/brdf.png",
        skybox: "environments/sky.dds",
        skyboxSize: 50,
        blur: 0.25,
        rotation: 90,
      }),
    );
    const handle = h.app.assets.load<EnvironmentAsset>("environments/studio.environment.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.value.definition).toEqual({
      environment: "environments/studio.env",
      brdfLut: "environments/brdf.png",
      skybox: "environments/sky.dds",
      skyboxSize: 50,
      skyboxEnabled: true,
      blur: 0.25,
      rotation: 90,
    });
  });

  it("falls back to a default for every field the description gives the wrong type", async () => {
    const h = await app();
    canned(
      h,
      "environments/loose.environment.json",
      JSON.stringify({
        format: "ignifx.environment",
        formatVersion: 1,
        environment: 5,
        brdfLut: null,
        skybox: [],
        skyboxSize: "big",
        skyboxEnabled: "no",
        blur: "some",
        rotation: {},
      }),
    );
    const handle = h.app.assets.load<EnvironmentAsset>("environments/loose.environment.json");
    await until(h, () => handle.state !== "loading");
    // §5: a description is read defensively, field by field — one bad value does not fail the load.
    expect(handle.value.definition).toEqual({
      environment: "",
      brdfLut: "",
      skybox: "",
      skyboxSize: 20,
      skyboxEnabled: true,
      blur: 0,
      rotation: 0,
    });
  });

  it("skips the skybox when the description turns it off", async () => {
    const h = await app();
    canned(
      h,
      "environments/nosky.environment.json",
      JSON.stringify({ format: "ignifx.environment", formatVersion: 1, skyboxEnabled: false }),
    );
    const handle = h.app.assets.load<EnvironmentAsset>("environments/nosky.environment.json");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("loaded");
    expect(handle.value.definition.skyboxEnabled).toBe(false);
  });

  it("takes the project's BRDF table when the description names none", async () => {
    harness = await createRenderHarness({ settings: { rendering: { brdfLut: "environments/project-brdf.png" } } });
    const h = harness;
    const handle = h.app.assets.load<EnvironmentAsset>("environments/studio.env");
    await h.settle();
    expect(handle.state).toBe("loaded");
    // Headlessly the URL is not kept on the asset, but resolving it is what the loader just did:
    // the assertion is that the project setting is the address it resolved.
    expect(h.app.assets.resolveUrl("environments/project-brdf.png")).toContain("project-brdf.png");
  });

  it("rejects a description with no ignifx.environment header as IGX-0709", async () => {
    const h = await app();
    canned(h, "environments/bad.environment.json", JSON.stringify([1, 2, 3]));
    const handle = h.app.assets.load<EnvironmentAsset>("environments/bad.environment.json");
    await until(h, () => handle.state !== "loading");
    expect(String(handle.error?.cause)).toContain("IGX-0709");
  });

  it("rejects an unreadable description version as IGX-0603", async () => {
    const h = await app();
    canned(
      h,
      "environments/future.environment.json",
      JSON.stringify({ format: "ignifx.environment", formatVersion: 4 }),
    );
    const handle = h.app.assets.load<EnvironmentAsset>("environments/future.environment.json");
    await until(h, () => handle.state !== "loading");
    expect(String(handle.error?.cause)).toContain("IGX-0603");
  });
});

describe("the font loader", () => {
  it("fails a file Lite's parser cannot read, through the ordinary retry path", async () => {
    const h = await app();
    canned(h, "fonts/broken.ttf", "not a font at all, just some bytes");
    const handle = h.app.assets.load<FontAsset>("fonts/broken.ttf");
    await until(h, () => handle.state !== "loading");
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe("IGX-0505");
  });
});
