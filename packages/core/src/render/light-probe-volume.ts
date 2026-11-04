import { Component } from "../component/component.js";
import { asset, f32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { LightProbeAsset } from "./light-probe-asset.js";
import type { AssetHandle } from "../assets/types.js";
import type { Schema } from "../schema/types.js";

/**
 * Lights PBR materials with a baked light-probe grid instead of the scene environment's diffuse
 * light (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B2).
 *
 * @remarks
 * Every lit PBR material samples the grid per pixel, blending the eight probes around it, so moving
 * objects and shared materials need nothing extra. Outside the grid the nearest edge probes apply.
 * Reflections still come from the `Environment` or a `ReflectionProbe`. The volume needs a loaded
 * `Environment` and a canvas; its GPU code loads only once a world has one, and headless it does
 * nothing. When several volumes are enabled, the most recently created one wins.
 *
 * @example
 * ```ts
 * const probes = await app.assets.loadAsync<LightProbeAsset>("lighting/hall.probes.json");
 * world.createEntity("Probes").addComponent(LightProbeVolume, { probes });
 * ```
 *
 * @beta
 */
export class LightProbeVolume extends Component {
  /** The namespaced registration id. */
  static typeId = "ignifx/LightProbeVolume";

  /** What the component does, in one line, for an inspector. */
  static description = "Lights PBR materials with a baked light-probe grid instead of the environment's diffuse light.";

  /** One volume per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = lightProbeVolumeSchema();

  /** The `.probes.json` grid, or `null` (default) for none. */
  declare probes: AssetHandle<LightProbeAsset> | null;

  /** A multiplier on the probes' light. Defaults to `1`. */
  declare intensity: number;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(LightProbeVolume.schema));
  }

  /**
   * The grid this volume lights with right now.
   *
   * @returns The loaded asset, or `null` while there is none or it is still loading.
   *
   * @internal
   */
  loadedProbes(): LightProbeAsset | null {
    const handle = this.probes;
    return handle !== null && handle.state === "loaded" ? handle.value : null;
  }
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function: module scope holds declarations and immutable
 * constants only (`CONSTITUTION.md` §3.5).
 */
function lightProbeVolumeSchema(): Schema {
  return defineSchema({
    probes: asset(LightProbeAsset, { tooltip: "The baked .probes.json grid." }),
    intensity: f32(1, { min: 0, tooltip: "A multiplier on the probes' light." }),
  });
}
