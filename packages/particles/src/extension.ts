import { defineExtension, Phase } from "@ignifx/core";
import { createParticleLoader } from "./assets/loader.js";
import { defineParticlesAppProperty } from "./augmentation.js";
import { PARTICLES_ERROR_MESSAGES, ParticlesErrorCode, particlesError } from "./errors.js";
import { PARTICLE_RENDER_ORDER, PARTICLE_UPDATE_ORDER, ParticleSystem } from "./gpu/particle-system.js";
import { ParticleRenderSystem, ParticleUpdateSystem } from "./gpu/particle-systems.js";
import {
  PARTICLES_DIAGNOSTICS_COUNTERS,
  PARTICLES_DIAGNOSTICS_GROUP,
  ParticlesService,
} from "./service/particles-service.js";
import { defaultParticlesSettings, PARTICLES_SETTINGS_SECTION, particlesSettingsSchema } from "./settings.js";
import { VERSION } from "./version.js";
import type { ParticlesSettings } from "./settings.js";
import type { App, Extension, ExtensionContext, Vec3Like } from "@ignifx/core";

// The `@ignifx/particles` extension (`docs/architecture/04-extensions.md` §1). It requires nothing
// but core: `@ignifx/physics` is read by data, through the `physics` settings section, so an effect
// that says "use the world's gravity" agrees with the rigidbodies around it without a dependency.

/**
 * What `particles()` accepts. Every field overrides the matching `particles` settings section value.
 *
 * @public
 */
export interface ParticlesOptions {
  /** The particle budget every system's capacity is counted against. */
  readonly maxParticles?: number;
  /** A `0`–`1` multiplier on every emission rate and burst count. */
  readonly qualityScale?: number;
  /** The world gravity a `gravityMultiplier` scales. */
  readonly gravity?: Vec3Like;
}

/** The shape of the `physics` settings section this package reads by data. */
interface PhysicsGravitySection {
  readonly gravity?: Vec3Like;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `particles` section.
 * @param options - What the game passed to `particles(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: ParticlesSettings, options: ParticlesOptions): ParticlesSettings {
  return {
    maxParticles: options.maxParticles ?? settings.maxParticles,
    qualityScale: options.qualityScale ?? settings.qualityScale,
    gravity: options.gravity ?? settings.gravity,
  };
}

/**
 * Whether two gravity vectors are the same.
 *
 * @param a - One vector.
 * @param b - The other.
 * @returns `true` when every component matches.
 */
function sameGravity(a: Vec3Like, b: Vec3Like): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `particles(...)`.
 * @returns The service, for `onStart`.
 */
function registerParticles(ctx: ExtensionContext, options: ParticlesOptions): ParticlesService {
  if (ctx.tryGet(ParticlesService) !== null) {
    throw particlesError(
      ParticlesErrorCode.duplicateExtension,
      "The particles() extension is already registered on this app.",
    );
  }
  ctx.registerErrorCodes(PARTICLES_ERROR_MESSAGES);
  ctx.registerSettings<ParticlesSettings>(
    PARTICLES_SETTINGS_SECTION,
    particlesSettingsSchema(),
    defaultParticlesSettings(),
  );
  const settings = mergeSettings(ctx.settings<ParticlesSettings>(PARTICLES_SETTINGS_SECTION), options);
  const service = new ParticlesService(ctx.app, settings);
  service.setCounters(ctx.app.diagnostics.registerGroup(PARTICLES_DIAGNOSTICS_GROUP, PARTICLES_DIAGNOSTICS_COUNTERS));
  ctx.registerService(ParticlesService, service);
  defineParticlesAppProperty(ctx, service);
  ctx.registerAssetLoader(createParticleLoader());
  ctx.registerComponents([ParticleSystem]);
  ctx.registerSystem(new ParticleUpdateSystem(service), { phase: Phase.Update, order: PARTICLE_UPDATE_ORDER });
  ctx.registerSystem(new ParticleRenderSystem(service), { phase: Phase.PreRender, order: PARTICLE_RENDER_ORDER });
  ctx.onDispose((): void => {
    service.dispose();
  });
  return service;
}

/**
 * Adopts the physics gravity when the project left the particles gravity alone and `@ignifx/physics`
 * registered a section.
 *
 * @param app - The app being started.
 * @param service - The service to write into.
 * @param options - The extension options, which win over both sections.
 */
function adoptPhysicsGravity(app: App, service: ParticlesService, options: ParticlesOptions): void {
  if (options.gravity !== undefined) {
    return;
  }
  const section = app.settings.section<ParticlesSettings>(PARTICLES_SETTINGS_SECTION);
  if (!sameGravity(section.gravity, defaultParticlesSettings().gravity)) {
    return;
  }
  let physics: PhysicsGravitySection | null;
  try {
    physics = app.settings.section<PhysicsGravitySection>("physics");
  } catch {
    // `IGX-0407`: no physics extension is registered, which is the ordinary case for a particles-only app.
    physics = null;
  }
  const gravity = physics?.gravity;
  if (gravity !== undefined) {
    service.gravity = gravity;
  }
}

/**
 * The `@ignifx/particles` extension factory.
 *
 * @param options - Overrides for the `particles` settings section.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, extensions: [particles({ maxParticles: 50_000 })] });
 * ```
 *
 * @public
 */
export const particles: (options?: ParticlesOptions) => Extension = defineExtension<ParticlesOptions | undefined>(
  (raw) => {
    // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
    // game wrote `particles()`; the typed signature cannot express that, so the default lands here.
    const options: ParticlesOptions = raw ?? {};
    let service: ParticlesService | null = null;
    return {
      name: "@ignifx/particles",
      version: VERSION,
      engine: ">=0.0.0 <1.0.0",
      requires: ["@ignifx/core"],
      optional: ["@ignifx/physics"],
      register(ctx: ExtensionContext): void {
        service = registerParticles(ctx, options);
      },
      onStart(app: App): void {
        if (service !== null) {
          adoptPhysicsGravity(app, service, options);
        }
      },
    };
  },
);
