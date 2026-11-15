import { afterEach, describe, expect, it, vi } from "vitest";
import { createLightmapRuntime } from "../../src/render/gpu/lightmaps.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { LitePbrMaterial } from "../../src/lite/material.js";
import type { LiteScene } from "../../src/lite/scene.js";
import type { LightmapAsset, LightmapPlacement } from "../../src/render/lightmap-asset.js";
import type { MeshRendererLightmap } from "../../src/render/mesh-renderer.js";

/**
 * The lightmap runtime's per-renderer material copies (`src/render/gpu/lightmaps.ts`) against real
 * headless `MaterialAsset`s; Lite's lightmap extension is mocked because a headless app has no GPU.
 */

vi.mock("../../src/lite/gpu/lightmap.js", () => ({
  enableLightmaps: (): Promise<void> => Promise.resolve(),
  applyLightmap: (): boolean => true,
  setLightmapLevel: (): void => undefined,
}));

vi.mock("../../src/lite/material.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, rebuildMaterialPipelines: (): void => undefined };
});

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A loaded lightmap whose texture is "on the GPU". */
const lightmap = { texture: { state: "loaded", value: { lite: { texture: {} } } } } as unknown as LightmapAsset;

const settings = { mode: "lightmap", gamma: false, uv2: true, level: 1 } as unknown as MeshRendererLightmap;

describe("the lightmap runtime", () => {
  it("copies later edits of the shared material onto a renderer's clone", async () => {
    harness = await createRenderHarness();
    const runtime = await createLightmapRuntime(harness.app, {} as LiteScene);
    const base = createMaterialAsset(harness.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    base.value.setMetallicRoughness(0.25, 0.5);
    const owner = {};
    const first = runtime.materialFor(owner, base.value, lightmap, settings, null) as LitePbrMaterial;
    expect(first).not.toBe(base.value.lite.material);
    expect(first.metallicFactor).toBe(0.25);
    base.value.setMetallicRoughness(0.75, 0.125);
    base.value.setAlpha(0.5);
    const second = runtime.materialFor(owner, base.value, lightmap, settings, null) as LitePbrMaterial;
    expect(second).toBe(first);
    expect(second.metallicFactor).toBe(0.75);
    expect(second.roughnessFactor).toBe(0.125);
    expect(second.alpha).toBe(0.5);
    runtime.release(owner);
    expect(runtime.count).toBe(0);
    runtime.dispose();
    base.release();
  });

  it("keeps a renderer's clone for the same placement and makes a new one for another", async () => {
    harness = await createRenderHarness();
    const runtime = await createLightmapRuntime(harness.app, {} as LiteScene);
    const base = createMaterialAsset(harness.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    const left: LightmapPlacement = { scale: { x: 0.5, y: 1 }, offset: { x: 0, y: 0 } };
    const right: LightmapPlacement = { scale: { x: 0.5, y: 1 }, offset: { x: 0.5, y: 0 } };
    const owner = {};
    const first = runtime.materialFor(owner, base.value, lightmap, settings, left);
    expect(runtime.materialFor(owner, base.value, lightmap, settings, left)).toBe(first);
    const moved = runtime.materialFor(owner, base.value, lightmap, settings, right);
    expect(moved).not.toBe(first);
    expect(runtime.materialFor(owner, base.value, lightmap, settings, null)).not.toBe(moved);
    const other = {};
    expect(runtime.materialFor(other, base.value, lightmap, settings, right)).not.toBe(moved);
    expect(runtime.count).toBe(2);
    runtime.dispose();
    expect(runtime.count).toBe(0);
    base.release();
  });
});
