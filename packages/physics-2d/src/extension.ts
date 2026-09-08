import { defineExtension, Phase } from "@ignifx/core";
import { CharacterController2D } from "./components/character-controller.js";
import {
  BoxCollider2D,
  CapsuleCollider2D,
  CircleCollider2D,
  EdgeCollider2D,
  PolygonCollider2D,
} from "./components/colliders.js";
import { Rigidbody2D } from "./components/rigidbody.js";
import { TilemapCollider2D } from "./components/tilemap-collider.js";
import { PHYSICS_2D_ERROR_MESSAGES, Physics2DErrorCode, physics2DError } from "./errors.js";
import { loadRapier } from "./lite/rapier/module.js";
import { createWorld } from "./lite/rapier/world.js";
import { createPhysicsMaterial2DLoader } from "./material.js";
import { Physics2DHost } from "./runtime/host.js";
import { Physics2DHostKey } from "./runtime/runtime-key.js";
import { PHYSICS_2D_DIAGNOSTICS_COUNTERS, PHYSICS_2D_DIAGNOSTICS_GROUP, Physics2DRuntime } from "./runtime/runtime.js";
import {
  PHYSICS_2D_INTERPOLATE_ORDER,
  PHYSICS_2D_RESTORE_ORDER,
  PHYSICS_2D_STEP_ORDER,
  Physics2DInterpolationSystem,
  Physics2DRestoreSystem,
  Physics2DStepSystem,
} from "./runtime/systems.js";
import { Physics2DService } from "./service.js";
import { defaultPhysics2DSettings, PHYSICS_2D_SETTINGS_SECTION, physics2DSettingsSchema } from "./settings.js";
import type { Collider2D } from "./components/collider.js";
import type { Physics2DSettings } from "./settings.js";
import type { App, ComponentType, ConcreteComponentType, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/physics-2d` extension (`docs/architecture/11-2d-toolkit.md` §8,
 * `04-extensions.md` §1).
 *
 * ## Why `@ignifx/2d` is optional rather than required
 *
 * `00-overview.md` §2 draws `@ignifx/physics-2d` above `@ignifx/2d`, and the layering rule allows
 * the dependency. At runtime the only thing this package needs from the toolkit is the
 * `TilemapCollisionData` **type**, which is erased at build time, so a platformer that draws its own
 * graphics can register `physics2d()` on its own. The manifest therefore declares
 * `requires: []` and `optional: ["@ignifx/2d"]`, and `package.json` makes `@ignifx/2d` an optional
 * peer dependency.
 *
 * ## Why the world is built in `onStart`
 *
 * `register` runs before `createApp` builds the `World` (`packages/core/src/app/app.ts`,
 * `initialize`), and the Rapier world needs the world's layer table; Rapier's WebAssembly module
 * also has to be instantiated, which is asynchronous. So `register` declares everything against a
 * {@link Physics2DHost} holder and `onStart` fills the holder in.
 *
 * ## One physics extension per world
 *
 * `11-2d-toolkit.md` §8: "A world uses either `physics()` or `physics2d()`; registering both throws
 * `IGX-1101`". `@ignifx/physics` publishes its Havok simulation scene through
 * `ExtensionContext.setSimulationScene`, so `app.world.lite.simulationScene !== null` at `onStart`
 * is the test — and it needs no dependency on `@ignifx/physics`, which this package must not have.
 */

/**
 * What `physics2d()` accepts.
 *
 * @public
 */
export interface Physics2DOptions {
  /**
   * Replaces the step that instantiates Rapier's WebAssembly module. The default awaits
   * `RAPIER.init()`, which decodes the base64 payload the `-compat` build inlines; a host that has
   * already preloaded the module, or a test that wants to observe the failure path, supplies its
   * own.
   */
  readonly initialize?: () => Promise<void>;
}

declare module "@ignifx/core" {
  interface App {
    /** 2D physics: gravity, queries, and the Rapier escape hatch. */
    readonly physics2d: Physics2DService;
  }
}

/**
 * Builds the 2D physics extension.
 *
 * @param options - Optionally, an already-instantiated Rapier module.
 * @returns The extension descriptor.
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, extensions: [physics2d()] });
 * ```
 *
 * @public
 */
export const physics2d: (options?: Physics2DOptions) => Extension = defineExtension<Physics2DOptions>(
  // `defineExtension` calls the factory with `undefined` when a game writes `physics2d()`, so the
  // default parameter is load-bearing even though the declared parameter type is not nullish.
  // oxlint-disable-next-line typescript/no-useless-default-assignment
  (options = {}) => {
    const host = new Physics2DHost();
    let context: ExtensionContext | null = null;

    return {
      name: "@ignifx/physics-2d",
      version: "0.0.0",
      engine: ">=0.0.0 <1.0.0",
      requires: [],
      optional: ["@ignifx/2d", "@ignifx/devtools"],

      register(ctx: ExtensionContext): void {
        context = ctx;
        ctx.registerErrorCodes(PHYSICS_2D_ERROR_MESSAGES);
        ctx.registerSettings<Physics2DSettings>(
          PHYSICS_2D_SETTINGS_SECTION,
          physics2DSettingsSchema(),
          defaultPhysics2DSettings(),
        );
        ctx.registerComponents(PHYSICS_2D_COMPONENTS);
        ctx.registerAssetLoader(createPhysicsMaterial2DLoader());
        const settings = ctx.settings<Physics2DSettings>(PHYSICS_2D_SETTINGS_SECTION);
        const service = new Physics2DService(host, settings);
        ctx.registerService(Physics2DHostKey, host);
        ctx.registerService(Physics2DService, service);
        ctx.defineAppProperty("physics2d", (): unknown => service);
        ctx.registerSystem(new Physics2DRestoreSystem(host), {
          phase: Phase.FixedUpdate,
          order: PHYSICS_2D_RESTORE_ORDER,
        });
        ctx.registerSystem(new Physics2DStepSystem(host), { phase: Phase.FixedUpdate, order: PHYSICS_2D_STEP_ORDER });
        // `Update`, not `PreRender`: camera rigs and scripts must read the same pose the renderer
        // draws (`runtime/systems.ts`, `docs/architecture/01-lifecycle-and-time.md` §3).
        ctx.registerSystem(new Physics2DInterpolationSystem(host), {
          phase: Phase.Update,
          order: PHYSICS_2D_INTERPOLATE_ORDER,
        });
      },

      async onStart(app: App): Promise<void> {
        const ctx = context;
        if (ctx === null) {
          return;
        }
        if (app.world.lite.simulationScene !== null) {
          throw physics2DError(
            Physics2DErrorCode.bothPhysicsExtensions,
            "A world uses either physics() or physics2d(), and this one registered both.",
            {
              context: { extension: "@ignifx/physics-2d" },
              hint: "Remove physics() from a 2D game, or physics2d() from a 3D one.",
            },
          );
        }
        const settings = ctx.settings<Physics2DSettings>(PHYSICS_2D_SETTINGS_SECTION);
        const initialize = options.initialize ?? defaultInitialize;
        try {
          await initialize();
        } catch (cause: unknown) {
          throw physics2DError(
            Physics2DErrorCode.rapierUnavailable,
            "The Rapier 2D WebAssembly module could not be instantiated.",
            { cause, hint: "Reinstall @dimforge/rapier2d-compat; its WebAssembly is inlined and needs no serving." },
          );
        }
        const world = createWorld(settings.gravity);
        const counters = app.diagnostics.registerGroup(PHYSICS_2D_DIAGNOSTICS_GROUP, PHYSICS_2D_DIAGNOSTICS_COUNTERS);
        host.runtime = new Physics2DRuntime({ ctx, settings, world, counters });
        seedExistingBodies(app, host);
      },

      dispose(): void {
        host.runtime?.dispose();
        host.runtime = null;
        context = null;
      },
    };
  },
);

/**
 * Instantiates Rapier's WebAssembly module, which is what `Physics2DOptions.initialize` replaces.
 *
 * @returns A promise that settles once Rapier is usable.
 */
async function defaultInitialize(): Promise<void> {
  await loadRapier();
}

/** Every component this extension registers, in a stable order. */
const PHYSICS_2D_COMPONENTS: readonly ConcreteComponentType[] = Object.freeze([
  Rigidbody2D,
  BoxCollider2D,
  CircleCollider2D,
  CapsuleCollider2D,
  PolygonCollider2D,
  EdgeCollider2D,
  TilemapCollider2D,
  CharacterController2D,
]);

/** The collider classes the seed pass walks, in registration order. */
const COLLIDER_2D_TYPES: readonly ComponentType<Collider2D>[] = Object.freeze([
  BoxCollider2D,
  CircleCollider2D,
  CapsuleCollider2D,
  PolygonCollider2D,
  EdgeCollider2D,
  TilemapCollider2D,
]);

/**
 * Marks every collider and controller that already exists when the runtime is built.
 *
 * @remarks
 * A component attached before `onStart` — from a scene the `assets.preload` list pulled in, say —
 * called `markDirty` while the runtime was still `null`. This is the catch-up pass that makes those
 * bodies exist, and it walks the component store in registration order so body creation order stays
 * deterministic (`09-physics.md` §8).
 *
 * @param app - The app being started.
 * @param host - The holder the runtime landed in.
 */
function seedExistingBodies(app: App, host: Physics2DHost): void {
  const runtime = host.runtime;
  if (runtime === null) {
    return;
  }
  for (const type of COLLIDER_2D_TYPES) {
    const components = app.world.components(type);
    for (let index = 0; index < components.length; index += 1) {
      const collider = components[index];
      if (collider !== undefined) {
        runtime.markDirty(collider.entity);
      }
    }
  }
  const controllers = app.world.components(CharacterController2D);
  for (let index = 0; index < controllers.length; index += 1) {
    const controller = controllers[index];
    if (controller !== undefined) {
      runtime.markDirty(controller.entity);
    }
  }
}
