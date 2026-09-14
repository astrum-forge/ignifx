import { TextureAsset } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { HeightField } from "../../src/heightfield/height-field.js";
import { createFoliageMaterial, foliageMaterialDefinition, foliageShaderAddress } from "../../src/material/foliage.js";
import { FOLIAGE_SHADER_NAME, foliageShaderSource } from "../../src/material/foliage.wgsl.js";
import { shaderSourceAddress } from "../../src/material/shader-source.js";
import {
  controlMapCount,
  generateControlMaps,
  LAYERS_PER_CONTROL_MAP,
  sampleControlWeight,
  solidControlMaps,
} from "../../src/material/splat-rules.js";
import { TERRAIN_SPLAT_NAME, terrainSplatShaderSource } from "../../src/material/terrain-splat.surface.wgsl.js";
import { createTerrainApp } from "../support/app.js";
import type { TerrainLayerDefinition } from "../../src/definition/types.js";
import type { TerrainSplatShaderSpec } from "../../src/material/terrain-splat.surface.wgsl.js";
import type { AssetHandle } from "@ignifx/core";

/** Samples per side of the fixture field. */
const RESOLUTION = 17;

/**
 * A layer declaration with the defaults filled in.
 *
 * @param name - The layer's name.
 * @returns The layer.
 */
function layer(name: string): TerrainLayerDefinition {
  return { name, albedo: "", normal: null, tiling: 8, triplanar: false, color: { r: 1, g: 1, b: 1, a: 1 } };
}

/**
 * A field flat over its first half and a ramp over the second.
 *
 * @returns The field.
 */
function rampField(): HeightField {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let iz = 0; iz < RESOLUTION; iz += 1) {
    for (let ix = 0; ix < RESOLUTION; ix += 1) {
      heights[iz * RESOLUTION + ix] = ix < RESOLUTION / 2 ? 0 : ix - RESOLUTION / 2;
    }
  }
  return new HeightField(RESOLUTION, { width: 16, depth: 16, height: 16 }, heights);
}

/**
 * A one-texel texture to stand in for a grass card's albedo.
 *
 * @returns The handle.
 */
async function cardTexture(): Promise<AssetHandle<TextureAsset>> {
  const harness = await createTerrainApp();
  return TextureAsset.fromPixels(harness.app, "card", Uint8Array.from([255, 255, 255, 255]), 1, 1);
}

/**
 * A splat shader shape.
 *
 * @param overrides - What to change.
 * @returns The shape.
 */
function spec(overrides?: Partial<TerrainSplatShaderSpec>): TerrainSplatShaderSpec {
  return {
    layers: [{ triplanar: false, hasNormal: false, color: { r: 1, g: 1, b: 1, a: 1 }, tiling: 8 }],
    textured: false,
    normals: false,
    ...overrides,
  };
}

describe("control maps", () => {
  it("needs one map per four layers", () => {
    expect(controlMapCount(1)).toBe(1);
    expect(controlMapCount(4)).toBe(1);
    expect(controlMapCount(5)).toBe(2);
    expect(LAYERS_PER_CONTROL_MAP).toBe(4);
  });

  it("paints the first layer everywhere by default", () => {
    const maps = solidControlMaps(4, 2);

    expect(maps.maps).toHaveLength(1);
    expect(sampleControlWeight(maps, 0, 0.5, 0.5)).toBeCloseTo(1, 5);
    expect(sampleControlWeight(maps, 1, 0.5, 0.5)).toBeCloseTo(0, 5);
  });

  it("answers zero for a layer with no map", () => {
    expect(sampleControlWeight(solidControlMaps(4, 1), 7, 0.5, 0.5)).toBe(0);
  });

  it("paints a slope rule where the ground is steep", () => {
    const field = rampField();
    const control = generateControlMaps(
      field,
      [layer("grass"), layer("rock")],
      [
        { layer: "grass", height: null, slope: [0, 10] },
        { layer: "rock", height: null, slope: [30, 90] },
      ],
    );

    expect(sampleControlWeight(control, 0, 0.2, 0.5)).toBeGreaterThan(0.9);
    expect(sampleControlWeight(control, 1, 0.8, 0.5)).toBeGreaterThan(0.9);
  });

  it("paints a height rule where the ground is high", () => {
    const field = rampField();
    const control = generateControlMaps(
      field,
      [layer("low"), layer("high")],
      [
        { layer: "low", height: [0, 2], slope: null },
        { layer: "high", height: [5, 100], slope: null },
      ],
    );

    // The bands are feathered, so the test is which layer dominates rather than an absolute weight.
    expect(sampleControlWeight(control, 1, 0.9, 0.5)).toBeGreaterThan(sampleControlWeight(control, 0, 0.9, 0.5));
    expect(sampleControlWeight(control, 0, 0.2, 0.5)).toBeGreaterThan(sampleControlWeight(control, 1, 0.2, 0.5));
  });

  it("falls back to the first layer where no rule reaches", () => {
    const field = rampField();
    const control = generateControlMaps(
      field,
      [layer("grass"), layer("rock")],
      [{ layer: "rock", height: [1000, 2000], slope: null }],
    );

    expect(sampleControlWeight(control, 0, 0.5, 0.5)).toBeCloseTo(1, 4);
  });

  it("sizes the map to one texel per quad", () => {
    expect(generateControlMaps(rampField(), [layer("grass")], []).size).toBe(RESOLUTION - 1);
  });

  it("normalises a texel's weights to sum to 255", () => {
    const field = rampField();
    const control = generateControlMaps(
      field,
      [layer("a"), layer("b")],
      [
        { layer: "a", height: null, slope: null },
        { layer: "b", height: null, slope: null },
      ],
    );
    const map = control.maps[0];
    const total = (map?.[0] ?? 0) + (map?.[1] ?? 0) + (map?.[2] ?? 0) + (map?.[3] ?? 0);

    expect(total).toBe(255);
  });

  it("treats a zero-width band as a hard edge", () => {
    const field = rampField();
    const control = generateControlMaps(field, [layer("a"), layer("b")], [{ layer: "b", height: [3, 3], slope: null }]);

    expect(sampleControlWeight(control, 0, 0.1, 0.5)).toBeGreaterThan(0.5);
  });

  it("spreads the weights of eight layers over two maps", () => {
    const layers = Array.from({ length: 8 }, (_value, index) => layer(`l${String(index)}`));
    const control = generateControlMaps(rampField(), layers, [{ layer: "l5", height: null, slope: null }]);

    expect(control.maps).toHaveLength(2);
    expect(sampleControlWeight(control, 5, 0.5, 0.5)).toBeGreaterThan(0.9);
  });
});

describe("the generated terrainSplat shader", () => {
  it("declares itself a surface shader", () => {
    expect(terrainSplatShaderSource(spec())).toContain("// @ignifx surface");
    expect(TERRAIN_SPLAT_NAME).toBe("terrainSplat");
  });

  it("declares one control sampler per four layers", () => {
    const source = terrainSplatShaderSource(spec({ layers: Array.from({ length: 5 }, () => spec().layers[0]!) }));

    expect(source).toContain("// @ignifx texture control0");
    expect(source).toContain("// @ignifx texture control1");
  });

  it("declares no array sampler for a textureless terrain", () => {
    const source = terrainSplatShaderSource(spec());

    expect(source).not.toContain("albedo");
    expect(source).toContain("surfaceUniforms.color0");
  });

  it("declares the albedo array when the terrain has layer textures", () => {
    const source = terrainSplatShaderSource(spec({ textured: true }));

    expect(source).toContain("// @ignifx texture albedo srgb array");
    expect(source).toContain("textureSampleGrad(albedo, albedoSampler");
  });

  it("never names a local after a declared sampler", () => {
    // The surface compiler rewrites every declared sampler name, so a local of the same name would
    // redeclare the binding and the shader would not compile.
    const source = terrainSplatShaderSource(spec({ textured: true, normals: true }));

    expect(source).not.toContain("var albedo");
    expect(source).not.toContain("var normals");
  });

  it("samples three projections for a triplanar layer", () => {
    const source = terrainSplatShaderSource(
      spec({
        layers: [{ triplanar: true, hasNormal: false, color: { r: 1, g: 1, b: 1, a: 1 }, tiling: 4 }],
        textured: true,
      }),
    );

    expect(source).toContain("worldPosition.zy");
    expect(source).toContain("worldPosition.xy");
    expect(source).toContain("bwn");
  });

  it("perturbs the normal only when a normal array is bound", () => {
    expect(terrainSplatShaderSource(spec({ textured: true }))).not.toContain("(*s).normal");
    expect(
      terrainSplatShaderSource(
        spec({
          layers: [{ triplanar: false, hasNormal: true, color: { r: 1, g: 1, b: 1, a: 1 }, tiling: 8 }],
          textured: true,
          normals: true,
        }),
      ),
    ).toContain("(*s).normal");
  });

  it("writes the terrain's origin and size as uniforms", () => {
    const source = terrainSplatShaderSource(spec());

    expect(source).toContain("// @ignifx uniform origin: vec2<f32>");
    expect(source).toContain("// @ignifx uniform invSize: vec2<f32>");
  });
});

describe("the foliage shader", () => {
  it("declares the wind, tint and cutoff uniforms", () => {
    const source = foliageShaderSource();

    expect(source).toContain("// @ignifx shader");
    expect(source).toContain("windStrength");
    expect(source).toContain("windFrequency");
    expect(source).toContain("cutoff");
    expect(FOLIAGE_SHADER_NAME).toBe("foliage");
  });

  it("reads the time uniform in its vertex stage", () => {
    expect(foliageShaderSource()).toContain("shaderUniforms.time");
  });

  it("composes the thin-instance matrices only in the instanced variant", () => {
    expect(foliageShaderSource({ instanced: true })).toContain("input.world0");
    expect(foliageShaderSource({ instanced: false })).not.toContain("input.world0");
  });

  it("addresses each variant separately", () => {
    expect(foliageShaderAddress(true)).not.toBe(foliageShaderAddress(false));
    expect(foliageShaderAddress(true)).toBe(shaderSourceAddress(foliageShaderSource({ instanced: true })));
  });
});

describe("createFoliageMaterial", () => {
  it("loads the generated shader and builds a shader material", async () => {
    const harness = await createTerrainApp();
    const albedo = TextureAsset.fromPixels(harness.app, "grass", Uint8Array.from([0, 255, 0, 255]), 1, 1);

    const material = await createFoliageMaterial(harness.app, { albedo, wind: { strength: 0.3 } });

    expect(material.value.kind).toBe("shader");
    expect(material.value.name).toBe(FOLIAGE_SHADER_NAME);
    harness.dispose();
  });

  it("builds the plain variant for a mesh renderer", async () => {
    const harness = await createTerrainApp();
    const albedo = TextureAsset.fromPixels(harness.app, "grass2", Uint8Array.from([0, 255, 0, 255]), 1, 1);

    const material = await createFoliageMaterial(harness.app, { albedo, instanced: false, name: "leaves" });

    expect(material.value.name).toBe("leaves");
    harness.dispose();
  });
});

describe("foliageMaterialDefinition", () => {
  it("turns the wind options into uniform values", async () => {
    const definition = foliageMaterialDefinition({
      albedo: await cardTexture(),
      wind: { strength: 0.4, frequency: 2, height: 1.5 },
    });

    expect(definition.kind).toBe("shader");
    expect(definition.values["windStrength"]).toBe(0.4);
    expect(definition.values["windFrequency"]).toBe(2);
    expect(definition.values["windHeight"]).toBe(1.5);
  });

  it("switches the wind off for a null wind", async () => {
    const definition = foliageMaterialDefinition({ albedo: await cardTexture(), wind: null });

    expect(definition.values["windStrength"]).toBe(0);
    expect(definition.values["windFrequency"]).toBe(0);
  });

  it("defaults the cutoff and the name", async () => {
    const definition = foliageMaterialDefinition({ albedo: await cardTexture() });

    expect(definition.values["cutoff"]).toBe(0.5);
    expect(definition.name).toBe(FOLIAGE_SHADER_NAME);
  });
});
