import { ParticlesErrorCode, particlesError } from "../../errors.js";
import { defineParticles } from "../define-particles.js";
import { dustPresetInput } from "./dust.js";
import { explosionPresetInput } from "./explosion.js";
import { firePresetInput } from "./fire.js";
import { leavesPresetInput } from "./leaves.js";
import { rainPresetInput } from "./rain.js";
import { smokePresetInput } from "./smoke.js";
import { snowPresetInput } from "./snow.js";
import { sparklePresetInput } from "./sparkle.js";
import { sparksPresetInput } from "./sparks.js";
import type { ParticleDefinition, ParticleDefinitionInput } from "../types.js";

// The nine shipped presets (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3): complete
// documents a fresh project can play with no asset file at all.

/**
 * Every preset name, in the order the documentation lists them.
 *
 * @public
 */
export const PARTICLE_PRESETS = [
  "fire",
  "smoke",
  "sparks",
  "explosion",
  "dust",
  "sparkle",
  "rain",
  "snow",
  "leaves",
] as const;

/**
 * The union of {@link PARTICLE_PRESETS}.
 *
 * @public
 */
export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];

/**
 * A recursively optional view of a type: what an override of a preset looks like.
 *
 * @typeParam T - The type being made optional.
 *
 * @public
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * The document a preset starts from, before any override.
 *
 * @param name - The preset.
 * @returns A fresh copy of the authored document.
 * @throws IgnifxError with code `IGX-1704` for a name that is not a preset.
 *
 * @public
 */
export function particlePresetInput(name: ParticlePreset): ParticleDefinitionInput {
  switch (name) {
    case "fire":
      return firePresetInput();
    case "smoke":
      return smokePresetInput();
    case "sparks":
      return sparksPresetInput();
    case "explosion":
      return explosionPresetInput();
    case "dust":
      return dustPresetInput();
    case "sparkle":
      return sparklePresetInput();
    case "rain":
      return rainPresetInput();
    case "snow":
      return snowPresetInput();
    case "leaves":
      return leavesPresetInput();
    default:
      throw particlesError(ParticlesErrorCode.unknownPreset, `${String(name)} is not a particle preset.`, {
        context: { preset: String(name), presets: PARTICLE_PRESETS.join(", ") },
        hint: `The presets are ${PARTICLE_PRESETS.join(", ")}.`,
      });
  }
}

/**
 * A preset, with any part of it overridden, as a complete definition. An object override merges key
 * by key; an array or a primitive replaces the whole value.
 *
 * @param name - The preset.
 * @param overrides - What to change.
 * @returns The definition, validated and baked.
 * @throws IgnifxError with code `IGX-1704` for an unknown preset, or `IGX-1701` when the overrides
 * make the document invalid.
 *
 * @example
 * ```ts
 * const bigFire = particleDefinition("fire", { start: { size: { min: 0.8, max: 1.2 } } });
 * ```
 *
 * @public
 */
export function particleDefinition(
  name: ParticlePreset,
  overrides?: DeepPartial<ParticleDefinitionInput>,
): ParticleDefinition {
  const base = particlePresetInput(name);
  const merged = overrides === undefined ? base : mergeDeep(base, overrides);
  return defineParticles(merged, `preset:${name}`);
}

/**
 * Merges an override onto a document, object by object.
 *
 * @param base - The document.
 * @param overrides - The changes.
 * @returns The merged document.
 */
function mergeDeep(
  base: ParticleDefinitionInput,
  overrides: DeepPartial<ParticleDefinitionInput>,
): ParticleDefinitionInput {
  // Boundary assertion (coding standards §5.2): the merge walks plain JSON, and `defineParticles`
  // validates every field of the result before anything reads it.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- see above.
  return mergeRecords(base, overrides) as ParticleDefinitionInput;
}

/**
 * Merges two plain records recursively: objects merge, everything else is replaced.
 *
 * @param base - The record being overridden.
 * @param overrides - The overrides.
 * @returns A new record.
 */
function mergeRecords(base: object, overrides: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  const source: Record<string, unknown> = { ...overrides };
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value === undefined) {
      continue;
    }
    const existing = out[key];
    if (isPlainRecord(value) && isPlainRecord(existing)) {
      out[key] = mergeRecords(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Whether a value is a plain object rather than an array, a primitive, or `null`.
 *
 * @param value - The value.
 * @returns `true` for a record.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
