import { Component } from "../component/component.js";
import { enumOf, f32, layerMask, optional, u32, vec3 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import type { Vec3Like } from "../math/types.js";
import type { Schema } from "../schema/types.js";

/**
 * The `ReflectionProbe` component (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B1).
 *
 * The component only holds settings and the "capture again" request. The renderer loads the probe's
 * GPU code (`./gpu/reflection-probes.ts`, `../lite/gpu/reflection-probe.ts`) only once a world has
 * a probe, so a project without one pays nothing for it (`CONSTITUTION.md` §2.5). Headless, a probe
 * captures nothing.
 */

/**
 * The `as const` name table behind {@link ReflectionProbeRefreshMode}.
 *
 * @public
 */
export const REFLECTION_PROBE_REFRESH_MODES = ["once", "onDemand", "everyFrame"] as const;

/**
 * When a reflection probe renders its cube map again.
 *
 * @remarks
 * - `"once"` (default): when the probe is first ready, and again on {@link ReflectionProbe.refresh}.
 * - `"onDemand"`: only on {@link ReflectionProbe.refresh}; until then the probe reflects nothing.
 * - `"everyFrame"`: every frame, six extra scene passes each frame. Use it for one probe at most, on
 *   desktop. The `low` and `medium` quality tiers (`rendering.quality`) treat it as `"once"`.
 *
 * @public
 */
export type ReflectionProbeRefreshMode = (typeof REFLECTION_PROBE_REFRESH_MODES)[number];

/** The smallest and largest cube face, in pixels. */
const MIN_SIZE = 16;
const MAX_SIZE = 1024;

/**
 * A point that captures the scene around it into a cube map, which nearby shiny PBR materials then
 * reflect instead of the scene environment.
 *
 * @remarks
 * Each lit PBR material reflects the nearest enabled probe that has captured: a probe whose
 * `boxProjection` box holds the mesh wins over one that does not, then the closer probe wins. With no
 * probe, materials reflect the `Environment` again. A material shared by several meshes follows the
 * first of them. Diffuse lighting still comes from the scene environment.
 *
 * The probe needs a loaded `Environment` (it reuses its lighting tables) and a canvas-backed app;
 * until an environment map is loaded it waits, holding no GPU memory and costing no frame time. A
 * `rendering.quality` tier caps `size` and allows `"everyFrame"` only at `high` (below, the probe
 * captures as `"once"`); with the `custom` tier nothing is capped.
 * Mip levels are box-filtered, so very rough materials look blurrier than with a prefiltered `.env`.
 *
 * @example
 * ```ts
 * const probe = world.createEntity("Room probe", { position: { x: 0, y: 1.5, z: 0 } });
 * probe.addComponent(ReflectionProbe, { size: 128, boxProjection: { x: 8, y: 3, z: 8 } });
 * ```
 *
 * @beta
 */
export class ReflectionProbe extends Component {
  /** The namespaced registration id. */
  static typeId = "ignifx/ReflectionProbe";

  /** What the component does, in one line, for an inspector. */
  static description = "Captures the scene around it into a cube map that nearby PBR materials reflect.";

  /** One probe per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = reflectionProbeSchema();

  /**
   * Cube face size in pixels, rounded down to a power of two from 16 to 1024. Defaults to `128`. A
   * `rendering.quality` tier caps it: 64 at `low`, 128 at `medium`, 256 at `high`.
   */
  declare size: number;

  /** When the probe captures again. Defaults to `"once"`. */
  declare refreshMode: ReflectionProbeRefreshMode;

  /**
   * The full size, in metres, of the box (centred on the probe) that reflections are projected onto,
   * or `null` (default) for no box: reflections then look infinitely far away.
   */
  declare boxProjection: Vec3Like | null;

  /** The layer names the probe captures; empty (default) captures every layer. */
  declare cullingMask: readonly string[];

  /** The near clip distance of the capture, in metres. Defaults to `0.1`. */
  declare near: number;

  /** The far clip distance of the capture, in metres. Defaults to `1000`. */
  declare far: number;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(ReflectionProbe.schema));
  }

  #isRefreshRequested = false;

  /**
   * Asks the probe to capture again from the next frame, whatever its `refreshMode`.
   *
   * @remarks
   * Call it after the static scene around the probe changed, such as a door opening. A capture
   * repeats over a few frames, so meshes whose materials are still compiling are caught.
   */
  refresh(): void {
    this.#isRefreshRequested = true;
  }

  /**
   * Reads and clears the request {@link ReflectionProbe.refresh} made.
   *
   * @returns Whether a capture was requested since the last call.
   *
   * @internal
   */
  consumeRefreshRequest(): boolean {
    const requested = this.#isRefreshRequested;
    this.#isRefreshRequested = false;
    return requested;
  }
}

/**
 * The cube face size a probe captures at.
 *
 * @param size - The authored size.
 * @param maxSize - The quality tier's cap (`RenderingQualityPreset.reflectionProbeMaxSize`); 1024
 * when no tier applies.
 * @returns `size` rounded down to a power of two and clamped to 16..`maxSize`; 128 (or `maxSize` if
 * smaller) for a value that is not a finite number.
 *
 * @internal
 */
export function resolveReflectionProbeSize(size: number, maxSize: number = MAX_SIZE): number {
  const upper = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(maxSize)));
  const clamped = Number.isFinite(size) ? Math.min(upper, Math.max(MIN_SIZE, Math.floor(size))) : Math.min(upper, 128);
  return 2 ** Math.floor(Math.log2(clamped));
}

/**
 * The refresh mode a probe runs with under a quality tier.
 *
 * @param mode - The authored mode.
 * @param allowsEveryFrame - Whether the tier lets a probe capture every frame
 * (`RenderingQualityPreset.reflectionProbeEveryFrame`; `true` when no tier applies).
 * @returns `mode`, except `"everyFrame"` reads as `"once"` when the tier forbids it.
 *
 * @internal
 */
export function resolveReflectionProbeRefreshMode(
  mode: ReflectionProbeRefreshMode,
  allowsEveryFrame: boolean,
): ReflectionProbeRefreshMode {
  return mode === "everyFrame" && !allowsEveryFrame ? "once" : mode;
}

/**
 * A probe as {@link selectReflectionProbe} sees it.
 *
 * @internal
 */
export interface ReflectionProbeCandidate {
  /** The probe's world position. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The full size of its projection box, or `null`. */
  readonly box: Vec3Like | null;
}

/**
 * Picks the probe a point reflects.
 *
 * @remarks
 * A probe whose box holds the point wins, the smallest such box first; with none, the closest
 * probe centre wins. Ties keep the earlier probe.
 *
 * @param x - The point's world X.
 * @param y - The point's world Y.
 * @param z - The point's world Z.
 * @param candidates - The enabled probes that have captured.
 * @returns The index of the chosen probe, or `-1` when there is none.
 *
 * @internal
 */
export function selectReflectionProbe(
  x: number,
  y: number,
  z: number,
  candidates: readonly ReflectionProbeCandidate[],
): number {
  let inside = -1;
  let insideVolume = Number.POSITIVE_INFINITY;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const probe = candidates[index];
    if (probe === undefined) {
      continue;
    }
    const dx = x - probe.x;
    const dy = y - probe.y;
    const dz = z - probe.z;
    const box = probe.box;
    if (box !== null && Math.abs(dx) <= box.x / 2 && Math.abs(dy) <= box.y / 2 && Math.abs(dz) <= box.z / 2) {
      const volume = box.x * box.y * box.z;
      if (volume < insideVolume) {
        inside = index;
        insideVolume = volume;
      }
    }
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return inside >= 0 ? inside : nearest;
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function: module scope holds declarations and immutable
 * constants only (`CONSTITUTION.md` §3.5).
 */
function reflectionProbeSchema(): Schema {
  return defineSchema({
    size: u32(128, {
      min: MIN_SIZE,
      max: MAX_SIZE,
      tooltip:
        "Cube face size in pixels, rounded down to a power of two. Larger is sharper and slower to capture. Quality tiers cap it (low 64, medium 128, high 256).",
    }),
    refreshMode: enumOf(REFLECTION_PROBE_REFRESH_MODES, "once", {
      tooltip:
        "once: capture when ready and on refresh(); onDemand: only on refresh(); everyFrame: every frame (costly; one probe; the low and medium quality tiers treat it as once).",
    }),
    boxProjection: optional(vec3({ x: 10, y: 10, z: 10 }), {
      tooltip:
        "Full size in metres of the box, centred on the probe, that reflections are projected onto; null for none.",
    }),
    cullingMask: layerMask([], { tooltip: "The layers the probe captures; empty captures every layer." }),
    near: f32(0.1, { min: 0.001, tooltip: "Near clip distance of the capture, in metres." }),
    far: f32(1000, { min: 0.01, tooltip: "Far clip distance of the capture, in metres." }),
  });
}
