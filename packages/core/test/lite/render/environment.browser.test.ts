import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import {
  FOG_MODES,
  installSceneEnvironment,
  loadSceneEnvironment,
  readSceneEnvironment,
  setSceneClearColor,
  setSceneEnvironmentBlur,
  setSceneEnvironmentRotation,
  setSceneFog,
  setSceneImageProcessingOptions,
  TONE_MAPPING_NAMES,
} from "../../../src/lite/gpu/environment.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../../src/lite/screenshot.js";
import { rebuildRenderables } from "../../../src/lite/shadow.js";
import { assetUrl } from "./fixtures/asset-urls.js";
import { advanceFrames, createRenderHarness } from "./fixtures/gpu-harness.js";
import type { RenderHarness } from "./fixtures/gpu-harness.js";
import type { EnvironmentTextures } from "@babylonjs/lite";

/**
 * The environment adapter against the real sample assets in `tests/fixtures/assets/`: the studio
 * `.env` and the BRDF lookup table Lite requires alongside it.
 *
 * The proof that image based lighting is actually working is that a metal box, which has no diffuse
 * response at all, is *visible*: without an environment it reflects nothing and renders as black.
 */

/** Frames to let the first draw land. */
const WARM_FRAMES = 6;

let current: RenderHarness | null = null;
let loaded: EnvironmentTextures | null = null;

afterEach(() => {
  current?.dispose();
  current = null;
  loaded = null;
});

/**
 * Builds a scene with a mirror-like metal box, optionally lit by the studio environment.
 *
 * @param withEnvironment - Whether to load `studio.env`.
 * @param surface - `"metal"` reflects the specular cube map; `"diffuse"` is lit only by the
 * environment's spherical harmonics, which is what makes a change to them measurable.
 * @returns The running harness.
 */
async function buildScene(withEnvironment: boolean, surface: "metal" | "diffuse" = "metal"): Promise<RenderHarness> {
  const harness = await createRenderHarness({
    size: 48,
    msaaSamples: 1,
    beforeRegister: async (engine, scene) => {
      setSceneClearColor(scene, 0, 0, 0, 1);
      if (withEnvironment) {
        loaded = await loadSceneEnvironment(scene, {
          url: assetUrl("studio.env"),
          brdfUrl: assetUrl("brdf-lut.png"),
          skipSkybox: true,
          skipGround: true,
        });
      }
      const box = createBoxMesh(engine, 2);
      const props =
        surface === "metal"
          ? { baseColor: [1, 1, 1, 1] as const, metallic: 1, roughness: 0.15 }
          : { baseColor: [1, 1, 1, 1] as const, metallic: 0, roughness: 1 };
      setMeshMaterial(box, createPbrMaterialFromProps(props));
      addMeshToScene(scene, box);

      const cameraNode = createNode("camera-entity");
      const camera = createCameraUnderNode(cameraNode);
      setCameraPerspective(camera, 60);
      setCameraClipPlanes(camera, 0.1, 100);
      cameraNode.position.set(0, 0, -5);
      setSceneCamera(scene, camera);
    },
  });
  current = harness;
  await advanceFrames(harness, WARM_FRAMES);
  return harness;
}

/**
 * The luminance of the centre pixel of the next capture.
 *
 * @param harness - The running harness.
 * @returns The luminance, 0 to 255.
 */
async function centreLuminance(harness: RenderHarness): Promise<number> {
  const frame = await captureFrame(harness.engine);
  const pixel = createPixelRgba();
  if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
    throw new Error("the capture was empty");
  }
  return pixelLuminance(pixel);
}

describe("image based lighting from a .env file", () => {
  it("uploads the cube map, the BRDF table, and the spherical harmonics", async () => {
    await buildScene(true);
    expect(loaded).not.toBeNull();
    expect(loaded?.specularCube).toBeDefined();
    expect(loaded?.brdfLut).toBeDefined();
    expect(loaded?.sphericalHarmonics.length).toBe(36);
  });

  it("lights a metal box that has nothing else to reflect", async () => {
    const withEnvironment = await buildScene(true);
    const lit = await centreLuminance(withEnvironment);
    withEnvironment.dispose();
    current = null;

    const withoutEnvironment = await buildScene(false);
    const unlit = await centreLuminance(withoutEnvironment);

    expect(unlit).toBeLessThan(8);
    expect(lit).toBeGreaterThan(unlit + 10);
  });

  it("rotates and blurs the environment without an error", async () => {
    const harness = await buildScene(true);
    setSceneEnvironmentRotation(harness.scene, 90);
    setSceneEnvironmentBlur(harness.scene, 0.5);
    await harness.nextFrame();
    await harness.nextFrame();
    expect(await centreLuminance(harness)).toBeGreaterThan(0);
  });
});

describe("scene background and fog", () => {
  it("writes the clear colour in place", async () => {
    const harness = await buildScene(false);
    setSceneClearColor(harness.scene, 0.1, 0.2, 0.3, 1);
    expect(harness.scene.clearColor).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it("creates, updates, and clears the fog block", async () => {
    const harness = await buildScene(false);
    setSceneFog(harness.scene, "linear", 0.5, 0.5, 0.5, 0.01, 10, 50);
    expect(harness.scene.fog).toEqual({
      mode: FOG_MODES.linear,
      density: 0.01,
      start: 10,
      end: 50,
      color: [0.5, 0.5, 0.5],
    });

    const existing = harness.scene.fog;
    setSceneFog(harness.scene, "exp2", 1, 0, 0, 0.02, 1, 2);
    expect(harness.scene.fog).toBe(existing);
    expect(harness.scene.fog?.mode).toBe(FOG_MODES.exp2);

    setSceneFog(harness.scene, "none", 0, 0, 0, 0, 0, 0);
    expect(harness.scene.fog).toBeNull();
  });
});

describe("image processing", () => {
  it("applies every tone-mapping curve, recompiling the PBR pipelines each time", async () => {
    const harness = await buildScene(true);
    // Sequential on purpose: each curve recompiles the scene's PBR pipelines, and the next
    // assertion only means anything once the previous rebuild has finished.
    await TONE_MAPPING_NAMES.reduce<Promise<void>>(
      (chain, curve) =>
        chain.then(async () => {
          await setSceneImageProcessingOptions(harness.scene, 1.2, 1.1, curve);
          expect(harness.scene.imageProcessing.exposure).toBe(1.2);
          expect(harness.scene.imageProcessing.contrast).toBe(1.1);
          expect(harness.scene.imageProcessing.toneMappingEnabled).toBe(curve !== "none");
        }),
      Promise.resolve(),
    );
  }, 30_000);
});

describe("swapping the installed environment", () => {
  it("reads back what loadEnvironment installed, and moves the scene onto another set", async () => {
    const harness = await buildScene(true);
    const first = loaded;
    expect(first).not.toBeNull();
    // The regression guard for the one undeclared Lite field ignifx touches: if `_envTextures` is
    // renamed or moved, this is `null` and the whole suite says so.
    expect(readSceneEnvironment(harness.scene)).toBe(first);
    expect(installSceneEnvironment(harness.scene, first as EnvironmentTextures)).toBe(false);

    const second = await loadSceneEnvironment(harness.scene, {
      url: assetUrl("studio.env"),
      brdfUrl: assetUrl("brdf-lut.png"),
      skipSkybox: true,
      skipGround: true,
    });
    // A second load is a second upload: Lite installs it itself, so the slot has already moved.
    expect(second).not.toBe(first);
    expect(readSceneEnvironment(harness.scene)).toBe(second);
    // And Lite overwrote the scene's image processing on the way, which is why the `Environment`
    // component re-applies its own after every install.
    expect(harness.scene.imageProcessing.exposure).toBeCloseTo(0.8, 6);

    expect(installSceneEnvironment(harness.scene, first as EnvironmentTextures)).toBe(true);
    expect(readSceneEnvironment(harness.scene)).toBe(first);
    expect(installSceneEnvironment(harness.scene, second)).toBe(true);
    expect(readSceneEnvironment(harness.scene)).toBe(second);
  }, 30_000);

  it("changes what a diffuse surface is lit by, with no rebuild", async () => {
    const harness = await buildScene(true, "diffuse");
    const original = loaded as EnvironmentTextures;
    const lit = await centreLuminance(harness);
    expect(lit).toBeGreaterThan(8);

    // A diffuse surface is lit entirely by the environment's spherical harmonics, and those live in
    // the scene uniform buffer, whose cache key is the identity of the installed set
    // (`lib/frame-graph/render-task.js`). So this needs no renderable rebuild to be visible.
    const dark: EnvironmentTextures = { ...original, sphericalHarmonics: new Float32Array(36) };
    expect(installSceneEnvironment(harness.scene, dark)).toBe(true);
    await advanceFrames(harness, WARM_FRAMES);
    const unlit = await centreLuminance(harness);
    expect(unlit).toBeLessThan(lit - 10);

    installSceneEnvironment(harness.scene, original);
    await advanceFrames(harness, WARM_FRAMES);
    expect(await centreLuminance(harness)).toBeGreaterThan(unlit + 10);
  }, 30_000);

  it("keeps a metal surface lit across a swap once the renderables are rebuilt", async () => {
    const harness = await buildScene(true);
    const first = loaded as EnvironmentTextures;
    const before = await centreLuminance(harness);
    expect(before).toBeGreaterThan(8);

    const second = await loadSceneEnvironment(harness.scene, {
      url: assetUrl("studio.env"),
      brdfUrl: assetUrl("brdf-lut.png"),
      skipSkybox: true,
      skipGround: true,
    });
    installSceneEnvironment(harness.scene, first);
    await rebuildRenderables(harness.scene);
    await advanceFrames(harness, WARM_FRAMES);
    // A bind group holds the cube map's texture view, so the rebuild is what re-binds it. The
    // failure this pins is the interesting one: a stale or dangling view renders black or rejects
    // the frame.
    expect(await centreLuminance(harness)).toBeGreaterThan(8);

    installSceneEnvironment(harness.scene, second);
    await rebuildRenderables(harness.scene);
    await advanceFrames(harness, WARM_FRAMES);
    expect(await centreLuminance(harness)).toBeGreaterThan(8);
  }, 40_000);
});

describe("a skybox from the environment's own cube map", () => {
  it("paints the background when the .env names itself as the skybox source", async () => {
    // `loadEnvironment` treats `skyboxUrl === url` as "reuse the cube map I just uploaded" and
    // builds an HDR cube background; omitting it draws a flat box painted in the clear colour,
    // which on a black scene is indistinguishable from no background at all. This is what the
    // environment loader relies on for a declaration that enables a skybox and names no image.
    const harness = await createRenderHarness({
      size: 48,
      msaaSamples: 1,
      beforeRegister: async (_engine, scene) => {
        setSceneClearColor(scene, 0, 0, 0, 1);
        await loadSceneEnvironment(scene, {
          url: assetUrl("studio.env"),
          brdfUrl: assetUrl("brdf-lut.png"),
          skyboxUrl: assetUrl("studio.env"),
          skyboxSize: 60,
          skipGround: true,
        });
        const cameraNode = createNode("camera-entity");
        const camera = createCameraUnderNode(cameraNode);
        setCameraPerspective(camera, 60);
        setCameraClipPlanes(camera, 0.1, 100);
        setSceneCamera(scene, camera);
      },
    });
    current = harness;
    await advanceFrames(harness, WARM_FRAMES);
    // Nothing is in the scene but the background, so any lit pixel is the cube map.
    expect(await centreLuminance(harness)).toBeGreaterThan(8);
  }, 30_000);
});
