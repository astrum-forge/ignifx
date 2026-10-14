import { describe, expect, it } from "vitest";
import { ShadowCasterShapes } from "../../src/lite/shadow-caster-shapes.js";
import type { Mesh } from "@babylonjs/lite";

/**
 * The shape check behind every shadow generator (`src/lite/shadow-caster-shapes.ts`): Babylon Lite
 * redraws a shadow map only when a caster's world matrix moved, so the engine has to notice a new
 * bone pose or new shader uniforms itself. The real-device half is
 * `test/lite/render/deforming-shadow-casters.browser.test.ts`.
 */

/** The Lite material fields the check reads. */
interface FakeMaterial {
  _buildGroup: { _materialFamily: string };
  _uniformVersion?: number;
  _resourceVersion?: number;
  _shadowCasterMaterial?: FakeMaterial;
}

/** A caster with only the fields the check reads. */
interface FakeMesh {
  skeleton?: { boneMatrices: Float32Array };
  material: FakeMaterial;
}

/**
 * Hands a fake caster to the check as a Lite mesh.
 *
 * @param mesh - The fake.
 * @returns The same object, typed as a mesh.
 */
function asMesh(mesh: FakeMesh): Mesh {
  // Boundary assertion: the check reads only `skeleton.boneMatrices` and `material` off a mesh.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return mesh as unknown as Mesh;
}

/** A PBR material, which the check ignores. */
function pbr(): FakeMaterial {
  return { _buildGroup: { _materialFamily: "pbr" } };
}

/** A shader material at version zero. */
function shader(): FakeMaterial {
  return { _buildGroup: { _materialFamily: "shader" }, _uniformVersion: 0, _resourceVersion: 0 };
}

describe("ShadowCasterShapes", () => {
  it("reports nothing while no caster changes", () => {
    const shapes = new ShadowCasterShapes();
    shapes.watch([asMesh({ skeleton: { boneMatrices: new Float32Array(32) }, material: pbr() })]);
    expect(shapes.hasChanged()).toBe(false);
    expect(shapes.hasChanged()).toBe(false);
  });

  it("reports a new bone pose once, however small the change", () => {
    const bones = new Float32Array(32).fill(1);
    const shapes = new ShadowCasterShapes();
    shapes.watch([asMesh({ skeleton: { boneMatrices: bones }, material: pbr() })]);

    // A pose can move inside the same bounding box, which is the case Lite's own check misses.
    bones[1] = 0.999;
    expect(shapes.hasChanged()).toBe(true);
    expect(shapes.hasChanged()).toBe(false);
  });

  it("reports a shader material's uniform or resource change, and ignores other families", () => {
    const material = shader();
    const other = pbr();
    const shapes = new ShadowCasterShapes();
    shapes.watch([asMesh({ material }), asMesh({ material: other })]);

    // oxlint-disable-next-line no-underscore-dangle -- Lite's own field names.
    material._uniformVersion = 1;
    expect(shapes.hasChanged()).toBe(true);
    expect(shapes.hasChanged()).toBe(false);

    // oxlint-disable-next-line no-underscore-dangle -- Lite's own field names.
    material._resourceVersion = 1;
    expect(shapes.hasChanged()).toBe(true);
    expect(shapes.hasChanged()).toBe(false);
  });

  it("follows a shadow-caster override to the material Lite really draws", () => {
    const drawn = shader();
    const shapes = new ShadowCasterShapes();
    shapes.watch([asMesh({ material: { ...pbr(), _shadowCasterMaterial: drawn } })]);
    // oxlint-disable-next-line no-underscore-dangle -- Lite's own field names.
    drawn._uniformVersion = 3;
    expect(shapes.hasChanged()).toBe(true);
  });

  it("forgets the previous list when it watches a new one", () => {
    const bones = new Float32Array(16);
    const shapes = new ShadowCasterShapes();
    shapes.watch([asMesh({ skeleton: { boneMatrices: bones }, material: pbr() })]);
    shapes.watch([asMesh({ material: pbr() })]);
    bones[0] = 5;
    expect(shapes.hasChanged()).toBe(false);
  });
});
