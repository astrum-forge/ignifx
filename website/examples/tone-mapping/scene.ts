/**
 * The numbers `tone-mapping` is composed with, and the ramp of emissive spheres the curves are read
 * off.
 *
 * @remarks
 * Split out for the reason `pbr-model/shot.ts` is: what a reader wants from `main.ts` is the
 * `imageProcessing` record and the four curves, not six material declarations. Every number here is
 * a composition choice.
 */

import { createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import type { App, ColorLike, ToneMappingCurve } from "ignifx";

/** The subject: the Khronos Corset, authored at 4 cm and drawn at sixteen times that. */
export const SUBJECT = { address: "models/corset.glb", scale: 16, height: 0.46 } as const;

/** What the camera looks at, and what the light rig is aimed at. */
export const FOCUS = { x: 0, y: 0.54, z: 0 } as const;

/** The exposure and contrast the example opens on. */
export const GRADING = { exposure: 1.9, contrast: 1.05 } as const;

/** The key light, bright enough to put a clipping highlight on the corset's metal. */
export const KEY_INTENSITY = 5.2;

/**
 * The tone-mapping curves, by the label the panel shows; the values are `TONE_MAPPING_NAMES`.
 *
 * @remarks
 * `none` clips: anything above one becomes white and every colour in it goes with it. `standard` is
 * Babylon's own curve. `aces` is what most engines call filmic — it rolls a bright highlight off
 * towards white instead of cutting it, and desaturates as it goes. `neutral` is the Khronos PBR
 * neutral curve, which keeps hue and saturation much closer to the input and is what a product shot
 * usually wants.
 */
export const CURVES: Readonly<Record<string, ToneMappingCurve>> = {
  None: "none",
  Standard: "standard",
  ACES: "aces",
  Neutral: "neutral",
};

/** The curve the example opens on, and the one every capture shows. */
export const START_CURVE = "ACES";

/** The curve the comparison toggle flips to. */
export const COMPARE_CURVE = "None";

/** How many spheres the emissive ramp has. */
const RAMP_COUNT = 6;

/** The ramp's geometry: sphere size, spacing, height and how far behind the subject it sits. */
const RAMP = { diameter: 0.32, spacing: 0.52, height: 0.52, z: 1.6 } as const;

/** How many segments a ramp sphere is built from. */
const RAMP_SEGMENTS = 24;

/** The ramp's hue: a warm amber, so a clipped step reads as white and an unclipped one as amber. */
const RAMP_HUE: ColorLike = { r: 1, g: 0.66, b: 0.3, a: 1 };

/** The lowest emissive level in the ramp, in sRGB. */
const RAMP_FLOOR = 0.3;

/** What a ramp sphere's own surface is: near-black, so only its emissive term shows. */
const RAMP_BODY: ColorLike = { r: 0.02, g: 0.02, b: 0.02, a: 1 };

/**
 * Writes a slider's value with two decimals.
 *
 * @param value - The multiplier.
 * @returns The text for the slider's value cell.
 */
export function twoPlaces(value: number): string {
  return value.toFixed(2);
}

/**
 * Builds the ramp of emissive spheres a tone-mapping curve is read off.
 *
 * @remarks
 * Six spheres whose `emissive` climbs from {@link RAMP_FLOOR} to full, standing behind the subject
 * and drawn on a near-black surface so nothing but the emissive term shows. That is the whole instrument: the exposure
 * multiplies every one of them, so raising it walks the ramp past one from the right, and what each
 * curve does with the steps that went past is the difference between the curves. Under `none` they
 * turn flat white one after another and the amber goes with them; under ACES and Neutral they keep
 * climbing and keep some of their hue.
 *
 * A material's `emissive` is sRGB and clamped into `0…1` when it is decoded
 * (`Color.srgbToLinear`), so the brightest step here is exactly one — anything past that comes from
 * the exposure, which is the control the panel gives you.
 *
 * @param app - The app the entities and assets belong to.
 *
 * @example
 * ```ts
 * createEmissiveRamp(app);
 * ```
 */
export function createEmissiveRamp(app: App): void {
  const mesh = MeshAsset.sphere(app, { diameter: RAMP.diameter, segments: RAMP_SEGMENTS });
  for (let index = 0; index < RAMP_COUNT; index += 1) {
    const level = RAMP_FLOOR + ((1 - RAMP_FLOOR) * index) / (RAMP_COUNT - 1);
    const material = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: `tone-mapping/step-${String(index)}`,
        baseColor: RAMP_BODY,
        metallic: 0,
        roughness: 0.9,
        emissive: { r: RAMP_HUE.r * level, g: RAMP_HUE.g * level, b: RAMP_HUE.b * level, a: 1 },
        environmentIntensity: 0,
      }),
      [],
    );
    const x = (index - (RAMP_COUNT - 1) / 2) * RAMP.spacing;
    const entity = app.world.createEntity(`Step ${String(index)}`, { position: { x, y: RAMP.height, z: RAMP.z } });
    entity.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: false, receiveShadows: false });
  }
}
