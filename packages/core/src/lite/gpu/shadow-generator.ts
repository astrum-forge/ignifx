import {
  createCsmDirectionalShadowGenerator,
  createEsmDirectionalShadowGenerator,
  createPcfDirectionalShadowGenerator,
  createPcfSpotlightShadowGenerator,
} from "@babylonjs/lite";
import { assertNever } from "../../errors/ignifx-error.js";
import { toCsmConfig, toEsmConfig, toPcfConfig, toSpotConfig } from "../shadow.js";
import type { ShadowSettings, ShadowTechnique } from "../shadow.js";
import type { DirectionalLight, EngineContext, ShadowGenerator, SpotLight } from "@babylonjs/lite";

/**
 * The four shadow-generator factories (`docs/architecture/07-rendering.md` §2.2). Each allocates a
 * depth texture and a comparison sampler through `engine._device`
 * (`lib/shadow/pcf-directional-shadow-generator.js`), so they are GPU-only. Everything a generator
 * needs afterwards — caster lists, attachment, disposal — is in `../shadow.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## Which techniques exist (verified against `@babylonjs/lite@1.27.0`)
 *
 * Directional lights get ESM (`index.d.ts` 2482), PCF (2846) or CSM (2329); spot lights get PCF
 * only (2856). There is no point-light generator and no area light, which is why `../shadow.ts`
 * rejects those with `IGX-0703`. The `technique` a spot light declares is therefore ignored, not an
 * error: PCF is the only thing Lite can do for it.
 */

/**
 * Builds the shadow generator a light's declared settings ask for.
 *
 * @param engine - The engine that owns the shadow map.
 * @param light - The directional or spot light that will cast.
 * @param settings - The declared technique and its tuning.
 * @returns The generator. Attach it with `attachShadowGenerator` and give it casters with
 * `setShadowCasters`, both from `../shadow.ts`.
 *
 * @example
 * ```ts
 * const generator = createShadowGeneratorForLight(engine, sun, { technique: "pcf", mapSize: 2048 });
 * attachShadowGenerator(sun, generator);
 * setShadowCasters(generator, casters);
 * ```
 *
 * @internal
 */
export function createShadowGeneratorForLight(
  engine: EngineContext,
  light: DirectionalLight | SpotLight,
  settings: ShadowSettings,
): ShadowGenerator {
  if (light.lightType === "spot") {
    return createPcfSpotlightShadowGenerator(engine, light, toSpotConfig(settings));
  }
  return createDirectionalGenerator(engine, light, settings);
}

/**
 * Builds the directional generator for a technique.
 *
 * @param engine - The engine that owns the shadow map.
 * @param light - The directional light.
 * @param settings - The declared technique and its tuning.
 * @returns The generator.
 */
function createDirectionalGenerator(
  engine: EngineContext,
  light: DirectionalLight,
  settings: ShadowSettings,
): ShadowGenerator {
  const technique: ShadowTechnique = settings.technique;
  switch (technique) {
    case "esm":
      return createEsmDirectionalShadowGenerator(engine, light, toEsmConfig(settings));
    case "pcf":
      return createPcfDirectionalShadowGenerator(engine, light, toPcfConfig(settings));
    case "csm":
      return createCsmDirectionalShadowGenerator(engine, light, toCsmConfig(settings));
    default:
      return assertNever(technique, "shadow technique");
  }
}
