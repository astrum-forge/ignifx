import { setBonePosition } from "@babylonjs/lite";
import { afterEach, describe, expect, it } from "vitest";
import { waitForGpuWork } from "../../../src/lite/gpu/render-diagnostics-gpu.js";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../../src/lite/screenshot.js";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { Model } from "../../../src/render/model.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../../src/render/shader-pragma.js";
import { loadShaderSupport } from "../../../src/render/shader-support.js";
import { createBrowserApp, fixtureUrl, SETTLE_FRAMES } from "../../render/support/browser-harness.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { CapturedFrame } from "../../../src/lite/screenshot.js";
import type { ShadowTechniqueName } from "../../../src/render/light.js";
import type { MaterialAsset } from "../../../src/render/material-asset.js";
import type { ModelAsset } from "../../../src/render/model-asset.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";

/**
 * Shadows of casters that change shape without moving (`docs/architecture/07-rendering.md` §2.2).
 *
 * Babylon Lite redraws a shadow map only when a caster's world matrix or the light moved, so a
 * skinned model's shadow used to stay in whatever pose the map was first drawn with, and so did a
 * shader material that moves its vertices by a uniform.
 *
 * Every scene keeps the caster **out of the camera's view** and frames only the ground its shadow
 * falls on: a light 45 degrees up from behind the caster throws its shadow forward, and the camera
 * looks down at that stretch of ground from further forward still. So the only thing that can
 * change between two captures is the shadow, and a frozen map shows up as two identical frames.
 *
 * The rig is `tests/fixtures/assets/3d/rig.glb`: a box-man whose arms hang from the hips joint at
 * `(±0.4, 1.05)`, each arm box centred on its joint. The tests move the left arm by its joint's
 * translation through Lite's bone control, which writes the bone matrices exactly as an animation
 * clip does, and leave the mesh, the light and the camera alone.
 *
 * This file lives under `test/lite/**` because it poses the rig through Babylon Lite's bone control,
 * the one directory outside `src/lite/**` the adapter-boundary rule allows to import Lite.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge; large enough that a half-metre strip of ground covers a few dozen pixels. */
const SIZE = 96;

/** How much darker or brighter a pixel has to get before it counts as changed, as a fraction. */
const CHANGE = 0.2;

/** How many pixels have to change before a shadow counts as having moved. */
const MOVED_PIXELS = 20;

/** The left arm joint's own translation in the rig, relative to the hips. */
const ARM_REST = { x: -0.4, y: 0.5, z: 0 } as const;

/** The ways a light can cast: the three directional techniques and a spot light. */
type CasterLight = ShadowTechniqueName | "spot";

/**
 * Stops the loop and drains the queue before disposing, so a shadow pass in flight cannot surface
 * after the device is gone.
 *
 * @param running - The running app.
 */
async function teardown(running: BrowserApp): Promise<void> {
  running.app.stop();
  await waitForGpuWork(running.app.lite.engine);
  running.dispose();
  harness = null;
}

/**
 * Builds a white ground, a light behind the origin, and a camera looking down at the ground in
 * front of it, then runs `addCaster` to put something at the origin.
 *
 * @param light - The light and technique.
 * @param addCaster - Adds the caster; it runs after the app started.
 * @returns The running app.
 */
async function buildScene(light: CasterLight, addCaster: (running: BrowserApp) => Promise<void>): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [{ address: "models/rig.glb", url: fixtureUrl("3d/rig.glb"), type: "model" }],
    settings: { rendering: { msaaSamples: 1, features: { shadows: true, boneControl: true } } },
  });
  harness = running;

  // Down and back at the ground from about 1.7 to 7.6 metres in front of the origin. Whatever
  // stands at the origin, even five metres tall, is below the bottom edge of the frame.
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 9, 9);
  eye.transform.lookAt({ x: 0, y: 0, z: 5 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 30 });

  const sun = running.world.createEntity("Sun");
  if (light === "spot") {
    // High and far back, so its cone covers the caster and the ground and the shadow lands in view.
    sun.transform.localPosition.set(0, 14, -14);
    sun.transform.lookAt({ x: 0, y: 0, z: 3 });
    const spot = sun.addComponent(Light, { type: "spot", intensity: 40, range: 60, spotAngle: 70 });
    spot.shadows.enabled = true;
    spot.shadows.mapSize = 1024;
  } else {
    sun.transform.localPosition.set(0, 10, -10);
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    const directional = sun.addComponent(Light, { type: "directional", intensity: 3 });
    directional.shadows.enabled = true;
    directional.shadows.technique = light;
    directional.shadows.mapSize = 1024;
  }

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 40, height: 40, subdivisions: 1 }),
    materials: [white],
    castShadows: false,
    receiveShadows: true,
  });

  await running.start();
  await addCaster(running);
  await running.advance(SETTLE_FRAMES * 4);
  return running;
}

/**
 * Counts the pixels that got materially darker, and materially brighter, between two captures.
 *
 * @param before - The earlier capture.
 * @param after - The later capture.
 * @returns The two counts.
 */
function changedPixels(before: CapturedFrame, after: CapturedFrame): { darker: number; brighter: number } {
  const a = createPixelRgba();
  const b = createPixelRgba();
  let darker = 0;
  let brighter = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      if (samplePixel(before, x, y, a) === null || samplePixel(after, x, y, b) === null) {
        continue;
      }
      const start = pixelLuminance(a);
      const end = pixelLuminance(b);
      if (end < start * (1 - CHANGE)) {
        darker += 1;
      } else if (end > (start + 1) * (1 + CHANGE)) {
        brighter += 1;
      }
    }
  }
  return { darker, brighter };
}

/**
 * Loads the rig at the origin, twice life size.
 *
 * @param light - The light and technique.
 * @returns The running app and the rig's model.
 */
async function buildRigScene(light: CasterLight): Promise<{ readonly running: BrowserApp; readonly model: Model }> {
  // A one-element slot rather than a `let`: the compiler cannot see the callback run, so a `let`
  // would still be narrowed to `null` afterwards.
  const added: Model[] = [];
  const running = await buildScene(light, async (app) => {
    const handle = await app.app.assets.loadAsync<ModelAsset>("models/rig.glb");
    const rig = app.world.createEntity("Rig");
    rig.transform.localScale.set(2, 2, 2);
    added.push(rig.addComponent(Model, { model: handle, castShadows: true, receiveShadows: false }));
  });
  const model = added[0];
  if (model === undefined) {
    throw new Error("the rig was not added");
  }
  return { running, model };
}

/**
 * Moves the rig's left arm joint, through Babylon Lite's bone control.
 *
 * @param model - The rig's model.
 * @param y - The joint's height above the hips, in the rig's own metres.
 */
function placeLeftArm(model: Model, y: number): void {
  const skeleton = model.skeletons[0];
  const arm = skeleton?.bones.find((bone) => bone.name === "armL");
  if (skeleton === undefined || arm === undefined) {
    throw new Error("rig.glb has no armL bone");
  }
  setBonePosition(skeleton, arm, ARM_REST.x, y, ARM_REST.z);
}

/**
 * Captures the ground, moves the left arm to `y`, captures again, puts the arm back, and captures
 * a third time.
 *
 * @param light - The light and technique.
 * @param y - Where the arm joint goes, above the hips.
 * @returns The pixel changes after moving and after restoring, and how many errors the app reported.
 */
async function measureArm(
  light: CasterLight,
  y: number,
): Promise<{
  readonly moved: { darker: number; brighter: number };
  readonly restored: { darker: number; brighter: number };
  readonly errors: number;
}> {
  const { running, model } = await buildRigScene(light);
  const rest = await running.app.renderer.captureScreenshot();
  placeLeftArm(model, y);
  await running.advance(SETTLE_FRAMES);
  const posed = await running.app.renderer.captureScreenshot();
  placeLeftArm(model, ARM_REST.y);
  await running.advance(SETTLE_FRAMES);
  const back = await running.app.renderer.captureScreenshot();
  const errors = running.errors.length;
  await teardown(running);
  return { moved: changedPixels(rest, posed), restored: changedPixels(posed, back), errors };
}

describe("a skinned caster's shadow", () => {
  it.each<CasterLight>(["pcf", "esm", "csm", "spot"])(
    "follows the pose under %s",
    async (light) => {
      // A metre higher, the arm floats above the head, outside the bind pose's box: its shadow
      // leaves the ground near the rig and lands further out, which only works when the shadow
      // frustum is fitted to the posed bounds.
      const { moved, restored, errors } = await measureArm(light, ARM_REST.y + 1);
      expect(moved.darker).toBeGreaterThan(MOVED_PIXELS);
      expect(restored.brighter).toBeGreaterThan(MOVED_PIXELS);
      expect(errors).toBe(0);
    },
    60_000,
  );

  it("follows a pose that stays inside the same bounding box", async () => {
    // 0.35 m lower, the arm still lies between the hips' lowest point and the torso's highest, and
    // inside the torso's depth, so the rig's bounding box does not change at all — the case Babylon
    // Lite's own skeleton-shadow check misses. Its shadow moves 0.7 m towards the rig.
    const { moved, restored, errors } = await measureArm("pcf", ARM_REST.y - 0.35);
    expect(moved.brighter).toBeGreaterThan(MOVED_PIXELS);
    expect(restored.darker).toBeGreaterThan(MOVED_PIXELS);
    expect(errors).toBe(0);
  }, 60_000);
});

/**
 * A white shader-material box whose vertex stage scales it by a uniform. It only ever shrinks,
 * because a directional PCF or ESM frustum is fitted to the mesh's own bounds, which know nothing
 * of what the vertex stage does.
 */
const SHRINKING_WGSL = `// @ignifx shader
// @ignifx attributes position
// @ignifx system worldViewProjection
// @ignifx uniform size: f32 = 1

struct VertexOutput { @builtin(position) position: vec4<f32> }

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position * shaderUniforms.size, 1.0);
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

describe("a shader-material caster's shadow", () => {
  it.each<ShadowTechniqueName>(["pcf", "csm"])(
    "follows a uniform that moves its vertices under %s",
    async (light) => {
      const created: AssetHandle<MaterialAsset>[] = [];
      const running = await buildScene(light, async (app) => {
        await loadShaderSupport();
        const address = "memory:shaders/shrinking.wgsl";
        const shader = app.app.assets.register(
          new ShaderAsset(address, SHRINKING_WGSL, parseShaderDeclaration(SHRINKING_WGSL, address)),
          { type: SHADER_ASSET_TYPE, address },
        );
        const material = createMaterialAsset(app.app, shaderMaterialDefinition({ shader, name: "shrinking" }), []);
        created.push(material);
        const box = app.world.createEntity("Box");
        box.transform.localPosition.set(0, 3, 0);
        box.addComponent(MeshRenderer, { mesh: MeshAsset.box(app.app, { size: 2 }), materials: [material] });
      });
      const material = created[0];
      if (material === undefined) {
        throw new Error("the shader material was not created");
      }
      const full = await running.app.renderer.captureScreenshot();
      // The engine writes `time` to Lite through the same call, so this stands in for a clock-driven
      // vertex stage without depending on how long a software frame takes.
      material.value.setUniform("size", 0.4);
      await running.advance(SETTLE_FRAMES);
      const small = await running.app.renderer.captureScreenshot();
      material.value.setUniform("size", 1);
      await running.advance(SETTLE_FRAMES);
      const back = await running.app.renderer.captureScreenshot();
      const shrunk = changedPixels(full, small);
      const grown = changedPixels(small, back);
      const errors = running.errors.length;
      await teardown(running);
      // The shadow shrinks, lighting the ground around it, and grows back.
      expect(shrunk.brighter).toBeGreaterThan(MOVED_PIXELS);
      expect(grown.darker).toBeGreaterThan(MOVED_PIXELS);
      expect(errors).toBe(0);
    },
    60_000,
  );
});
