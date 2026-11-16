import { describe, expect, it } from "vitest";
import {
  applyLightmap,
  LIGHTMAP_ATLAS_PLUGIN_NAME,
  lightmapAtlasPlugin,
  lightmapAtlasWgsl,
} from "../../../src/lite/gpu/lightmap.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import type { LiteLightmapAtlas, LiteLightmapOptions } from "../../../src/lite/gpu/lightmap.js";
import type { MaterialPlugin, Texture2D } from "@babylonjs/lite";

/**
 * The lightmap atlas transform: the vertex plugin that moves a renderer's UV2 into its atlas
 * square, headless. Drawing with it is `lightmap.browser.test.ts`.
 */

/** A stand-in texture handle: setting a lightmap only stores it. */
const texture = { width: 2, height: 1 } as unknown as Texture2D;

/**
 * Lightmap options with an atlas placement.
 *
 * @param atlas - The placement, or `null`.
 * @param uv2 - Whether the lightmap samples the second UV set.
 * @returns The options.
 */
function options(atlas: LiteLightmapAtlas | null, uv2 = true): LiteLightmapOptions {
  return { level: 1, shadowmap: false, gamma: false, uv2, atlas };
}

/**
 * Evaluates the WGSL the plugin injects, for one UV2 value, by reading its constants back.
 *
 * @param wgsl - The plugin code.
 * @param u - The incoming U.
 * @param v - The incoming V.
 * @returns The rewritten UV.
 */
function evaluate(wgsl: string, u: number, v: number): [number, number] {
  const match = /^out\.uv2=out\.uv2\*vec2<f32>\(([^,]+),([^)]+)\)\+vec2<f32>\(([^,]+),([^)]+)\);$/.exec(wgsl);
  expect(match, wgsl).not.toBeNull();
  const [sx, sy, ox, oy] = (match ?? []).slice(1).map(Number);
  return [u * (sx ?? Number.NaN) + (ox ?? Number.NaN), v * (sy ?? Number.NaN) + (oy ?? Number.NaN)];
}

const left: LiteLightmapAtlas = { scale: { x: 0.5, y: 1 }, offset: { x: 0, y: 0 } };
const right: LiteLightmapAtlas = { scale: { x: 0.5, y: 1 }, offset: { x: 0.5, y: 0 } };

describe("the lightmap atlas plugin", () => {
  it("maps UV2 to uv2 · scale + offset", () => {
    expect(evaluate(lightmapAtlasWgsl(left), 1, 1)).toEqual([0.5, 1]);
    expect(evaluate(lightmapAtlasWgsl(right), 0, 0)).toEqual([0.5, 0]);
    expect(evaluate(lightmapAtlasWgsl(right), 0.5, 0.25)).toEqual([0.75, 0.25]);
    const odd: LiteLightmapAtlas = { scale: { x: 1e-7, y: 0.125 }, offset: { x: -0.25, y: 3 } };
    expect(evaluate(lightmapAtlasWgsl(odd), 1, 2)).toEqual([1e-7 - 0.25, 3.25]);
  });

  it("writes every constant as a WGSL float literal", () => {
    expect(lightmapAtlasWgsl(left)).toBe("out.uv2=out.uv2*vec2<f32>(0.5,1.0)+vec2<f32>(0.0,0.0);");
    expect(lightmapAtlasWgsl({ scale: { x: 1e-7, y: 2 }, offset: { x: -3, y: 1e21 } })).toBe(
      "out.uv2=out.uv2*vec2<f32>(1e-7,2.0)+vec2<f32>(-3.0,1e+21);",
    );
  });

  it("shares one vertex-only plugin per placement", () => {
    const plugin = lightmapAtlasPlugin(left);
    expect(lightmapAtlasPlugin({ scale: { x: 0.5, y: 1 }, offset: { x: 0, y: 0 } })).toBe(plugin);
    expect(lightmapAtlasPlugin(right)).not.toBe(plugin);
    expect(plugin.name).toBe(LIGHTMAP_ATLAS_PLUGIN_NAME);
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    expect(plugin.getCustomCode?.("vertex")).toEqual({ CUSTOM_VERTEX_MAIN_END: lightmapAtlasWgsl(left) });
    expect("getUniforms" in plugin).toBe(false);
  });
});

describe("applyLightmap with an atlas placement", () => {
  it("adds, replaces and drops the atlas plugin, keeping the material's other plugins", () => {
    const { scene } = createHeadlessScene();
    try {
      const material = createPbrMaterialFromProps({ name: "wall" });
      const other: MaterialPlugin = { name: "other" };
      material.plugins = [other];
      expect(applyLightmap(scene, material, texture, options(left))).toBe(true);
      expect(material.plugins).toEqual([other, lightmapAtlasPlugin(left)]);
      expect(material.lightmapCoordIndex).toBe(1);
      applyLightmap(scene, material, texture, options(right));
      expect(material.plugins).toEqual([other, lightmapAtlasPlugin(right)]);
      applyLightmap(scene, material, texture, options(null));
      expect(material.plugins).toEqual([other]);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("adds no plugin to a lightmap that samples the first UV set", () => {
    const { scene } = createHeadlessScene();
    try {
      const material = createPbrMaterialFromProps({ name: "floor" });
      applyLightmap(scene, material, texture, options(left, false));
      expect(material.plugins ?? []).toEqual([]);
      expect(material.lightmapCoordIndex).toBe(0);
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
