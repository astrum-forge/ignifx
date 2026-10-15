import { describe, expect, it } from "vitest";
import { IgnifxError } from "../../../src/errors/ignifx-error.js";
import {
  addLightToScene,
  createDirectionalLightInWorld,
  createHemisphericLightInWorld,
  createPointLightInWorld,
  createSpotLightInWorld,
  markLightTransformDirty,
  removeLightFromScene,
  setHemisphericGroundColor,
  setLightColor,
  setLightExcludedMeshIds,
  setLightIncludedMeshIds,
  setLightIntensity,
  setLightRange,
  setSpotAngle,
  setSpotExponent,
  syncLightWorldPose,
} from "../../../src/lite/light.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import { degToRad } from "../../../src/math/math-utils.js";

/**
 * The light adapter, headless. Every Lite light is plain data with a lazily composed world matrix,
 * so all of this runs on the null engine; only shadow generators need a device.
 *
 * The claim under test throughout is the one the Phase 2 visual suite forced: an ignifx light is
 * **never parented** in Lite, and `syncLightWorldPose` is the single place its world pose is
 * written — so the world direction and position Lite derives for shading and for the shadow
 * frustum are exactly the ones written.
 */

/**
 * The world-space direction Lite shades and fits shadows with: `direction` rotated by the light's
 * world matrix and normalised (`writeWorldLightDirection`, `lib/light/light-base.js`).
 */
function liteWorldDirection(light: {
  readonly worldMatrix: ArrayLike<number>;
  readonly direction: { x: number; y: number; z: number };
}): number[] {
  const w = light.worldMatrix;
  const d = light.direction;
  const x = (w[0] ?? 0) * d.x + (w[4] ?? 0) * d.y + (w[8] ?? 0) * d.z;
  const y = (w[1] ?? 0) * d.x + (w[5] ?? 0) * d.y + (w[9] ?? 0) * d.z;
  const z = (w[2] ?? 0) * d.x + (w[6] ?? 0) * d.y + (w[10] ?? 0) * d.z;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/**
 * The counter Lite re-uploads the lights uniform buffer and refits a shadow on
 * (`lib/render/scene-lights-ubo.js`, `computeLightsVersion`; `lib/shadow/pcf-shadow-task-hooks.js`).
 * It is not in `index.d.ts`, so the test reads it by name.
 */
function lightVersion(light: object): number {
  const version: unknown = Reflect.get(light, "_lightVersion");
  expect(version).toBeTypeOf("number");
  return Number(version);
}

function expectCloseTo(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 6);
  });
}

describe("light creation", () => {
  it("points a directional light along +Z, unparented", () => {
    const light = createDirectionalLightInWorld(3);
    expect(light.lightType).toBe("directional");
    expect([light.direction.x, light.direction.y, light.direction.z]).toEqual([0, 0, 1]);
    expect(light.intensity).toBe(3);
    expect(light.parent ?? null).toBeNull();
  });

  it("puts a point light at the world origin, unparented", () => {
    const light = createPointLightInWorld(2);
    expect(light.lightType).toBe("point");
    expect([light.position.x, light.position.y, light.position.z]).toEqual([0, 0, 0]);
    expect(light.parent ?? null).toBeNull();
  });

  it("takes the spot cone angle in degrees and stores it in radians", () => {
    const light = createSpotLightInWorld(45, 4, 1);
    expect(light.lightType).toBe("spot");
    expect(light.angle).toBeCloseTo(degToRad(45), 10);
    expect(light.exponent).toBe(4);
  });

  it("aims a hemispheric light's sky direction along +Y", () => {
    const light = createHemisphericLightInWorld(1);
    expect(light.lightType).toBe("hemispheric");
    expect([light.direction.x, light.direction.y, light.direction.z]).toEqual([0, 1, 0]);
  });

  it("leaves every kind unparented, so its world matrix is its own pose", () => {
    // A Lite light is a scene node whose world matrix rotates its local `direction`
    // (`lib/light/light-base.js`). With no parent and no rotation, the direction Lite shades with
    // is exactly what `syncLightWorldPose` wrote.
    expect(createDirectionalLightInWorld(1).parent ?? null).toBeNull();
    expect(createPointLightInWorld(1).parent ?? null).toBeNull();
    expect(createSpotLightInWorld(45, 2, 1).parent ?? null).toBeNull();
    expect(createHemisphericLightInWorld(1).parent ?? null).toBeNull();
  });
});

describe("posing a light in world space", () => {
  it("writes a directional light's direction and position, and its world matrix agrees", () => {
    const light = createDirectionalLightInWorld(1);
    syncLightWorldPose(light, 0, -1, 0, 0, 0, 1, 2, 10, -3);

    expect([light.direction.x, light.direction.y, light.direction.z]).toEqual([0, -1, 0]);
    expect([light.position.x, light.position.y, light.position.z]).toEqual([2, 10, -3]);
    // The world matrix is a pure translation, so Lite's world direction is the written one.
    const world = light.worldMatrix;
    expectCloseTo(
      [world[0], world[1], world[2], world[4], world[5], world[6], world[8], world[9], world[10]].map(
        (v) => v ?? Number.NaN,
      ),
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    );
    expectCloseTo(
      [world[12], world[13], world[14]].map((v) => v ?? Number.NaN),
      [2, 10, -3],
    );
    expectCloseTo(liteWorldDirection(light), [0, -1, 0]);
  });

  it("writes both vectors for a spot light, whose UBO row reads world position too", () => {
    const light = createSpotLightInWorld(45, 2, 1);
    syncLightWorldPose(light, 1, 0, 0, 0, 1, 0, 4, 5, 6);

    expect([light.direction.x, light.direction.y, light.direction.z]).toEqual([1, 0, 0]);
    expectCloseTo(liteWorldDirection(light), [1, 0, 0]);
    const world = light.worldMatrix;
    expect(world[12]).toBeCloseTo(4, 6);
    expect(world[13]).toBeCloseTo(5, 6);
    expect(world[14]).toBeCloseTo(6, 6);
  });

  it("writes only the position of a point light, which has no direction", () => {
    const light = createPointLightInWorld(1);
    syncLightWorldPose(light, 0, -1, 0, 0, 0, 1, 7, 8, 9);
    expect([light.position.x, light.position.y, light.position.z]).toEqual([7, 8, 9]);
    expect(light.worldMatrix[13]).toBeCloseTo(8, 6);
  });

  it("gives a hemispheric light the entity's UP axis, not its forward, and no position", () => {
    // A hemispheric light's direction is where the sky is, so it follows the entity's up axis.
    // Writing the forward axis instead unlit every surface facing the camera.
    const light = createHemisphericLightInWorld(1);
    syncLightWorldPose(light, 0, 0, 1, 0.5, 0.5, 0, 7, 8, 9);
    expect([light.direction.x, light.direction.y, light.direction.z]).toEqual([0.5, 0.5, 0]);
    expectCloseTo(liteWorldDirection(light), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    expect(light.worldMatrix[13]).toBeCloseTo(0, 6);
  });

  it("bumps the light's version, so the lights uniform buffer re-uploads", () => {
    const light = createDirectionalLightInWorld(1);
    const before = lightVersion(light);
    syncLightWorldPose(light, 0, -1, 0, 0, 0, 1, 0, 5, 0);
    expect(lightVersion(light)).toBeGreaterThan(before);
  });

  it("bumps the version even when only the direction changes", () => {
    // Writing `direction` does not move the scene-node transform, so `worldMatrixVersion` stays
    // put; Lite's own light counter is what the UBO and the shadow refit read.
    const light = createSpotLightInWorld(45, 2, 1);
    syncLightWorldPose(light, 0, 0, 1, 0, 1, 0, 1, 2, 3);
    const before = lightVersion(light);
    syncLightWorldPose(light, 1, 0, 0, 0, 1, 0, 1, 2, 3);
    expect(lightVersion(light)).toBeGreaterThan(before);
    expectCloseTo(liteWorldDirection(light), [1, 0, 0]);
  });

  it("refuses a light kind the union does not cover", () => {
    const alien = { lightType: "volumetric" } as unknown as ReturnType<typeof createPointLightInWorld>;
    expect(() => {
      syncLightWorldPose(alien, 0, 0, 1, 0, 1, 0, 0, 0, 0);
    }).toThrow(IgnifxError);
  });
});

describe("light properties", () => {
  it("writes diffuse and specular for the punctual kinds", () => {
    const light = createDirectionalLightInWorld(1);
    setLightColor(light, 0.5, 0.25, 0.125);
    expect(light.diffuse).toEqual([0.5, 0.25, 0.125]);
    expect(light.specular).toEqual([0.5, 0.25, 0.125]);
  });

  it("writes diffuseColor and specularColor for a hemispheric light", () => {
    // `docs/architecture/07-rendering.md` §2.2 names these `diffuse`/`specular` for every light
    // type; Lite spells them differently for this one (`index.d.ts` 6286).
    const light = createHemisphericLightInWorld(1);
    setLightColor(light, 1, 0, 0);
    setHemisphericGroundColor(light, 0, 0, 1);
    expect(light.diffuseColor).toEqual([1, 0, 0]);
    expect(light.specularColor).toEqual([1, 0, 0]);
    expect(light.groundColor).toEqual([0, 0, 1]);
  });

  it("sets intensity, range, cone angle, and exponent", () => {
    const spot = createSpotLightInWorld(30, 2, 1);
    setLightIntensity(spot, 7);
    setLightRange(spot, 25);
    setSpotAngle(spot, 90);
    setSpotExponent(spot, 8);

    expect(spot.intensity).toBe(7);
    expect(spot.range).toBe(25);
    expect(spot.angle).toBeCloseTo(Math.PI / 2, 10);
    expect(spot.exponent).toBe(8);
  });

  it("sets and clears the include and exclude mesh id sets", () => {
    const light = createPointLightInWorld(1);
    setLightIncludedMeshIds(light, new Set(["a"]));
    setLightExcludedMeshIds(light, new Set(["b"]));
    expect(light.includedOnlyMeshIds?.has("a")).toBe(true);
    expect(light.excludedMeshIds?.has("b")).toBe(true);

    setLightIncludedMeshIds(light, null);
    setLightExcludedMeshIds(light, null);
    expect(light.includedOnlyMeshIds).toBeUndefined();
    expect(light.excludedMeshIds).toBeUndefined();
  });
});

describe("marking a light dirty without moving it", () => {
  it("bumps the light's own change counters without changing its values", () => {
    // Lite only re-uploads the lights uniform buffer when a light's `_lightVersion` moves
    // (`lib/render/scene-lights-ubo.js`), and a plain field such as a colour does not move it, so
    // anything that changes a light that way needs this.
    for (const light of [
      createDirectionalLightInWorld(1),
      createSpotLightInWorld(45, 2, 1),
      createHemisphericLightInWorld(1),
    ]) {
      const before = lightVersion(light);
      const direction = [light.direction.x, light.direction.y, light.direction.z];

      markLightTransformDirty(light);

      expect(lightVersion(light)).toBeGreaterThan(before);
      expect([light.direction.x, light.direction.y, light.direction.z]).toEqual(direction);
    }
  });

  it("works for a point light, which has no direction of its own", () => {
    const light = createPointLightInWorld(1);
    syncLightWorldPose(light, 0, 0, 1, 0, 1, 0, 7, 8, 9);
    const before = lightVersion(light);
    markLightTransformDirty(light);
    expect(lightVersion(light)).toBeGreaterThan(before);
    expect([light.position.x, light.position.y, light.position.z]).toEqual([7, 8, 9]);
  });

  it("marks the light when a colour, intensity, range, angle or exponent changes", () => {
    const spot = createSpotLightInWorld(30, 2, 1);
    let version = lightVersion(spot);
    for (const change of [
      () => {
        setLightColor(spot, 0.5, 0.5, 0.5);
      },
      () => {
        setLightIntensity(spot, 4);
      },
      () => {
        setLightRange(spot, 12);
      },
      () => {
        setSpotAngle(spot, 60);
      },
      () => {
        setSpotExponent(spot, 3);
      },
    ]) {
      change();
      expect(lightVersion(spot)).toBeGreaterThan(version);
      version = lightVersion(spot);
    }
  });
});

describe("an unknown light kind", () => {
  it("is refused by the colour setter rather than silently ignored", () => {
    // The union is exhaustive, so this can only happen if Lite grows a light type; `assertNever`
    // is what turns that into a diagnosable failure instead of a no-op.
    const alien = { lightType: "volumetric" } as unknown as ReturnType<typeof createPointLightInWorld>;
    expect(() => {
      setLightColor(alien, 1, 1, 1);
    }).toThrow(IgnifxError);
  });

  it("is refused by the dirty marker", () => {
    const alien = { lightType: "volumetric" } as unknown as ReturnType<typeof createPointLightInWorld>;
    expect(() => {
      markLightTransformDirty(alien);
    }).toThrow(IgnifxError);
  });
});

describe("scene membership", () => {
  it("adds and removes a light", () => {
    const { scene } = createHeadlessScene();
    const light = createDirectionalLightInWorld(1);
    try {
      addLightToScene(scene, light);
      expect(scene.lights).toContain(light);

      removeLightFromScene(scene, light);
      expect(scene.lights).not.toContain(light);
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
