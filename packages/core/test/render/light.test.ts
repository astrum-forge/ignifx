import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Color } from "../../src/math/color.js";
import { Light } from "../../src/render/light.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createRenderHarness, warningsOf } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * `Light` (`docs/architecture/07-rendering.md` §2.2).
 *
 * Every light kind is plain data under the null engine, so the colour decode, the kind switch, the
 * include/exclude sets, and the "a parented light needs its own dirty mark every frame it moved"
 * rule are all testable here. What needs a device is the shadow generator, which is why
 * `IGX-0703` is asserted through the adapter's own guard rather than by trying to build one.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @param shadows - Whether the `shadows` rendering feature is on.
 * @returns The harness.
 */
async function app(shadows = false): Promise<RenderHarness> {
  harness = await createRenderHarness({ settings: { rendering: { features: { shadows } } } });
  return harness;
}

describe("light kinds", () => {
  it("builds the Lite light the type names, and replaces it when the type changes", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    expect(light.lite.light?.lightType).toBe("directional");
    const first = light.lite.light;

    light.type = "point";
    h.frame();
    expect(light.lite.light?.lightType).toBe("point");
    expect(light.lite.light).not.toBe(first);

    light.type = "spot";
    h.frame();
    expect(light.lite.light?.lightType).toBe("spot");

    light.type = "hemispheric";
    h.frame();
    expect(light.lite.light?.lightType).toBe("hemispheric");
  });

  it("adds the light to the scene and takes it out again at detach", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    expect(h.world.lite.scene.lights).toContain(light.lite.light);

    const lite = light.lite.light;
    light.destroy();
    h.frame();
    expect(h.world.lite.scene.lights).not.toContain(lite);
    expect(light.lite.light).toBeNull();
  });
});

describe("colours", () => {
  it("decodes the sRGB colour field to linear before Lite sees it", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light, {
      color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    });
    h.frame();
    const lite = light.lite.light;
    const expected = Color.srgbToLinear(0.5);
    expect(lite?.lightType).toBe("directional");
    if (lite?.lightType === "directional") {
      expect(lite.diffuse[0]).toBeCloseTo(expected, 6);
      expect(lite.specular[0]).toBeCloseTo(expected, 6);
    }
    expect(expected).not.toBeCloseTo(0.5, 3);
  });

  it("writes a hemispheric light's ground colour, which Lite spells differently", async () => {
    const h = await app();
    const light = h.world.createEntity("Sky").addComponent(Light, {
      type: "hemispheric",
      groundColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType === "hemispheric") {
      expect(lite.groundColor[0]).toBeCloseTo(1, 6);
      expect(lite.diffuseColor[0]).toBeCloseTo(1, 6);
    } else {
      expect.unreachable("the light should be hemispheric");
    }
  });

  it("writes a colour only when it changed", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType !== "directional") {
      expect.unreachable("the light should be directional");
      return;
    }
    lite.diffuse[0] = 0.25;
    h.frame();
    expect(lite.diffuse[0]).toBe(0.25);

    light.color = { r: 0, g: 0, b: 0, a: 1 };
    h.frame();
    expect(lite.diffuse[0]).toBeCloseTo(0, 6);
  });
});

describe("kind-specific scalars", () => {
  it("writes range only for the two punctual kinds", async () => {
    const h = await app();
    const light = h.world.createEntity("Bulb").addComponent(Light, { type: "point", range: 25 });
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType === "point") {
      expect(lite.range).toBe(25);
    } else {
      expect.unreachable("the light should be a point light");
    }
  });

  it("writes the spot cone in radians", async () => {
    const h = await app();
    const light = h.world.createEntity("Torch").addComponent(Light, {
      type: "spot",
      spotAngle: 90,
      spotExponent: 4,
    });
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType === "spot") {
      expect(lite.angle).toBeCloseTo(Math.PI / 2, 6);
      expect(lite.exponent).toBe(4);
    } else {
      expect.unreachable("the light should be a spot light");
    }
  });

  it("writes intensity on every kind", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light, { intensity: 3 });
    h.frame();
    expect(light.lite.light?.intensity).toBe(3);
    light.intensity = 7;
    h.frame();
    expect(light.lite.light?.intensity).toBe(7);
  });
});

describe("include and exclude lists", () => {
  it("turns entity references into the mesh-id sets Lite matches on", async () => {
    const h = await app();
    const lit = h.world.createEntity("Lit");
    lit.addComponent(MeshRenderer);
    const light = h.world.createEntity("Sun").addComponent(Light);
    h.frame();
    expect(light.lite.light?.includedOnlyMeshIds).toBeUndefined();

    light.includeOnly.push(lit);
    h.frame();
    expect([...(light.lite.light?.includedOnlyMeshIds ?? [])]).toEqual([lit.uid]);

    light.exclude.push(lit);
    h.frame();
    expect([...(light.lite.light?.excludedMeshIds ?? [])]).toEqual([lit.uid]);
  });

  it("lifts the restriction when the list empties", async () => {
    const h = await app();
    const lit = h.world.createEntity("Lit");
    const light = h.world.createEntity("Sun").addComponent(Light, { includeOnly: [lit] });
    h.frame();
    expect(light.lite.light?.includedOnlyMeshIds).toBeDefined();

    light.includeOnly.length = 0;
    h.frame();
    expect(light.lite.light?.includedOnlyMeshIds).toBeUndefined();
  });

  it("skips a reference the file could not resolve", async () => {
    const h = await app();
    const light = h.world.createEntity("Sun").addComponent(Light, { includeOnly: [null] });
    h.frame();
    expect([...(light.lite.light?.includedOnlyMeshIds ?? [])]).toEqual([]);
  });
});

describe("following the entity", () => {
  it("never parents the Lite light", async () => {
    // The regression the Phase 2 visual suite found: a parented light is rotated twice, because
    // Lite composes `parentWorld × localMatrixFromDirection(direction)` and the component writes a
    // world direction. ADR-0002, "Corrections after the visual suite".
    const h = await app();
    for (const type of ["directional", "point", "spot", "hemispheric"] as const) {
      const light = h.world.createEntity(type).addComponent(Light, { type });
      h.frame();
      expect(light.lite.light?.parent ?? null).toBeNull();
    }
  });

  it("writes the entity's world forward and position onto the light when it moves", async () => {
    const h = await app();
    const entity = h.world.createEntity("Sun");
    const light = entity.addComponent(Light);
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType !== "directional") {
      expect.unreachable("the light should be directional");
      return;
    }

    // Not straight down: `lookAt` has no answer when the forward axis is parallel to world up.
    entity.transform.localPosition.set(0, 10, 10);
    entity.transform.lookAt({ x: 0, y: 0, z: 0 });
    h.frame();

    const diagonal = -Math.SQRT1_2;
    expect(lite.position.y).toBeCloseTo(10, 5);
    expect(lite.position.z).toBeCloseTo(10, 5);
    expect(lite.direction.y).toBeCloseTo(diagonal, 5);
    expect(lite.direction.z).toBeCloseTo(diagonal, 5);
    // The world matrix's third column is what the shader reads; with no parent it is the direction.
    expect(lite.worldMatrix[9]).toBeCloseTo(diagonal, 5);
    expect(lite.worldMatrix[10]).toBeCloseTo(diagonal, 5);
  });

  it("turns the light around when the entity turns around", async () => {
    const h = await app();
    const entity = h.world.createEntity("Sun");
    const light = entity.addComponent(Light);
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType !== "directional") {
      expect.unreachable("the light should be directional");
      return;
    }

    entity.transform.lookAt({ x: 0, y: 0, z: 10 });
    h.frame();
    expect(lite.direction.z).toBeCloseTo(1, 5);

    entity.transform.lookAt({ x: 0, y: 0, z: -10 });
    h.frame();
    expect(lite.direction.z).toBeCloseTo(-1, 5);
  });

  it("gives a hemispheric light the entity's up axis, and no position", async () => {
    const h = await app();
    const entity = h.world.createEntity("Sky");
    const light = entity.addComponent(Light, { type: "hemispheric" });
    entity.transform.localPosition.set(3, 4, 5);
    h.frame();
    const lite = light.lite.light;
    if (lite?.lightType !== "hemispheric") {
      expect.unreachable("the light should be hemispheric");
      return;
    }
    // An unrotated entity's up is +Y, which is what an unposed hemispheric light already had.
    expect([lite.direction.x, lite.direction.y, lite.direction.z]).toEqual([0, 1, 0]);
    expect(lite.worldMatrix[13]).toBeCloseTo(0, 5);

    // Roll it onto its side: the sky moves with the entity.
    entity.transform.lookAt({ x: 0, y: 10, z: 5 });
    h.frame();
    expect(lite.direction.y).toBeLessThan(0.999);
  });
});

describe("shadows", () => {
  it("reports IGX-0703 for a light kind Lite cannot shadow", async () => {
    const { assertShadowsSupported } = await import("../../src/lite/shadow.js");
    let code: string | null = null;
    try {
      assertShadowsSupported("point");
    } catch (error) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe("IGX-0703");
    expect(() => {
      assertShadowsSupported("directional");
    }).not.toThrow();
  });

  it("warns once when a light asks for shadows the project did not enable", async () => {
    const h = await app(false);
    const light = h.world.createEntity("Sun").addComponent(Light);
    light.shadows.enabled = true;
    h.frame();
    h.frame();
    expect(light.isCastingShadows).toBe(false);
    expect(warningsOf(h).filter((line) => line.includes("asks for shadows"))).toHaveLength(1);
  });

  it("casts nothing under a headless app even with the feature on", async () => {
    const h = await app(true);
    const light = h.world.createEntity("Sun").addComponent(Light);
    light.shadows.enabled = true;
    h.frame();
    expect(light.isCastingShadows).toBe(false);
    expect(light.lite.shadowGenerator).toBeNull();
  });
});
