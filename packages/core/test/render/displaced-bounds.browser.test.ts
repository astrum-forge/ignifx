import { afterEach, describe, expect, it } from "vitest";
import { createPixelRgba, pixelLuminance, samplePixel } from "../../src/lite/screenshot.js";
import { Vec3 } from "../../src/math/vec3.js";
import { Camera } from "../../src/render/camera.js";
import { InstancedMeshRenderer } from "../../src/render/instanced-mesh-renderer.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { createSurfaceBrowserApp, SURFACE_SETTLE_FRAMES } from "../fixtures/shaders/surface-browser.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { CapturedFrame } from "../../src/lite/screenshot.js";
import type { Vec3Like } from "../../src/math/types.js";
import type { ShadowTechniqueName } from "../../src/render/light.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";
import type { SurfaceBrowserApp } from "../fixtures/shaders/surface-browser.js";

/**
 * A vertex stage that moves a mesh beyond its own bounds, with and without `// @ignifx displace`
 * (`docs/architecture/07-rendering.md` §2.2, §2.8).
 *
 * Babylon Lite fits a directional PCF or ESM map to the casters' `boundMin`/`boundMax` plus 10 %
 * (`computeDirectionalLightMatrix`, `lib/shadow/shadow-base.js` 54), and its GPU instance culler
 * builds each instance's sphere from the prototype's vertices. Neither knows what a vertex stage
 * does, so a caster slid 2.5 m sideways by its shader drops out of its own shadow map, and an
 * instance slid onto the screen from outside it is culled. The pragma widens both by the declared
 * distance.
 *
 * Every caster here is a one-metre box three metres up, slid 2.5 m along +X by its shader. The light
 * shines from 45 degrees behind it, so the moved box's shadow lands on the ground at (2.5, 0, 3),
 * and the camera looks down at that stretch of ground. The probe is that point; the reference is
 * its mirror at (-2.5, 0, 3), which nothing ever shades.
 */

let harness: SurfaceBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 96;

/** How far every shader here slides its mesh along +X, in metres. */
const SLIDE = 2.5;

/** Where the slid box's shadow lands. */
const SHADOW_POINT: Vec3Like = { x: SLIDE, y: 0, z: 3 };

/** A ground point no caster ever shades, at the same distance from the camera. */
const LIT_POINT: Vec3Like = { x: -SLIDE, y: 0, z: 3 };

/**
 * A surface shader that slides the mesh along +X. `displace` cannot read a uniform, so the distance
 * is written into the body.
 *
 * @param margin - The `// @ignifx displace` line's distance, or `null` to leave the line out.
 * @returns The `.surface.wgsl` source.
 */
function slideSurface(margin: number | null): string {
  return `// @ignifx surface
${margin === null ? "" : `// @ignifx displace ${String(margin)}`}

fn displace(in: DisplaceInput) -> vec3<f32> {
  return vec3<f32>(${SLIDE.toFixed(1)}, 0.0, 0.0);
}
`;
}

/**
 * A white shader material that slides its mesh along +X in world space.
 *
 * @param margin - The `// @ignifx displace` line's distance, or `null` to leave the line out.
 * @returns The `.wgsl` source.
 */
function slideShader(margin: number | null): string {
  return `// @ignifx shader
// @ignifx attributes position
// @ignifx system world, viewProjection
${margin === null ? "" : `// @ignifx displace ${String(margin)}`}

struct VertexOutput { @builtin(position) position: vec4<f32> }

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let world = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * (world + vec4<f32>(${SLIDE.toFixed(1)}, 0.0, 0.0, 0.0));
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;
}

/**
 * A white instanced shader material that slides every instance eight metres along +X.
 *
 * @param margin - The `// @ignifx displace` line's distance, or `null` to leave the line out.
 * @returns The `.wgsl` source.
 */
function arriveShader(margin: number | null): string {
  return `// @ignifx shader
// @ignifx attributes position
// @ignifx system world, viewProjection
// @ignifx instancing matrices
${margin === null ? "" : `// @ignifx displace ${String(margin)}`}

struct VertexOutput { @builtin(position) position: vec4<f32> }

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instance = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let world = shaderSystem.world * instance * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * (world + vec4<f32>(8.0, 0.0, 0.0, 0.0));
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;
}

/** How the caster is drawn. */
type CasterKind = "surface" | "shader";

/** One scene's setup. */
interface ShadowScene {
  /** The light's technique. */
  readonly technique: ShadowTechniqueName;
  /** Whether the caster's material is a surface shader on PBR or a full shader material. */
  readonly kind: CasterKind;
  /** The `// @ignifx displace` distance, or `null` for none. */
  readonly margin: number | null;
  /** The caster entity's uniform scale; the box mesh is sized so the box is a metre either way. */
  readonly scale?: number;
}

/**
 * Reads the luminance of the pixel a world point lands on.
 *
 * @param frame - The capture.
 * @param camera - The camera that drew it.
 * @param point - The world point.
 * @returns The pixel's luminance, 0 to 255.
 */
function luminanceAt(frame: CapturedFrame, camera: Camera, point: Vec3Like): number {
  const screen = new Vec3();
  expect(camera.worldToScreen(point, screen)).toBe(true);
  const pixel = samplePixel(frame, Math.round(screen.x), Math.round(screen.y), createPixelRgba());
  if (pixel === null) {
    throw new Error(`(${String(point.x)}, ${String(point.y)}, ${String(point.z)}) is off the canvas`);
  }
  return pixelLuminance(pixel);
}

/**
 * Builds the shadow scene, renders it, and reads the probe and the reference.
 *
 * @param scene - What to build.
 * @returns The two luminances and how many errors the app reported.
 */
async function measureShadow(
  scene: ShadowScene,
): Promise<{ readonly shadow: number; readonly lit: number; readonly errors: number }> {
  const running = await createSurfaceBrowserApp({
    size: SIZE,
    start: false,
    settings: { rendering: { msaaSamples: 1, features: { materialPlugins: true, shadows: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 12, 10);
  eye.transform.lookAt({ x: 0, y: 0, z: 3 });
  const camera = eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(0, 10, -10);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
  light.shadows.enabled = true;
  light.shadows.technique = scene.technique;
  light.shadows.mapSize = 1024;

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "ground", baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 40, height: 40, subdivisions: 1 }),
    materials: [white],
    castShadows: false,
  });

  const material = casterMaterial(running, scene.kind, scene.margin);
  const scale = scene.scale ?? 1;
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 3, 0);
  box.transform.localScale.set(scale, scale, scale);
  box.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(running.app, { size: 1 / scale }),
    materials: [material],
    receiveShadows: false,
  });

  await running.start();
  await running.advance(SURFACE_SETTLE_FRAMES);
  const frame = await running.app.renderer.captureScreenshot();
  return {
    shadow: luminanceAt(frame, camera, SHADOW_POINT),
    lit: luminanceAt(frame, camera, LIT_POINT),
    errors: running.errors.length,
  };
}

/**
 * Builds the sliding caster's material.
 *
 * @param running - The app.
 * @param kind - A surface shader on PBR, or a full shader material.
 * @param margin - The `// @ignifx displace` distance, or `null` for none.
 * @returns The material.
 */
function casterMaterial(
  running: SurfaceBrowserApp,
  kind: CasterKind,
  margin: number | null,
): AssetHandle<MaterialAsset> {
  if (kind === "shader") {
    const shader = running.publishShader("shaders/slide.wgsl", slideShader(margin));
    return createMaterialAsset(running.app, shaderMaterialDefinition({ shader, name: "slide" }), []);
  }
  running.publishShader("shaders/slide.surface.wgsl", slideSurface(margin));
  return createMaterialAsset(
    running.app,
    pbrMaterialDefinition({
      name: "slid",
      baseColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
      metallic: 0,
      roughness: 1,
      surfaces: [
        { shader: "shaders/slide.surface.wgsl", name: "slide", values: {}, textures: {}, enabled: true, priority: 500 },
      ],
    }),
    [],
  );
}

describe("a caster its vertex stage moves beyond its own bounds", () => {
  const cases: readonly (readonly [ShadowTechniqueName, CasterKind])[] = [
    ["pcf", "surface"],
    ["esm", "surface"],
    // Babylon Lite 1.27.0 cannot draw a shader material into an ESM map (IGX-0724), so PCF only.
    ["pcf", "shader"],
  ];
  for (const [technique, kind] of cases) {
    it(`loses its moved shadow under ${technique} without a margin, and keeps it with // @ignifx displace (${kind})`, async () => {
      const clipped = await measureShadow({ technique, kind, margin: null });
      harness?.dispose();
      harness = null;
      const covered = await measureShadow({ technique, kind, margin: SLIDE });
      // Without the margin the map ends a few centimetres past the unmoved box, so the moved box is
      // drawn outside it and the ground under it is as bright as ground nothing shades.
      expect(clipped.shadow, `clipped: shadow ${String(clipped.shadow)}, lit ${String(clipped.lit)}`).toBeGreaterThan(
        clipped.lit * 0.9,
      );
      // With it, the map reaches the moved box and its shadow is drawn.
      expect(covered.shadow, `covered: shadow ${String(covered.shadow)}, lit ${String(covered.lit)}`).toBeLessThan(
        covered.lit * 0.6,
      );
      expect(clipped.errors + covered.errors).toBe(0);
    }, 60_000);
  }

  it("reads the margin in world metres, whatever the entity's scale", async () => {
    // Scaled to half, the box mesh is two units wide and the margin has to grow to five of them to
    // reach 2.5 m. Applied in the mesh's own units it would cover only 1.25 m, short of the box.
    const covered = await measureShadow({ technique: "pcf", kind: "surface", margin: SLIDE, scale: 0.5 });
    expect(covered.shadow, `shadow ${String(covered.shadow)}, lit ${String(covered.lit)}`).toBeLessThan(
      covered.lit * 0.6,
    );
    expect(covered.errors).toBe(0);
  }, 60_000);
});

describe("an instance its vertex stage moves onto the screen", () => {
  /**
   * Places one GPU-culled instance eight metres left of the frame and slides it back to the centre
   * in its shader material's vertex stage, then reads the centre pixel.
   *
   * @remarks
   * A full shader material, not a surface shader: in Babylon Lite 1.27.0 a surface shader's
   * `displace` hook does not move thin instances at all (measured here, 2026-10-14).
   *
   * @param margin - The `// @ignifx displace` distance, or `null` for none.
   * @returns The centre pixel's luminance.
   */
  async function centreLuminance(margin: number | null): Promise<number> {
    const running = await createSurfaceBrowserApp({ size: 64, start: false });
    harness = running;
    running.app.registerComponents([InstancedMeshRenderer]);
    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.transform.lookAt({ x: 0, y: 0, z: 0 });
    eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

    const shader = running.publishShader("shaders/arrive.wgsl", arriveShader(margin));
    const material = createMaterialAsset(running.app, shaderMaterialDefinition({ shader, name: "arrive" }), []);
    const renderer = running.world.createEntity("Cloud").addComponent(InstancedMeshRenderer, {
      mesh: MeshAsset.box(running.app, { size: 1 }),
      materials: [material],
      capacity: 1,
      gpuCulling: true,
      castShadows: false,
    });
    // One instance at x = -8, well outside the frame's half-width of about 3.5 m at that depth.
    renderer.setMatrices(Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -8, 0, 0, 1), 1);
    await running.start();
    await running.advance(SURFACE_SETTLE_FRAMES);
    const luminance = pixelLuminance(await running.centrePixel());
    expect(running.errors).toStrictEqual([]);
    running.dispose();
    harness = null;
    return luminance;
  }

  it("is culled without a margin and drawn with // @ignifx displace", async () => {
    const culled = await centreLuminance(null);
    const drawn = await centreLuminance(8);
    expect(drawn, `culled ${String(culled)}, drawn ${String(drawn)}`).toBeGreaterThan(culled + 40);
  }, 60_000);
});
