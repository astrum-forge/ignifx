import { describe, expect, it } from "vitest";
import { PBR_DEFORMER, readPbrDeformers } from "../../src/lite/pbr-deformers.js";
import type { Mesh } from "@babylonjs/lite";

/**
 * Which deformation kinds a scene's PBR meshes use (`src/lite/pbr-deformers.ts`). The real-device
 * half is `test/render/skinned-model-after-start.browser.test.ts`.
 */

/** A mesh with only the fields the reader looks at. */
interface FakeMesh {
  material: { _buildGroup: { _materialFamily: string } };
  skeleton?: object;
  morphTargets?: object;
}

/**
 * Builds a fake mesh of one material family.
 *
 * @param family - The material family.
 * @param deform - The deformation fields to set.
 * @returns The fake, typed as a Lite mesh.
 */
function mesh(family: string, deform: Pick<FakeMesh, "skeleton" | "morphTargets"> = {}): Mesh {
  const fake: FakeMesh = { material: { _buildGroup: { _materialFamily: family } }, ...deform };
  // Boundary assertion: the reader only looks at `material`, `skeleton` and `morphTargets`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return fake as unknown as Mesh;
}

describe("readPbrDeformers", () => {
  it("reports nothing for rigid PBR meshes", () => {
    expect(readPbrDeformers({ meshes: [mesh("pbr"), mesh("pbr")] })).toBe(0);
  });

  it("reports skinned and morphed PBR meshes", () => {
    expect(readPbrDeformers({ meshes: [mesh("pbr", { skeleton: {} })] })).toBe(PBR_DEFORMER.skin);
    expect(readPbrDeformers({ meshes: [mesh("pbr", { morphTargets: {} })] })).toBe(PBR_DEFORMER.morph);
    expect(readPbrDeformers({ meshes: [mesh("pbr", { skeleton: {} }), mesh("pbr", { morphTargets: {} })] })).toBe(
      PBR_DEFORMER.skin | PBR_DEFORMER.morph,
    );
  });

  it("ignores meshes of other material families", () => {
    expect(
      readPbrDeformers({ meshes: [mesh("standard", { skeleton: {} }), mesh("shader", { morphTargets: {} })] }),
    ).toBe(0);
  });
});
