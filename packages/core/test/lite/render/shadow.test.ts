import { describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../../src/errors/error-codes.js";
import { IgnifxError } from "../../../src/errors/ignifx-error.js";
import { createDirectionalLightInWorld, createPointLightInWorld } from "../../../src/lite/light.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import {
  assertShadowsSupported,
  attachShadowGenerator,
  detachShadowGenerator,
  disposeShadowGenerator,
  rebuildRenderables,
  setShadowCasters,
  SHADOW_TECHNIQUES,
  toCsmConfig,
  toEsmConfig,
  toPcfConfig,
  toSpotConfig,
} from "../../../src/lite/shadow.js";
import type { ShadowSettings } from "../../../src/lite/shadow.js";
import type { ShadowGenerator } from "@babylonjs/lite";

/**
 * The shadow adapter's headless half: which light kinds Lite can shadow, how ignifx settings map
 * onto the four generator configurations, and the topology rebuild. Building a generator allocates
 * a depth texture, so that is a browser test.
 */

/** A stand-in for the opaque handle Lite's factories return; the adapter never looks inside one. */
const FAKE_GENERATOR: ShadowGenerator = {};

describe("which lights can cast", () => {
  it("accepts directional and spot lights", () => {
    expect(() => {
      assertShadowsSupported("directional");
    }).not.toThrow();
    expect(() => {
      assertShadowsSupported("spot");
    }).not.toThrow();
  });

  it("rejects a point light with IGX-0703", () => {
    const light = createPointLightInWorld(1);
    try {
      assertShadowsSupported(light.lightType);
      expect.unreachable("a point light must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(IgnifxError);
      expect((error as IgnifxError).code).toBe(CoreErrorCode.shadowsUnsupportedForLight);
    }
  });

  it("rejects a hemispheric light", () => {
    expect(() => {
      assertShadowsSupported("hemispheric");
    }).toThrow(IgnifxError);
  });
});

describe("settings to Lite configuration", () => {
  const full: ShadowSettings = {
    technique: "csm",
    mapSize: 2048,
    bias: 0.001,
    normalBias: 0.02,
    darkness: 0.3,
    cascades: 3,
    maxDistance: 120,
  };

  it("declares exactly three techniques", () => {
    expect([...SHADOW_TECHNIQUES]).toEqual(["esm", "pcf", "csm"]);
  });

  it("omits everything the caller left out, so Lite's defaults apply", () => {
    expect(toEsmConfig({ technique: "esm" })).toEqual({});
    expect(toPcfConfig({ technique: "pcf" })).toEqual({});
    expect(toCsmConfig({ technique: "csm" })).toEqual({});
    expect(toSpotConfig({ technique: "pcf" })).toEqual({});
  });

  it("maps the exponential map's fields", () => {
    expect(toEsmConfig(full)).toEqual({ mapSize: 2048, bias: 0.001, darkness: 0.3 });
  });

  it("maps the filtered directional map's fields, including the normal bias", () => {
    expect(toPcfConfig(full)).toEqual({ mapSize: 2048, bias: 0.001, normalBias: 0.02, darkness: 0.3 });
  });

  it("renames cascades and the maximum distance for the cascaded map", () => {
    expect(toCsmConfig(full)).toEqual({
      mapSize: 2048,
      bias: 0.001,
      darkness: 0.3,
      numCascades: 3,
      shadowMaxZ: 120,
    });
  });

  it("turns the maximum distance into the spot map's far plane", () => {
    expect(toSpotConfig(full)).toEqual({
      mapSize: 2048,
      bias: 0.001,
      normalBias: 0.02,
      darkness: 0.3,
      far: 120,
    });
  });
});

describe("attaching a generator", () => {
  it("links and unlinks it on the light", () => {
    const light = createDirectionalLightInWorld(1);
    attachShadowGenerator(light, FAKE_GENERATOR);
    expect(light.shadowGenerator).toBe(FAKE_GENERATOR);

    detachShadowGenerator(light);
    expect(light.shadowGenerator).toBeUndefined();
  });
});

describe("the caster list", () => {
  it("is accepted headlessly, because it is only a side table keyed by generator", () => {
    expect(() => {
      setShadowCasters(FAKE_GENERATOR, []);
    }).not.toThrow();
  });
});

describe("disposing a generator", () => {
  it("goes through removeFromScene, which recognises it by its private shape", () => {
    const { scene } = createHeadlessScene();
    try {
      expect(() => {
        disposeShadowGenerator(scene, FAKE_GENERATOR);
      }).not.toThrow();
    } finally {
      disposeSceneOnly(scene);
    }
  });
});

describe("rebuilding renderables", () => {
  it("resolves without doing anything on a scene that has never been built", async () => {
    const { scene } = createHeadlessScene();
    try {
      await expect(rebuildRenderables(scene)).resolves.toBeUndefined();
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
