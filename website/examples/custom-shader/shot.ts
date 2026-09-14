/**
 * The stage the four shaders are shown on, and the table that says which uniforms each of them puts
 * on the panel.
 *
 * @remarks
 * A separate file for the reason `pbr-model/shot.ts` is: none of it is a lesson about custom
 * shaders. `main.ts` is then the four loads, the four materials, the select that swaps one onto the
 * mesh, and the sliders that write the files' own declared uniforms — which is all a reader came for.
 *
 * ## Why the uniform table is written out here
 *
 * A `.wgsl` file's `// @ignifx uniform` lines already carry a range, a step and a tooltip, and
 * `ShaderAsset.declaration` hands them back at runtime — so a real inspector builds its rows from
 * the file and never repeats itself. The kit's panel takes a `label` and a `format` this
 * declaration has no field for, so the example writes the four rows it wants out longhand and keeps
 * the bounds the same as the file's. Reading the bounds off `shader.value.declaration.uniforms`
 * instead is three lines and is what an editor would do; it is not shown here because the point of
 * the example is the shader, not the panel.
 */

import type { ColorLike } from "ignifx";

/** The near-black the frame is cleared to; the additive shaders need somewhere dark to burn. */
export const CLEAR_COLOR: ColorLike = { r: 0.012, g: 0.015, b: 0.023, a: 1 };

/** The opening shot: the pose every capture is taken from. */
export const SHOT = {
  fov: 32,
  yaw: 24,
  pitch: 12,
  distance: 3.1,
  target: { x: 0, y: 0.62, z: 0 },
  exposure: 1,
} as const;

/** The subject: one sphere, high enough off the floor to catch its own shadow. */
export const SUBJECT = { diameter: 1.05, segments: 48, height: 0.62 } as const;

/** How wide the plain floor is, in metres. */
export const FLOOR_SIZE = 26;

/** How wide the backdrop sphere is, in metres. */
export const BACKDROP_DIAMETER = 18;

/** One panel row: a uniform the shader file declares, and how the panel should draw it. */
export interface UniformRow {
  /** The visible label. */
  readonly label: string;
  /** The uniform's name, exactly as the `.wgsl` file declared it. */
  readonly name: string;
  /** The lowest value; the same bound the file's `range(…)` states. */
  readonly min: number;
  /** The highest value. */
  readonly max: number;
  /** The increment; the same one the file's `step(…)` states. */
  readonly step: number;
  /** The value the material opens on; the file's own default unless the example overrides it. */
  readonly value: number;
  /** How many decimals the value cell shows. */
  readonly places: number;
}

/** One shader on the select: the file to load, and the rows its uniforms get. */
export interface ShaderRow {
  /** The label on the select and on the panel group. */
  readonly label: string;
  /** The asset address, under `website/examples/assets/`. */
  readonly address: string;
  /** The sliders the panel offers for it. */
  readonly uniforms: readonly UniformRow[];
}

/** The four shaders, in select order. The opening frame is {@link START_SHADER}. */
export const SHADERS: readonly ShaderRow[] = [
  {
    label: "Dissolve",
    address: "shaders/custom-shader/dissolve.wgsl",
    uniforms: [
      { label: "Progress", name: "progress", min: 0, max: 1, step: 0.01, value: 0.35, places: 2 },
      { label: "Edge width", name: "edgeWidth", min: 0.01, max: 0.3, step: 0.01, value: 0.09, places: 2 },
    ],
  },
  {
    label: "Toon",
    address: "shaders/custom-shader/toon.wgsl",
    uniforms: [
      { label: "Bands", name: "bands", min: 1, max: 8, step: 1, value: 3, places: 0 },
      { label: "Outline", name: "outline", min: 0, max: 0.8, step: 0.02, value: 0.28, places: 2 },
    ],
  },
  {
    label: "Hologram",
    address: "shaders/custom-shader/hologram.wgsl",
    uniforms: [
      { label: "Scan lines", name: "scanFrequency", min: 10, max: 240, step: 5, value: 90, places: 0 },
      { label: "Scan speed", name: "scanSpeed", min: 0, max: 3, step: 0.05, value: 0.6, places: 2 },
      { label: "Glow", name: "glow", min: 0.2, max: 4, step: 0.1, value: 1.4, places: 1 },
    ],
  },
  {
    label: "Force field",
    address: "shaders/custom-shader/forcefield.wgsl",
    uniforms: [
      { label: "Cells", name: "cells", min: 3, max: 40, step: 1, value: 14, places: 0 },
      { label: "Pulse", name: "pulse", min: 0, max: 2, step: 0.05, value: 0.5, places: 2 },
    ],
  },
];

/** Which of {@link SHADERS} the example opens on, and therefore what the poster shows. */
export const START_SHADER = "Dissolve";
