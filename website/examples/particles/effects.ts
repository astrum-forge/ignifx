/**
 * The nine presets as this example shows them: where each one's emitter stands, and the three
 * document edits the panel's lower group makes.
 *
 * @remarks
 * A separate file for the reason `custom-shader/shot.ts` is: none of it is the lesson. `main.ts` is
 * the select that swaps a definition onto the component, the sliders that are live, and the sliders
 * that are not — which is the whole point of the example.
 */

import { particleDefinition } from "ignifx";
import { readout, slider } from "../_kit/panel.ts";
import type { PanelControl } from "../_kit/panel.ts";
import type { CurveKey, ParticleDefinition, ParticlePreset, ScalarValue, ScalarValueInput } from "ignifx";

/** The near-black the frame is cleared to; the additive presets need somewhere dark to burn. */
export const CLEAR_COLOR = { r: 0.012, g: 0.015, b: 0.023, a: 1 } as const;

/** The framing every shot shares: the lens, and where the camera stands around the emitter. */
export const SHOT = { fov: 34, yaw: 18, pitch: 5 } as const;

/** Which preset the example opens on, and therefore what the poster shows. */
export const START_PRESET: ParticlePreset = "fire";

/** How wide the floor is, in metres. */
export const FLOOR_SIZE = 30;

/** Where one preset is played, and how the camera frames it. */
export interface PresetShot {
  /** How high the emitter stands, in metres. */
  readonly height: number;
  /** How high the camera looks, in metres. */
  readonly target: number;
  /** How far back the camera stands, in metres. */
  readonly distance: number;
}

/**
 * The emitter height and the framing for each preset.
 *
 * @remarks
 * An emitter is an entity, so where an effect is played is the one thing about it a scene file
 * already carries: rain and snow are volumes overhead, a campfire sits on the ground, and dust
 * hangs in the air around head height. The camera follows, because a weather volume twelve metres
 * up is not in a campfire's frame.
 */
export const PRESET_SHOT: Readonly<Record<ParticlePreset, PresetShot>> = {
  fire: { height: 0.05, target: 0.85, distance: 4.6 },
  smoke: { height: 0.05, target: 1.7, distance: 6.5 },
  sparks: { height: 0.2, target: 1.1, distance: 6.5 },
  explosion: { height: 1.2, target: 1.4, distance: 8 },
  dust: { height: 1.4, target: 1.4, distance: 6 },
  sparkle: { height: 1.1, target: 1.1, distance: 3.4 },
  // The two weather volumes are twelve and ten metres across, and the camera stands *inside* them:
  // a storm framed from outside is a box of drops with an edge.
  rain: { height: 6, target: 2.5, distance: 5 },
  snow: { height: 6, target: 2.5, distance: 5 },
  leaves: { height: 4, target: 2.2, distance: 6 },
};

/** The three numbers the panel's lower group edits, each at its identity. */
export interface Tweaks {
  /** A multiplier on the preset's own `start.size`. `1` leaves it alone. */
  readonly size: number;
  /** Linear drag added to the preset's own. `0` leaves it alone. */
  readonly drag: number;
  /** Noise strength added to the preset's own. `0` leaves it alone. */
  readonly noise: number;
}

/** The preset exactly as it ships. */
export const NO_TWEAKS: Tweaks = { size: 1, drag: 0, noise: 0 };

/** The noise a preset that declares none is given when the slider asks for some. */
const DEFAULT_NOISE = { frequency: 1, scroll: { x: 0.1, y: 0.25, z: 0 }, octaves: 1 } as const;

/**
 * Scales a start size, whatever shape the preset authored it in.
 *
 * @param value - The preset's own value.
 * @param factor - What to multiply it by.
 * @returns The scaled value, ready to override with.
 */
function scaleSize(value: ScalarValue, factor: number): ScalarValueInput {
  if (value.kind === "constant") {
    return value.value * factor;
  }
  if (value.kind === "random") {
    return { min: value.min * factor, max: value.max * factor };
  }
  const keys = value.curve.keys.map(([t, v, inTangent, outTangent]: CurveKey): CurveKey => [
    t,
    v * factor,
    inTangent,
    outTangent,
  ]);
  return { curve: { keys } };
}

/**
 * Builds one preset's document with the panel's three edits applied.
 *
 * @param name - Which preset.
 * @param tweaks - The three numbers, each at its identity for the preset as it ships.
 * @returns The complete document to build an asset from.
 */
export function tweakedDefinition(name: ParticlePreset, tweaks: Tweaks): ParticleDefinition {
  const base = particleDefinition(name);
  const noise = base.forces.noise;
  const strength = (noise?.strength ?? 0) + tweaks.noise;
  return particleDefinition(name, {
    start: { size: scaleSize(base.start.size, tweaks.size) },
    forces: {
      drag: base.forces.drag + tweaks.drag,
      // A strength of zero is the module's absence, not a module that does nothing: the generated
      // program declares the noise constants and the helper functions only when it is there.
      noise:
        strength <= 0
          ? null
          : {
              strength,
              frequency: noise?.frequency ?? DEFAULT_NOISE.frequency,
              scroll: noise?.scroll ?? DEFAULT_NOISE.scroll,
              octaves: noise?.octaves ?? DEFAULT_NOISE.octaves,
            },
    },
  });
}

/**
 * The cache key for one preset and one set of edits.
 *
 * @param name - Which preset.
 * @param tweaks - The three numbers.
 * @returns A key that is equal exactly when the resulting document is.
 */
export function tweakKey(name: ParticlePreset, tweaks: Tweaks): string {
  return `${name}/${String(tweaks.size)}/${String(tweaks.drag)}/${String(tweaks.noise)}`;
}

/**
 * Writes a byte count for a readout cell.
 *
 * @param value - The count.
 * @returns The text.
 */
export function bytes(value: number): string {
  return value < 1024 ? `${String(Math.round(value))} B` : `${(value / 1024).toFixed(1)} KB`;
}

/**
 * The three sliders that edit the document, and the count of documents they have built.
 *
 * @remarks
 * Coarse steps on purpose: each distinct set of numbers is a distinct document and a distinct
 * generated program, so a slider that moved in hundredths would compile a hundred shaders.
 *
 * @param change - Called with the new numbers; `main.ts` rebuilds the effect from them.
 * @param built - How many documents exist so far, for the readout.
 * @returns The controls, in panel order.
 */
export function tweakControls(change: (tweaks: Tweaks) => void, built: () => number): readonly PanelControl[] {
  let current = NO_TWEAKS;
  const edit = (next: Tweaks): void => {
    current = next;
    change(current);
  };
  return [
    slider(
      "Size",
      { min: 0.5, max: 2, step: 0.5, format: (value: number): string => `${value.toFixed(1)}×` },
      {
        value: NO_TWEAKS.size,
        change: (value: number): void => {
          edit({ ...current, size: value });
        },
      },
    ),
    slider(
      "Extra drag",
      { min: 0, max: 4, step: 1, format: (value: number): string => value.toFixed(0) },
      {
        value: NO_TWEAKS.drag,
        change: (value: number): void => {
          edit({ ...current, drag: value });
        },
      },
    ),
    slider(
      "Extra noise",
      { min: 0, max: 1, step: 0.25, format: (value: number): string => value.toFixed(2) },
      {
        value: NO_TWEAKS.noise,
        change: (value: number): void => {
          edit({ ...current, noise: value });
        },
      },
    ),
    readout("Documents built", (): string => String(built())),
  ];
}
