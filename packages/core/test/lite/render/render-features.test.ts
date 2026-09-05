import { describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../../src/errors/error-codes.js";
import { IgnifxError } from "../../../src/errors/ignifx-error.js";
import { createDirectionalLightInWorld } from "../../../src/lite/light.js";
import {
  applyRenderingFeatures,
  assertRenderingFeatureAvailable,
  enableGltfCameraImport,
  NO_RENDERING_FEATURES,
  registerRenderScene,
  RENDERING_FEATURE_NAMES,
  unregisterRenderScene,
} from "../../../src/lite/render-features.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import type { RenderingFeatures } from "../../../src/lite/render-features.js";

/**
 * Spike S2.3, headless half. Every Lite feature opt-in except device-loss recovery turns out to be
 * device-free — each one only installs a hook or a lazily imported shader fragment — so the whole
 * ordering can be exercised on the null engine. What cannot be checked here is that a **late** call
 * has no effect: Lite reports nothing either way, which is why ignifx polices it with `IGX-0704`.
 */

/** Every feature that needs no device: post-processing and device-loss recovery both do. */
const ALL_DEVICE_FREE_FEATURES: RenderingFeatures = {
  shadows: true,
  postProcessing: false,
  skeletons: true,
  boneControl: true,
  stencil: true,
  lightmaps: true,
  materialPlugins: true,
  asyncPipelines: true,
  deviceLostRecovery: false,
};

describe("the declared feature set", () => {
  it("names the eight blocks of docs/architecture/07-rendering.md §1.1, plus postProcessing", () => {
    // `postProcessing` is not in §1.1's original list: it was added after the Phase 2 visual suite
    // showed that a chain cannot sample the swapchain, which makes the render path a start-time
    // decision (ADR-0002, "Corrections after the visual suite").
    expect([...RENDERING_FEATURE_NAMES]).toEqual([
      "shadows",
      "postProcessing",
      "skeletons",
      "boneControl",
      "stencil",
      "lightmaps",
      "materialPlugins",
      "asyncPipelines",
      "deviceLostRecovery",
    ]);
  });

  it("starts with everything off", () => {
    for (const name of RENDERING_FEATURE_NAMES) {
      expect(NO_RENDERING_FEATURES[name]).toBe(false);
    }
  });
});

describe("applying the opt-ins", () => {
  it("does nothing when nothing is declared", async () => {
    const { engine, scene } = createHeadlessScene();
    try {
      await expect(applyRenderingFeatures(engine, scene, NO_RENDERING_FEATURES)).resolves.toBeUndefined();
      expect(scene.meshes).toHaveLength(0);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("installs every device-free opt-in on the null engine", async () => {
    const { engine, scene } = createHeadlessScene();
    try {
      await applyRenderingFeatures(engine, scene, ALL_DEVICE_FREE_FEATURES);
      // `enableMaterialPlugins` is the only one with an observable effect on the scene: it pushes a
      // refresh hook onto the before-render list (`lib/material/plugin/enable-material-plugins.js`).
      await expect(applyRenderingFeatures(engine, scene, ALL_DEVICE_FREE_FEATURES)).resolves.toBeUndefined();
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("enables glTF camera import independently of the renderer block", () => {
    expect(() => {
      enableGltfCameraImport();
    }).not.toThrow();
  });
});

describe("registering the render scene", () => {
  it("registers a scene with no shadow support", async () => {
    const { scene } = createHeadlessScene();
    try {
      await expect(registerRenderScene(scene, { shadows: false })).resolves.toBeUndefined();
      // Registering twice is a no-op, not an error.
      await expect(registerRenderScene(scene, { shadows: false })).resolves.toBeUndefined();
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("registers a scene with shadow support, even headlessly", async () => {
    const { scene } = createHeadlessScene();
    try {
      addLight(scene);
      await expect(registerRenderScene(scene, { shadows: true })).resolves.toBeUndefined();
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("detaches a registered scene so lights can be changed and it can be registered again", async () => {
    const { scene } = createHeadlessScene();
    try {
      await registerRenderScene(scene, { shadows: false });
      unregisterRenderScene(scene);
      await expect(registerRenderScene(scene, { shadows: false })).resolves.toBeUndefined();
    } finally {
      disposeSceneOnly(scene);
    }
  });
});

describe("refusing a late toggle", () => {
  it("allows a toggle before the scene is registered", () => {
    expect(() => {
      assertRenderingFeatureAvailable("stencil", false);
    }).not.toThrow();
  });

  it("throws IGX-0704 after the scene is registered", () => {
    try {
      assertRenderingFeatureAvailable("stencil", true);
      expect.unreachable("a late toggle must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(IgnifxError);
      expect((error as IgnifxError).code).toBe(CoreErrorCode.renderingFeatureTooLate);
      expect((error as IgnifxError).context).toEqual({ feature: "stencil" });
    }
  });
});

/**
 * Adds a directional light so the shadow-support registration has something to walk.
 *
 * @param scene - The scene to light.
 */
function addLight(scene: Parameters<typeof registerRenderScene>[0]): void {
  scene.lights.push(createDirectionalLightInWorld(1));
}
