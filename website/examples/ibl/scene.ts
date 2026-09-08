/**
 * The numbers `ibl` is composed with, and the sphere grid the probe is judged on.
 *
 * @remarks
 * Split out for the reason `pbr-model/shot.ts` is: what a reader wants from `main.ts` is the
 * `Environment` component and the three lines that switch a probe, not fourteen material
 * declarations. Every number here is a composition choice.
 */

import { createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import type { App, ColorLike } from "ignifx";

/** How the spheres are laid out: seven per row, a metre apart, half a diameter above the floor. */
export const GRID = { count: 7, spacing: 1.06, diameter: 0.92, height: 0.52, rowGap: 1.35 } as const;

/** How many segments a sphere is built from. High: a facet edge reads as a scratch in a mirror. */
const SPHERE_SEGMENTS = 48;

/** The exposure the example opens on. */
export const START_EXPOSURE = 1.25;

/** How much the probe is softened when the page loads. A little is what makes a probe legible. */
export const START_BLUR = 0.14;

/** The probe's rotation when the page loads, in degrees. */
export const START_ROTATION = 180;

/** The metal row's base colour: a warm steel, so the row is not a mirror of nothing. */
const METAL_COLOR = { r: 0.78, g: 0.76, b: 0.73, a: 1 };

/** The dielectric row's base colour. */
const PAINT_COLOR = { r: 0.24, g: 0.36, b: 0.52, a: 1 };

/**
 * Writes a slider's value as a percentage.
 *
 * @param value - A fraction, `0` to `1`.
 * @returns The text for the slider's value cell.
 */
export function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/**
 * Writes a slider's value as an angle.
 *
 * @param value - Degrees.
 * @returns The text for the slider's value cell.
 */
export function degrees(value: number): string {
  return `${String(value)}°`;
}

/**
 * Writes a slider's value with two decimals, for exposure and contrast.
 *
 * @param value - The multiplier.
 * @returns The text for the slider's value cell.
 */
export function twoPlaces(value: number): string {
  return value.toFixed(2);
}

/**
 * Builds the two rows of spheres: metal in front, dielectric behind, roughness zero to one.
 *
 * @remarks
 * One mesh and fourteen materials: roughness and metalness are material factors, so the whole grid
 * is one sphere's worth of geometry drawn fourteen times. The rows are offset by half a step so the
 * back one is not hidden behind the front one, and nothing casts or receives a shadow because
 * nothing here is a light that could throw one.
 *
 * @param app - The app the entities and assets belong to.
 *
 * @example
 * ```ts
 * createSphereGrid(app);
 * ```
 */
export function createSphereGrid(app: App): void {
  const mesh = MeshAsset.sphere(app, { diameter: GRID.diameter, segments: SPHERE_SEGMENTS });
  const row = (name: string, metallic: number, baseColor: ColorLike, z: number, shift: number): void => {
    for (let index = 0; index < GRID.count; index += 1) {
      const roughness = index / (GRID.count - 1);
      const material = createMaterialAsset(
        app,
        pbrMaterialDefinition({ name: `ibl/${name}-${String(index)}`, baseColor, metallic, roughness }),
        [],
      );
      const x = (index - (GRID.count - 1) / 2) * GRID.spacing + shift;
      const entity = app.world.createEntity(`${name} ${String(index)}`, { position: { x, y: GRID.height, z } });
      entity.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: false, receiveShadows: false });
    }
  };
  row("Metal", 1, METAL_COLOR, -GRID.rowGap, 0);
  row("Paint", 0, PAINT_COLOR, GRID.rowGap, GRID.spacing / 2);
}
