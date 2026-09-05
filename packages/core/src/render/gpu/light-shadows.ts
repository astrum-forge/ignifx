import { createShadowGeneratorForLight } from "../../lite/gpu/shadow-generator.js";
import {
  assertShadowsSupported,
  attachShadowGenerator,
  detachShadowGenerator,
  disposeShadowGenerator,
  setShadowCasters,
} from "../../lite/shadow.js";
import type { LiteMesh } from "../../lite/gpu/mesh.js";
import type { AdapterLight } from "../../lite/light.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { LiteShadowGenerator, ShadowSettings } from "../../lite/shadow.js";
import type { LightShadowSettings } from "../light.js";

/**
 * The device-only half of `Light`'s shadow support
 * (`docs/architecture/07-rendering.md` §2.2).
 *
 * A shadow generator allocates a depth texture and a comparison sampler through `engine._device`
 * (`src/lite/gpu/shadow-generator.ts`), so nothing here can run under the null engine. It lives
 * under `src/render/gpu/`, which the root Vitest coverage config excludes for exactly that reason;
 * the browser project measures it. What stays on the component is the *decision* — whether shadows
 * are wanted, whether the feature is on, and the warning when it is not — which Node tests cover.
 */

/**
 * Builds and attaches a shadow generator for a light.
 *
 * @param engine - The engine that owns the shadow map.
 * @param light - The light that should cast.
 * @param settings - The declared technique and its tuning.
 * @returns The generator.
 * @throws IgnifxError with code `IGX-0703` for a light kind Babylon Lite cannot shadow.
 *
 * @internal
 */
export function attachShadows(
  engine: LiteEngine,
  light: AdapterLight,
  settings: LightShadowSettings,
): LiteShadowGenerator {
  assertShadowsSupported(light.lightType);
  // `assertShadowsSupported` has just established that the light is directional or spot, the two
  // kinds every generator factory accepts (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const generator = createShadowGeneratorForLight(engine, light as never, toShadowSettings(settings));
  attachShadowGenerator(light, generator);
  return generator;
}

/**
 * Detaches a generator from its light and releases its GPU resources.
 *
 * @param scene - The scene the generator was rendering into.
 * @param light - The light it was attached to, or `null` when the light is already gone.
 * @param generator - The generator to release.
 *
 * @internal
 */
export function detachShadows(scene: LiteScene, light: AdapterLight | null, generator: LiteShadowGenerator): void {
  if (light !== null) {
    detachShadowGenerator(light);
  }
  disposeShadowGenerator(scene, generator);
}

/**
 * Replaces the meshes a generator renders into its shadow map.
 *
 * @param generator - The generator.
 * @param casters - The meshes that cast into it.
 *
 * @internal
 */
export function setShadowCasterMeshes(generator: LiteShadowGenerator, casters: readonly LiteMesh[]): void {
  setShadowCasters(generator, casters);
}

/**
 * Reads the component's `shadows` record as the adapter's settings shape, omitting the values that
 * mean "take Lite's default".
 *
 * @param declared - The component's record.
 * @returns The adapter's settings.
 */
function toShadowSettings(declared: LightShadowSettings): ShadowSettings {
  const settings: {
    technique: LightShadowSettings["technique"];
    mapSize?: number;
    bias?: number;
    normalBias?: number;
    darkness?: number;
    cascades?: number;
    maxDistance?: number;
  } = {
    technique: declared.technique,
    mapSize: declared.mapSize,
    bias: declared.bias,
    normalBias: declared.normalBias,
    darkness: declared.darkness,
    cascades: declared.cascades,
  };
  if (declared.maxDistance > 0) {
    settings.maxDistance = declared.maxDistance;
  }
  return settings;
}
