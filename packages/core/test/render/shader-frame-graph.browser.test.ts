import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { InstancedMeshRenderer } from "../../src/render/instanced-mesh-renderer.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { loadShaderSupport } from "../../src/render/shader-support.js";
import { createStorageBufferAsset } from "../../src/render/storage-buffer-asset.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import { createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { Entity } from "../../src/entity/entity.js";
import type { EnvironmentFogMode } from "../../src/render/environment.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";

/**
 * A blended, thin-instanced shader material that joins a **registered** scene — the shape a
 * `@ignifx/particles` cloud has — beside scene state that changes what Babylon Lite compiles:
 * `Environment.fog` and `rendering.features.shadows`.
 *
 * Both combinations were reported from the website's particle examples as a frame that dies with
 * `beginRenderPass … colorAttachments[0].view … Required member is undefined` and a black canvas.
 * The cause was two overlapping `rebuildSceneRenderables` runs, each of whose `finally` rebuilds the
 * frame graph over what the other left half torn down; `RenderSyncSystem.#drainRebuilds` records the
 * mechanism, and `test/render/rebuild-serialisation.test.ts` pins the serialisation itself. The
 * soaks below are the integration side of that: fog, a shadow pass, and a generated program handed
 * to a live thin-instanced renderer over and over, which is what made the window wide enough to hit.
 */

let harness: BrowserApp | null = null;

/**
 * Collects the errors Lite throws out of its own `requestAnimationFrame` callback.
 *
 * @remarks
 * A `beginRenderPass` that fails validation throws inside Lite's frame callback, which is outside
 * every ignifx `try` — so it never reaches `app.onError` and only the window sees it.
 *
 * @param collected - The array to push messages into.
 * @returns A function that removes the listener.
 */
function collectFrameErrors(collected: string[]): () => void {
  const onError = (event: ErrorEvent): void => {
    collected.push(event.message);
  };
  globalThis.addEventListener("error", onError);
  return (): void => {
    globalThis.removeEventListener("error", onError);
  };
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 64;

/** How many frames the reported failure needs to appear. */
const SOAK_FRAMES = 120;

/** How long the material-swap soak runs. */
const SWAP_FRAMES = 90;

/** How often it hands both clouds a different generated program. */
const SWAP_EVERY = 3;

/** How many distinct PBR materials stand in the scene, so a group rebuild is real work. */
const PBR_MESHES = 8;

/** How many thin-instanced clouds are handed a new program together, as the weather toggle does. */
const CLOUDS = 2;

/** How many floats one instance matrix occupies. */
const MATRIX_FLOATS = 16;

/** How many floats one particle record occupies, matching the `Particle` struct below. */
const RECORD_FLOATS = 16;

/** How many records the ring holds. */
const RING_SLOTS = 64;

/** The ring's length in floats. */
const RING_FLOATS = RECORD_FLOATS * RING_SLOTS;

/** The 1x1 ramp texture the generated program samples. */
const WHITE_TEXEL = new Uint8Array([255, 255, 255, 255]);

/** The fog colour the visibility test uses: red, so it cannot be confused with the lit wall. */
const RED_FOG = { r: 1, g: 0, b: 0 };

/** A premultiplied, depth-write-off, thin-instanced shader material: a particle quad in miniature. */
const PARTICLE_QUAD_WGSL = `// @ignifx shader
// @ignifx attributes position, uv
// @ignifx system view, viewProjection
// @ignifx storage particles: array<Particle>
// @ignifx texture lut default white
// @ignifx uniform clock: f32 = 0
// @ignifx blend premultiplied cull none depthWrite off instancing matrices

struct Particle {
  spawnTime: f32,
  lifetime: f32,
  seed: u32,
  flags: u32,
  @align(16) position: vec3<f32>,
  size: f32,
  @align(16) velocity: vec3<f32>,
  rotation: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput, @builtin(instance_index) iid: u32) -> VertexOutput {
  var out: VertexOutput;
  let record = particles[iid];
  let instance = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let local = vec4<f32>(input.position * record.size + record.position, 1.0);
  out.position = shaderSystem.viewProjection * instance * local;
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let ramp = textureSample(lut, lutSampler, input.uv).rgb;
  return vec4<f32>(ramp * vec3<f32>(0.0, 1.0, 0.0) + vec3<f32>(0.0, 0.25, 0.0), 1.0);
}
`;

/** How a soak scene is set up. */
interface SoakOptions {
  /** The fog mode an `Environment` declares before the app starts, if any. */
  readonly fog?: EnvironmentFogMode;
  /** Whether the scene registers with a shadow pass. */
  readonly shadows?: boolean;
  /**
   * `true` swaps the cloud onto a second shader material half way through the soak, the way the
   * weather example's "Lit particles" toggle hands its system a different generated document.
   */
  readonly swapDocument?: boolean;
}

/**
 * Builds a lit PBR scene, starts it, and only then adds a blended thin-instanced shader material —
 * the order a `ParticleSystem` produces, because its generated `.wgsl` is compiled after start.
 *
 * @param options - Fog and shadows.
 * @returns The running app.
 */
async function soakScene(options: SoakOptions): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: options.shadows === true } } },
  });
  harness = running;
  running.app.registerComponents([InstancedMeshRenderer]);
  await loadShaderSupport();

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -4);
  eye.addComponent(Camera, { near: 0.1, far: 100 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(0, 6, -2);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = options.shadows === true;

  const sky = running.world.createEntity("Environment").addComponent(Environment, {});
  sky.imageProcessing.toneMapping = "aces";
  if (options.fog !== undefined) {
    sky.fog.mode = options.fog;
    sky.fog.density = 0.01;
  }

  // A PBR mesh well behind the quad, so the scene carries a PBR group that fog and the shadow pass
  // both change.
  const floor = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 0.2, g: 0.2, b: 0.25, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const backdrop = running.world.createEntity("Backdrop");
  backdrop.transform.localPosition.set(0, 0, 6);
  backdrop.addComponent(MeshRenderer, {
    mesh: MeshAsset.plane(running.app, { width: 40, height: 40 }),
    materials: [floor],
    castShadows: false,
  });

  await running.start();
  await running.advance(SETTLE_FRAMES);

  const ring = new Float32Array(RING_FLOATS);
  for (let index = 0; index < RING_SLOTS; index += 1) {
    ring[index * RECORD_FLOATS + 1] = 100;
    ring[index * RECORD_FLOATS + 7] = 1;
  }
  const storage = createStorageBufferAsset(running.app, "memory:particles-ring", ring);
  const lut = TextureAsset.fromPixels(running.app, "memory:particles-lut", WHITE_TEXEL, 1, 1, {
    filter: "linear",
    wrap: "clamp",
  });

  let cloud = addCloud(running, "memory:shaders/particle-quad.wgsl", storage, lut);
  for (let frame = 0; frame < SOAK_FRAMES; frame += 1) {
    if (options.swapDocument === true && frame === SOAK_FRAMES >> 1) {
      cloud.entity.destroy();
      cloud = addCloud(running, "memory:shaders/particle-quad-lit.wgsl", storage, lut);
    }
    // A particle system rewrites its ring and its clock every frame, which is what keeps the
    // material's bindings moving long after the scene was registered.
    cloud.material.value.setUniform("clock", frame / 60);
    storage.value.update(ring.subarray(0, RECORD_FLOATS), 0);
    // oxlint-disable-next-line no-await-in-loop -- frame `n + 1` genuinely depends on frame `n`.
    await running.nextFrame();
  }
  return running;
}

/**
 * Publishes one generated `.wgsl`, builds a `"shader"` material on it, and hangs a thin-instanced
 * quad off a fresh entity — what `ParticleSystem.#ensureGpu` does once its shader has loaded.
 *
 * @param running - The running app.
 * @param address - The address to publish the source under; a second address means a second program.
 * @param storage - The ring buffer the program reads.
 * @param lut - The ramp texture it samples.
 * @returns The entity, its renderer, and its material.
 */
function addCloud(
  running: BrowserApp,
  address: string,
  storage: ReturnType<typeof createStorageBufferAsset>,
  lut: ReturnType<typeof TextureAsset.fromPixels>,
): { readonly entity: Entity; readonly material: AssetHandle<MaterialAsset> } {
  const source = `${PARTICLE_QUAD_WGSL}
// ${address}
`;
  running.app.assets.register(new ShaderAsset(address, source, parseShaderDeclaration(source, address)), {
    type: SHADER_ASSET_TYPE,
    address,
  });
  const material = createMaterialAsset(
    running.app,
    shaderMaterialDefinition({ shader: address, textures: { lut: lut.address } }),
    [lut],
  );
  material.value.setStorageBuffer("particles", storage);
  const entity = running.world.createEntity("Cloud");
  const instanced = entity.addComponent(InstancedMeshRenderer, {
    mesh: MeshAsset.plane(running.app, { width: 1, height: 1 }),
    materials: [material],
    capacity: RING_SLOTS,
    castShadows: false,
  });
  const slab = new Float32Array(MATRIX_FLOATS);
  slab[0] = 1;
  slab[5] = 1;
  slab[10] = 1;
  slab[15] = 1;
  instanced.setMatrices(slab, 1);
  return { entity, material };
}

describe("a blended thin-instanced shader material installed after start", () => {
  it("keeps drawing beside Environment.fog", async () => {
    const running = await soakScene({ fog: "exp2" });
    const centre = await running.centrePixel();
    expect(running.errors).toEqual([]);
    expect(pixelLuminance(centre)).toBeGreaterThan(40);
  });

  it("keeps drawing beside a shadow pass", async () => {
    const running = await soakScene({ shadows: true });
    const centre = await running.centrePixel();
    expect(running.errors).toEqual([]);
    expect(pixelLuminance(centre)).toBeGreaterThan(40);
  });

  it("survives being swapped for a second program mid-flight", async () => {
    const running = await soakScene({ fog: "exp2", swapDocument: true });
    const centre = await running.centrePixel();
    expect(running.errors).toEqual([]);
    expect(pixelLuminance(centre)).toBeGreaterThan(40);
  });
});

describe("two thin-instanced clouds swapped between two programs under fog and shadows", () => {
  it("never leaves a frame-graph task half-recorded", { timeout: 60_000 }, async () => {
    const running = await createBrowserApp({
      size: SIZE,
      startEmpty: false,
      settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
    });
    harness = running;
    const frameErrors: string[] = [];
    const stopCollecting = collectFrameErrors(frameErrors);
    running.app.registerComponents([InstancedMeshRenderer]);
    await loadShaderSupport();

    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    const sun = running.world.createEntity("Sun");
    sun.transform.localPosition.set(0, 6, -2);
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    sun.addComponent(Light, { type: "directional", intensity: 3 }).shadows.enabled = true;

    const sky = running.world.createEntity("Environment").addComponent(Environment, {});
    sky.imageProcessing.toneMapping = "aces";
    sky.fog.mode = "exp2";
    sky.fog.density = 0.01;

    // A PBR caster, so the shadow pass has something to draw and the PBR group builder is the one
    // that awaits `pbr-fog-wgsl.js` on every rebuild.
    const stone = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ baseColor: { r: 0.3, g: 0.3, b: 0.35, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    // Enough distinct PBR materials that one group rebuild is real work: every rebuild walks the
    // whole group, and the weather example's grid ground, posts and probe put it in the same place.
    const box = MeshAsset.box(running.app, { size: 0.5 });
    for (let index = 0; index < PBR_MESHES; index += 1) {
      const shade = 0.2 + index * 0.05;
      const material = createMaterialAsset(
        running.app,
        pbrMaterialDefinition({ baseColor: { r: shade, g: shade, b: shade + 0.05, a: 1 }, metallic: 0, roughness: 1 }),
        [],
      );
      const post = running.world.createEntity(`Post ${String(index)}`);
      post.transform.localPosition.set(-3 + index * 0.8, -0.5, 2);
      post.addComponent(MeshRenderer, { mesh: box, materials: [material] });
    }
    const backdrop = running.world.createEntity("Backdrop");
    backdrop.transform.localPosition.set(0, 0, 6);
    backdrop.addComponent(MeshRenderer, {
      mesh: MeshAsset.plane(running.app, { width: 40, height: 40 }),
      materials: [stone],
      castShadows: false,
    });

    await running.start();
    await running.advance(SETTLE_FRAMES);

    const ring = new Float32Array(RING_FLOATS);
    for (let index = 0; index < RING_SLOTS; index += 1) {
      ring[index * RECORD_FLOATS + 1] = 100;
      ring[index * RECORD_FLOATS + 7] = 1;
    }
    const storage = createStorageBufferAsset(running.app, "memory:swap-ring", ring);
    const lut = TextureAsset.fromPixels(running.app, "memory:swap-lut", WHITE_TEXEL, 1, 1, {
      filter: "linear",
      wrap: "clamp",
    });

    // Two systems, each handed a different generated document every few frames — the weather
    // example's "Lit particles" toggle, hammered.
    let clouds = Array.from({ length: CLOUDS }, (_, index) =>
      addCloud(running, `memory:shaders/swap-${String(index)}-0.wgsl`, storage, lut),
    );
    for (let frame = 0; frame < SWAP_FRAMES; frame += 1) {
      if (frame % SWAP_EVERY === 0) {
        const generation = frame / SWAP_EVERY + 1;
        for (const cloud of clouds) {
          cloud.entity.destroy();
        }
        clouds = Array.from({ length: CLOUDS }, (_, index) =>
          addCloud(running, `memory:shaders/swap-${String(index)}-${String(generation)}.wgsl`, storage, lut),
        );
      }
      for (const cloud of clouds) {
        cloud.material.value.setUniform("clock", frame / 60);
      }
      storage.value.update(ring.subarray(0, RECORD_FLOATS), 0);
      // oxlint-disable-next-line no-await-in-loop -- frame `n + 1` genuinely depends on frame `n`.
      await running.nextFrame();
      if (frameErrors.length > 0) {
        // A corrupted frame graph throws on every frame from here on and never presents again, so
        // stopping now is what keeps the failure a readable assertion instead of a capture that
        // hangs until the test times out.
        break;
      }
    }
    stopCollecting();
    expect(frameErrors).toEqual([]);

    await running.advance(SETTLE_FRAMES * 2);
    const centre = await running.centrePixel();
    expect(running.errors).toEqual([]);
    expect(pixelLuminance(centre)).toBeGreaterThan(40);
  });
});

/**
 * A lit grey wall ten metres out, with or without fog.
 *
 * @param fog - The fog mode, or `undefined` for a scene with no fog at all.
 * @returns The colour at the centre of the frame.
 */
async function wallPixel(
  fog: EnvironmentFogMode | undefined,
  color: { r: number; g: number; b: number } = RED_FOG,
): Promise<{ r: number; g: number; b: number }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1 } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -4);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });

  const sky = running.world.createEntity("Environment").addComponent(Environment, {});
  if (fog !== undefined) {
    sky.fog.mode = fog;
    sky.fog.density = 0.2;
    sky.fog.color = { ...color, a: 1 };
  }

  const wall = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 0.25, g: 0.25, b: 0.25, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const backdrop = running.world.createEntity("Wall");
  backdrop.transform.localPosition.set(0, 0, 6);
  backdrop.addComponent(MeshRenderer, {
    mesh: MeshAsset.plane(running.app, { width: 40, height: 40 }),
    materials: [wall],
    castShadows: false,
  });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  const centre = await running.centrePixel();
  expect(running.errors).toEqual([]);
  return { r: centre.r, g: centre.g, b: centre.b };
}

describe("Environment.fog", () => {
  it("reaches the shader, instead of only changing which pipelines are compiled", async () => {
    const clear = await wallPixel(undefined);
    harness?.dispose();
    harness = null;
    const fogged = await wallPixel("exp2");
    // Lite compiles the fog block into every PBR pipeline the moment `scene.fog` is set, but the
    // block reads `vFogInfos` out of the scene UBO and only `setFog` registers the writer that
    // fills it. Without that call the two frames are identical.
    expect(fogged.r - clear.r).toBeGreaterThan(60);
    expect(fogged.r - fogged.b).toBeGreaterThan(60);
  });

  it("hands Lite the fog colour encoded, because Lite's fog block decodes it itself", async () => {
    const fogged = await wallPixel("exp2", { r: 0.5, g: 0.5, b: 0.5 });
    // A fully fogged pixel is the fog colour. Mid grey survives the round trip as mid grey; passing
    // the linear value instead decodes it a second time and lands near 51.
    expect(fogged.r).toBeGreaterThan(100);
    expect(fogged.r).toBeLessThan(160);
  });
});
