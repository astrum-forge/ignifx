import { TwoDService } from "@ignifx/2d";
import { defineExtension, Phase } from "@ignifx/core";
import { ParticlesService } from "@ignifx/particles";
import { ParticleSystem2D } from "./component/particle-system-2d.js";
import { PARTICLES_2D_ERROR_MESSAGES, Particles2DErrorCode, particles2DError } from "./errors.js";
import {
  PARTICLES_2D_DIAGNOSTICS_COUNTERS,
  PARTICLES_2D_DIAGNOSTICS_GROUP,
  Particles2DService,
} from "./service/particles-2d-service.js";
import {
  PARTICLE_2D_UPDATE_ORDER,
  PARTICLE_2D_WRITE_ORDER,
  Particle2DUpdateSystem,
  Particle2DWriteSystem,
} from "./systems.js";
import { VERSION } from "./version.js";
import type { Extension, ExtensionContext, SortingLayersSettings } from "@ignifx/core";

/**
 * The `@ignifx/particles-2d` extension (`docs/architecture/04-extensions.md` §1,
 * `docs/plan/2026-09-terrain-particles-shaders.md` §4).
 *
 * Registering it is the whole installation: `particles2D()` gives a game the `ParticleSystem2D`
 * component, the `particles-2d` diagnostics group, and the two systems that drive every effect —
 * emission late in `Update`, the sprite write in `PreRender` before the 2D sync.
 *
 * It adds no asset type and no settings section of its own: `.particles.json` and `app.particles`
 * come from `@ignifx/particles`, which is why both extensions must be registered.
 */

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @returns The service, so the caller can dispose it.
 * @throws IgnifxError with code `IGX-1751` when the extension is registered twice.
 */
function registerParticles2D(ctx: ExtensionContext): Particles2DService {
  if (ctx.tryGet(Particles2DService) !== null) {
    throw particles2DError(
      Particles2DErrorCode.duplicateExtension,
      "The particles2D() extension is already registered on this app.",
    );
  }
  ctx.registerErrorCodes(PARTICLES_2D_ERROR_MESSAGES);
  const app = ctx.app;
  const sortingLayers = app.settings.section<SortingLayersSettings>("sortingLayers").sortingLayers;
  const service = new Particles2DService(ctx.require(ParticlesService), ctx.require(TwoDService), sortingLayers);
  service.setCounters(app.diagnostics.registerGroup(PARTICLES_2D_DIAGNOSTICS_GROUP, PARTICLES_2D_DIAGNOSTICS_COUNTERS));
  ctx.registerService(Particles2DService, service);
  ctx.registerComponents([ParticleSystem2D]);
  ctx.registerSystem(new Particle2DUpdateSystem(service), { phase: Phase.Update, order: PARTICLE_2D_UPDATE_ORDER });
  ctx.registerSystem(new Particle2DWriteSystem(service), { phase: Phase.PreRender, order: PARTICLE_2D_WRITE_ORDER });
  ctx.onDispose((): void => {
    service.dispose();
  });
  return service;
}

/**
 * The `@ignifx/particles-2d` extension factory.
 *
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, extensions: [twoD(), particles(), particles2D()] });
 * ```
 *
 * @public
 */
export const particles2D: () => Extension = defineExtension(() => ({
  name: "@ignifx/particles-2d",
  version: VERSION,
  engine: ">=0.0.0 <1.0.0",
  requires: ["@ignifx/core", "@ignifx/2d", "@ignifx/particles"],
  register(ctx: ExtensionContext): void {
    registerParticles2D(ctx);
  },
}));
