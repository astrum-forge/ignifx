import type { ParticlesService } from "./service/particles-service.js";
import type { ExtensionContext } from "@ignifx/core";

// Declaration merging is what types `app.particles`. The module must import something from
// `@ignifx/core` or the `declare module` block is `TS2664`, and the barrel must keep its bare
// `import "./augmentation.js"` so declaration bundling does not drop it.

declare module "@ignifx/core" {
  interface App {
    /**
     * Particles (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3): the budget, the quality
     * multiplier, the gravity, the counters, and the live list of `ParticleSystem` components.
     */
    readonly particles: ParticlesService;
  }
}

/**
 * Defines `app.particles`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.particles`.
 *
 * @internal
 */
export function defineParticlesAppProperty(ctx: ExtensionContext, service: ParticlesService): void {
  ctx.defineAppProperty("particles", (): unknown => service);
}
