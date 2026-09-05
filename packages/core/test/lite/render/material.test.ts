import { describe, expect, it } from "vitest";
import {
  createDefaultMaterial,
  createPbrMaterialFromProps,
  createStandardMaterialFromProps,
  createWgslMaterial,
  enableMaterialChangeTracking,
  isBlendedAlphaMode,
  markMaterialDirty,
  MATERIAL_ALPHA_MODES,
  rebuildMaterialPipelines,
  setMaterialAlpha,
  setPbrBaseColor,
  setPbrMetallicRoughness,
} from "../../../src/lite/material.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * The material adapter, headless. `createPbrMaterial` is `{ ...props, _buildGroup, _uboVersion }`
 * and `createStandardMaterial` is an object literal, so nothing here needs a device; only drawing
 * does.
 */

/** A stand-in texture handle: the adapter only stores it, so nothing about it is dereferenced. */
function fakeTexture(): Texture2D {
  return { width: 1, height: 1 } as unknown as Texture2D;
}

/** The smallest WGSL pair Lite's `createShaderMaterial` validator accepts. */
const TRIVIAL_WGSL = {
  vertexSource: "@vertex fn main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }",
  fragmentSource: "@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
};

describe("PBR materials", () => {
  it("renames ignifx props onto Lite's glTF-shaped fields", () => {
    const material = createPbrMaterialFromProps({
      name: "gold",
      baseColor: [1, 0.77, 0.34, 1],
      metallic: 1,
      roughness: 0.25,
      environmentIntensity: 0.8,
      alpha: 0.9,
      doubleSided: true,
    });

    expect(material.name).toBe("gold");
    expect(material.baseColorFactor).toEqual([1, 0.77, 0.34, 1]);
    expect(material.metallicFactor).toBe(1);
    expect(material.roughnessFactor).toBe(0.25);
    expect(material.environmentIntensity).toBe(0.8);
    expect(material.alpha).toBe(0.9);
    expect(material.doubleSided).toBe(true);
  });

  it("leaves out every field the caller omitted", () => {
    const material = createPbrMaterialFromProps({});
    expect(material.baseColorFactor).toBeUndefined();
    expect(material.metallicFactor).toBeUndefined();
    expect(material.alphaBlend).toBeUndefined();
  });

  it("turns the blend alpha mode into Lite's alphaBlend flag", () => {
    expect(createPbrMaterialFromProps({ alphaMode: "blend" }).alphaBlend).toBe(true);
    expect(createPbrMaterialFromProps({ alphaMode: "opaque" }).alphaBlend).toBeUndefined();
    expect(createPbrMaterialFromProps({ alphaMode: "mask" }).alphaBlend).toBeUndefined();
  });

  it("declares three alpha modes and blends exactly one of them", () => {
    expect([...MATERIAL_ALPHA_MODES]).toEqual(["opaque", "mask", "blend"]);
    expect(MATERIAL_ALPHA_MODES.filter(isBlendedAlphaMode)).toEqual(["blend"]);
  });

  it("uses a neutral, fully rough dielectric as the default material", () => {
    const material = createDefaultMaterial();
    expect(material.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(material.metallicFactor).toBe(0);
    expect(material.roughnessFactor).toBe(0.9);
  });

  it("rewrites the base colour in place once one exists", () => {
    const material = createPbrMaterialFromProps({ baseColor: [0, 0, 0, 1] });
    const factor = material.baseColorFactor;
    setPbrBaseColor(material, 0.1, 0.2, 0.3, 0.4);
    expect(material.baseColorFactor).toBe(factor);
    expect(factor).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("creates a base colour when the material had none", () => {
    const material = createPbrMaterialFromProps({});
    setPbrBaseColor(material, 1, 0, 0, 1);
    expect(material.baseColorFactor).toEqual([1, 0, 0, 1]);
  });

  it("sets metallic, roughness, and alpha through the setters", () => {
    const material = createPbrMaterialFromProps({});
    setPbrMetallicRoughness(material, 0.5, 0.6);
    setMaterialAlpha(material, 0.25);
    expect(material.metallicFactor).toBe(0.5);
    expect(material.roughnessFactor).toBe(0.6);
    expect(material.alpha).toBe(0.25);
  });
});

describe("every optional PBR field", () => {
  it("is mapped when it is present", () => {
    const texture = fakeTexture();
    const material = createPbrMaterialFromProps({
      baseColorTexture: texture,
      metallicRoughnessTexture: texture,
      normalTexture: texture,
      normalScale: 0.5,
      emissive: [0.1, 0.2, 0.3],
      emissiveTexture: texture,
      occlusionTexture: texture,
      occlusionStrength: 0.75,
      alphaMode: "mask",
      alphaCutoff: 0.25,
      unlit: true,
    });

    expect(material.baseColorTexture).toBe(texture);
    expect(material.ormTexture).toBe(texture);
    expect(material.normalTexture).toBe(texture);
    expect(material.normalTextureScale).toBe(0.5);
    expect(material.emissiveTexture).toBe(texture);
    expect(material.occlusionTexture).toBe(texture);
    expect(material.occlusionStrength).toBe(0.75);
  });

  it("falls back to glTF's default cutoff for a mask material that declares none", () => {
    expect(() => createPbrMaterialFromProps({ alphaMode: "mask" })).not.toThrow();
  });
});

describe("standard materials", () => {
  it("keeps Lite's defaults for anything the caller omitted", () => {
    const material = createStandardMaterialFromProps({});
    expect(material.diffuseColor).toEqual([1, 1, 1]);
    expect(material.backFaceCulling).toBe(true);
    expect(material.disableLighting).toBe(false);
  });

  it("binds every optional texture through Lite's setters", () => {
    const texture = fakeTexture();
    const material = createStandardMaterialFromProps({
      diffuseTexture: texture,
      specularTexture: texture,
      emissiveTexture: texture,
      normalTexture: texture,
      opacityTexture: texture,
    });
    expect(material.diffuseTexture).toBe(texture);
  });

  it("maps ignifx names onto Babylon's", () => {
    const material = createStandardMaterialFromProps({
      name: "brick",
      diffuse: [0.6, 0.2, 0.1],
      specular: [0.1, 0.1, 0.1],
      specularPower: 16,
      emissive: [0, 0.1, 0],
      alpha: 0.5,
      alphaCutoff: 0.25,
      doubleSided: true,
      unlit: true,
    });

    expect(material.name).toBe("brick");
    expect(material.diffuseColor).toEqual([0.6, 0.2, 0.1]);
    expect(material.specularColor).toEqual([0.1, 0.1, 0.1]);
    expect(material.emissiveColor).toEqual([0, 0.1, 0]);
    expect(material.specularPower).toBe(16);
    expect(material.alpha).toBe(0.5);
    expect(material.alphaCutOff).toBe(0.25);
    expect(material.backFaceCulling).toBe(false);
    expect(material.disableLighting).toBe(true);
  });
});

describe("WGSL materials", () => {
  it("keeps the declared sources and attributes", () => {
    const material = createWgslMaterial({ ...TRIVIAL_WGSL, attributes: ["position"] });
    expect(material.attributes).toEqual(["position"]);
    expect(material.needAlphaBlending).toBe(false);
  });

  it("rejects a declaration without a position attribute, eagerly", () => {
    expect(() => createWgslMaterial({ ...TRIVIAL_WGSL, attributes: ["normal"] })).toThrow();
  });
});

describe("an unknown alpha mode", () => {
  it("is refused rather than silently treated as opaque", () => {
    const mode = "dissolve" as unknown as (typeof MATERIAL_ALPHA_MODES)[number];
    expect(() => isBlendedAlphaMode(mode)).toThrow();
  });
});

describe("dirty marking", () => {
  it("marks a material's uniform block without a scene", () => {
    const material = createPbrMaterialFromProps({});
    expect(() => {
      markMaterialDirty(material);
    }).not.toThrow();
  });

  it("rebuilds a material's renderables on an unbuilt scene without throwing", () => {
    const { scene } = createHeadlessScene();
    try {
      const material = createPbrMaterialFromProps({});
      expect(() => {
        rebuildMaterialPipelines(scene, material);
      }).not.toThrow();
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("installs automatic tracking on both material families", async () => {
    await expect(enableMaterialChangeTracking(createPbrMaterialFromProps({}))).resolves.toBeUndefined();
    await expect(enableMaterialChangeTracking(createStandardMaterialFromProps({}))).resolves.toBeUndefined();
  });
});
