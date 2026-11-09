import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import {
  createLightmapAsset,
  IDENTITY_LIGHTMAP_PLACEMENT,
  isIdentityLightmapPlacement,
  readLightmapFile,
  writeLightmapFile,
} from "../../src/render/lightmap-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { LightmapAsset, LightmapFileData } from "../../src/render/lightmap-asset.js";

/**
 * Lightmaps (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3): the `.lightmap.json`
 * format and the component field headless. The GPU path is covered by `lightmap.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * The code of the error a call throws.
 *
 * @param run - The call.
 * @returns The code, or `null` when it did not throw an ignifx error.
 */
function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

const DATA: LightmapFileData = {
  texture: "lighting/hall.png",
  entries: {
    b: { scale: { x: 0.5, y: 0.5 }, offset: { x: 0.5, y: 0 } },
    a: IDENTITY_LIGHTMAP_PLACEMENT,
  },
};

describe(".lightmap.json", () => {
  it("round-trips through writeLightmapFile and readLightmapFile", () => {
    const written = writeLightmapFile(DATA);
    expect(Object.keys(written["entries"] as object)).toEqual(["a", "b"]);
    expect(readLightmapFile(JSON.parse(JSON.stringify(written)), "a.lightmap.json")).toEqual(DATA);
  });

  it("defaults missing entries and missing placement halves to the identity", () => {
    const read = readLightmapFile({ format: "ignifx-lightmap", formatVersion: 1, texture: "t.png" }, "a.lightmap.json");
    expect(read.entries).toEqual({});
    const half = readLightmapFile(
      { format: "ignifx-lightmap", formatVersion: 1, texture: "t.png", entries: { e: { offset: { x: 1, y: 2 } } } },
      "a.lightmap.json",
    );
    expect(half.entries["e"]).toEqual({ scale: { x: 1, y: 1 }, offset: { x: 1, y: 2 } });
  });

  const valid = writeLightmapFile(DATA);
  it.each([
    ["no header", {}],
    ["a wrong version", { ...valid, formatVersion: 2 }],
    ["no texture", { ...valid, texture: "" }],
    ["a non-string texture", { ...valid, texture: 3 }],
    ["entries that are an array", { ...valid, entries: [] }],
    ["a non-object entry", { ...valid, entries: { e: 1 } }],
    ["a zero scale", { ...valid, entries: { e: { scale: { x: 0, y: 1 } } } }],
    ["a non-finite offset", { ...valid, entries: { e: { offset: { x: Number.NaN, y: 0 } } } }],
    ["a malformed offset", { ...valid, entries: { e: { offset: [0, 0] } } }],
    ["an empty entity id", { ...valid, entries: { "": {} } }],
    ["a non-object file", null],
  ])("rejects %s with IGX-0709", (_name, file) => {
    expect(codeOf(() => readLightmapFile(file, "bad.lightmap.json"))).toBe("IGX-0709");
  });

  it("tells the identity placement from the others", () => {
    expect(isIdentityLightmapPlacement(IDENTITY_LIGHTMAP_PLACEMENT)).toBe(true);
    expect(isIdentityLightmapPlacement(DATA.entries["b"] ?? IDENTITY_LIGHTMAP_PLACEMENT)).toBe(false);
  });
});

describe("LightmapAsset", () => {
  it("publishes a lightmap built in code and answers placements by entity id", async () => {
    harness = await createRenderHarness();
    const texture = TextureAsset.fromPixels(harness.app, "lm", new Uint8Array(4).fill(255), 1, 1);
    const lightmap = createLightmapAsset(harness.app, texture, DATA.entries);
    expect(lightmap.value.texture).toBe(texture);
    expect(lightmap.value.placementOf("b").scale.x).toBe(0.5);
    expect(lightmap.value.placementOf("missing")).toBe(IDENTITY_LIGHTMAP_PLACEMENT);
    expect(lightmap.value.placementOf("toString")).toBe(IDENTITY_LIGHTMAP_PLACEMENT);
    expect(
      codeOf(() =>
        createLightmapAsset(harness?.app ?? null!, texture, { e: { scale: { x: -1, y: 1 }, offset: { x: 0, y: 0 } } }),
      ),
    ).toBe("IGX-0709");
  });

  it("is a MeshRenderer field that does nothing headless", async () => {
    harness = await createRenderHarness();
    const { app, world } = harness;
    const texture = TextureAsset.fromPixels(app, "lm", new Uint8Array(4).fill(255), 1, 1);
    const entity = world.createEntity("Floor");
    entity.isStatic = true;
    const renderer = entity.addComponent(MeshRenderer, { mesh: MeshAsset.plane(app, { size: 1 }) });
    expect(renderer.lightmap).toBeNull();
    renderer.lightmap = {
      asset: createLightmapAsset(app, texture),
      mode: "shadowmap",
      level: 1,
      gamma: false,
      uv2: true,
    };
    await harness.settle();
    expect(harness.renderer.lightmapHost).toBeNull();
    entity.destroy();
    await harness.settle();
    expect(harness.errors).toEqual([]);
  });

  it("loads a .lightmap.json and its texture through the asset service", async () => {
    harness = await createRenderHarness();
    const h = harness;
    h.net.canned.set(h.app.assets.resolveUrl("lighting/hall.lightmap.json"), JSON.stringify(writeLightmapFile(DATA)));
    const asset = await h.app.assets.loadAsync<LightmapAsset>("lighting/hall.lightmap.json");
    expect(asset.value.texture.address).toBe("lighting/hall.png");
    expect(asset.value.placementOf("b").offset.x).toBe(0.5);
  });
});
