/**
 * The two rows of emitters `bloom` looks at, and the composition they are arranged in.
 *
 * @remarks
 * A separate file for the reason `pbr-model/shot.ts` is: none of it is a lesson about bloom.
 * `main.ts` is then the two rendering features, the four sliders and the `afterStart` that switches
 * the pass on — which is all a reader came for.
 *
 * ## The two rows are the point
 *
 * The **back** row is Khronos's `EmissiveStrengthTest`: five unit cubes whose glTF materials all
 * declare the same emissive colour, `[0.1, 0.5, 0.9]`, and whose
 * `KHR_materials_emissive_strength` multipliers run 1x, 2x, 4x, 8x, 16x. Babylon Lite 1.27.0 reads
 * that extension (its `setPbrEmissive` documents emissive "values may exceed 1.0 for HDR emissive,
 * e.g. `KHR_materials_emissive_strength`"), so the right-hand cubes sit far above white and are
 * exactly what a bloom threshold is looking for.
 *
 * The **front** row is five spheres built in code, the same hue ramped over the range
 * `pbrMaterialDefinition`'s `emissive` accepts. That range stops at 1.0: the field is **sRGB** and
 * is decoded with `Color.srgbToLinear`, which clamps its input, so a hand-written ignifx material
 * cannot express an HDR emitter today. Both rows bloom; only the cubes can go past white. That
 * contrast is the honest version of "emissive surfaces bleed light", and it is why the example
 * ships both rather than only the model.
 */

import { createMaterialAsset, MeshAsset, MeshRenderer, MODEL_ASSET_TYPE, Model, pbrMaterialDefinition } from "ignifx";
import type { App, AssetHandle, ColorLike, ModelAsset } from "ignifx";

/** How many spheres the generated row holds — one per cube in the model's row. */
export const STEPS = 5;

/** The near-black the frame is cleared to, so bloom has something to bleed into. */
export const CLEAR_COLOR: ColorLike = { r: 0.008, g: 0.01, b: 0.016, a: 1 };

/**
 * The generated row's hue at full brightness, in sRGB; each sphere gets a fraction of it.
 *
 * @remarks
 * Warmer than it looks, and deliberately not a saturated orange. Bloom thresholds on **luminance**,
 * and luminance is 0.21R + 0.72G + 0.07B: a fully saturated red at 1.0 has a luminance of 0.21 and
 * would never cross a threshold the cubes clear five times over. This hue reaches about 0.46, which
 * is what puts the top of the sphere row just above {@link START_BLOOM}'s threshold and the bottom
 * of it below — the ramp is the lesson, and it has to straddle the line to show one.
 */
const EMBER: ColorLike = { r: 1, g: 0.62, b: 0.28, a: 1 };

/** The spheres' diameter, in metres. */
const SPHERE_DIAMETER = 0.24;

/** Metres between one sphere and the next, matched to the model's cube spacing. */
const SPHERE_SPACING = 0.6;

/** How high the sphere row's centres sit above the floor, in metres. */
const SPHERE_HEIGHT = 0.12;

/** How far towards the camera the sphere row sits, in metres. */
const SPHERE_DEPTH = -0.35;

/**
 * The scale the model is drawn at.
 *
 * @remarks
 * The file is authored in test units: unit cubes three units apart on a 16 x 10 reference card
 * (measured by `_tools/compress-model.ts`, which prints the extents on every run). At 0.2 the
 * cubes are 20 cm across and 60 cm apart, which is a scene rather than a diagram — and the same
 * spacing as the sphere row in front of it, so each sphere sits under a cube.
 */
export const MODEL_SCALE = 0.2;

/** How high the model's origin — the middle cube's centre — sits above the floor, in metres. */
export const MODEL_HEIGHT = 0.74;

/** How far from the camera the model's row sits, in metres. */
export const MODEL_DEPTH = 0.35;

/** The opening shot: the pose and the grading every capture is taken from. */
export const SHOT = {
  fov: 34,
  yaw: 0,
  pitch: 5,
  distance: 3.2,
  target: { x: 0, y: 0.42, z: 0 },
  /** Low on purpose: the emissive surfaces should be what clips, not the lit geometry. */
  exposure: 0.9,
} as const;

/** The bloom the example opens on, and what the poster shows. */
export const START_BLOOM = { threshold: 0.32, weight: 0.6, kernel: 56, scale: 0.5 } as const;

/**
 * Builds the floor: matte, near-black, and there only to catch the emitters' light and shadows.
 *
 * @param app - The app the entity and the assets belong to.
 */
export function createFloor(app: App): void {
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "bloom/floor", baseColor: CLEAR_COLOR, metallic: 0, roughness: 0.62 }),
    [],
  );
  app.world.createEntity("Floor").addComponent(MeshRenderer, {
    // Wide enough that its far edge is past the vanishing line at this pitch, so the frame reads
    // as a floor running into the dark rather than as a slab with a bright edge across the middle.
    mesh: MeshAsset.ground(app, { width: 60, height: 60, subdivisions: 1 }),
    materials: [material],
    castShadows: false,
    receiveShadows: true,
    pickable: false,
  });
}

/**
 * Builds the generated row: one mesh shared by {@link STEPS} entities, one material each, emissive
 * ramped over the 0-1 range the material format can express.
 *
 * @param app - The app the entities and the assets belong to.
 */
export function createSphereRow(app: App): void {
  const mesh = MeshAsset.sphere(app, { diameter: SPHERE_DIAMETER, segments: 24 });
  for (let step = 0; step < STEPS; step += 1) {
    const level = (step + 1) / STEPS;
    const material = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: `bloom/ember-${String(step + 1)}`,
        baseColor: { r: 0.07, g: 0.07, b: 0.08, a: 1 },
        metallic: 0,
        roughness: 0.4,
        emissive: { r: EMBER.r * level, g: EMBER.g * level, b: EMBER.b * level, a: 1 },
      }),
      [],
    );
    const sphere = app.world.createEntity(`Sphere ${String(step + 1)}`);
    sphere.transform.localPosition.set((step - (STEPS - 1) / 2) * SPHERE_SPACING, SPHERE_HEIGHT, SPHERE_DEPTH);
    sphere.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: true });
  }
}

/**
 * Loads and places the back row.
 *
 * @remarks
 * The load is awaited **before** `app.start()`: a load that completes before the loop runs settles
 * at once, while one awaited afterwards waits for a frame's `PreUpdate`.
 *
 * The file ships a reference card and grid around its cubes. `materialOverrides` replaces one glTF
 * material by the name it carries in the file — here the card's `FlatBackdrop`, with a fully
 * transparent one, which takes it out of the frame and leaves this example's floor as the stage.
 *
 * @param app - The app the entity and the assets belong to.
 * @returns Nothing; the entity is the world's.
 */
export async function createEmissiveRow(app: App): Promise<void> {
  const cubes: AssetHandle<ModelAsset> = app.assets.load("models/emissive-strength-test.glb", {
    type: MODEL_ASSET_TYPE,
  });
  await cubes.promise;
  // `alphaMode: "blend"` with `alpha: 0` takes the card out of the frame entirely. A near-black
  // opaque override was the first try and it did not work: the card is lit and the floor is lit,
  // so "as dark as the background" still reads as five dark rectangles behind the cubes. The
  // cubes keep their own materials, which is the point of overriding one glTF material by name
  // rather than replacing the model.
  const card = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "bloom/card", baseColor: CLEAR_COLOR, alphaMode: "blend", alpha: 0 }),
    [],
  );
  const row = app.world.createEntity("Emissive strength test");
  row.transform.localPosition.set(0, MODEL_HEIGHT, MODEL_DEPTH);
  row.transform.localScale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
  row.addComponent(Model, {
    model: cubes,
    materialOverrides: { FlatBackdrop: card },
    castShadows: false,
    receiveShadows: false,
  });
}
