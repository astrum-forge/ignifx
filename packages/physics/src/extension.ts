import { defineExtension, Phase } from "@ignifx/core";
import { CharacterController } from "./components/character-controller.js";
import {
  BoxCollider,
  CapsuleCollider,
  CylinderCollider,
  HeightfieldCollider,
  MeshCollider,
  SphereCollider,
} from "./components/colliders.js";
import { Rigidbody } from "./components/rigidbody.js";
import { PHYSICS_ERROR_MESSAGES } from "./errors.js";
import { HAVOK_WASM_FILE_NAME, loadHavok } from "./lite/havok-module.js";
import { createSimulation, createWorld, disposeSimulation } from "./lite/havok.js";
import { createPhysicsMaterialLoader } from "./material.js";
import { PhysicsHost } from "./runtime/host.js";
import { PhysicsHostKey } from "./runtime/runtime-key.js";
import { PhysicsRuntime, PHYSICS_DIAGNOSTICS_COUNTERS, PHYSICS_DIAGNOSTICS_GROUP } from "./runtime/runtime.js";
import {
  PHYSICS_INTERPOLATE_ORDER,
  PHYSICS_RESTORE_ORDER,
  PHYSICS_STEP_ORDER,
  PhysicsInterpolationSystem,
  PhysicsRestoreSystem,
  PhysicsStepSystem,
} from "./runtime/systems.js";
import { PhysicsService } from "./service.js";
import {
  defaultPhysicsSettings,
  HAVOK_WASM_AUTO,
  PHYSICS_SETTINGS_SECTION,
  physicsSettingsSchema,
} from "./settings.js";
import type { Collider } from "./components/collider.js";
import type { CollisionIdentityMode } from "./runtime/runtime.js";
import type { PhysicsSettings } from "./settings.js";
import type { App, ComponentType, ConcreteComponentType, Extension, ExtensionContext } from "@ignifx/core";

/**
 * Create the physics runtime in `onStart`, after the world and its layer table exist.
 * The Vite plugin copies `HavokPhysics.wasm` into public assets under its base name.
 * Headless loading falls back to the installed Havok package.
 */

/**
 * What `physics()` accepts.
 *
 * @public
 */
export interface PhysicsOptions {
  /**
   * How collision callbacks learn which bodies took part (ADR-0013). `"upstream"` is the default and
   * delivers contacts with `other === null`, because `@babylonjs/lite@1.27.0` reports no identities;
   * `"internal"` opts into the waived adapter-internal drain that recovers them.
   */
  readonly collisionIdentities?: CollisionIdentityMode;
  /** An already-instantiated Havok module, which skips loading entirely. */
  readonly havok?: unknown;
  /** The `HavokPhysics.wasm` bytes, for a host that reads them itself. */
  readonly wasmBinary?: ArrayBuffer;
}

declare module "@ignifx/core" {
  interface App {
    /** 3D physics: gravity, queries, the debug viewer, and the Lite escape hatch. */
    readonly physics: PhysicsService;
  }
}

/**
 * Builds the physics extension.
 *
 * @param options - The collision-identity mode and, optionally, where Havok comes from.
 * @returns The extension descriptor.
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, extensions: [physics()] });
 * ```
 *
 * @public
 */
// `defineExtension` calls the factory with `undefined` when a game writes `physics()`, so the
// default parameter is load-bearing even though the declared type is not nullish
// (`packages/core/src/extension/define-extension.ts`).
// oxlint-disable-next-line typescript/no-useless-default-assignment
export const physics: (options?: PhysicsOptions) => Extension = defineExtension<PhysicsOptions>((options = {}) => {
  const host = new PhysicsHost();
  let context: ExtensionContext | null = null;
  let service: PhysicsService | null = null;

  return {
    name: "@ignifx/physics",
    version: "0.0.0",
    engine: ">=0.0.0 <1.0.0",
    requires: [],
    optional: ["@ignifx/devtools"],

    register(ctx: ExtensionContext): void {
      context = ctx;
      ctx.registerErrorCodes(PHYSICS_ERROR_MESSAGES);
      ctx.registerSettings<PhysicsSettings>(
        PHYSICS_SETTINGS_SECTION,
        physicsSettingsSchema(),
        defaultPhysicsSettings(),
      );
      ctx.registerComponents(PHYSICS_COMPONENTS);
      ctx.registerAssetLoader(createPhysicsMaterialLoader());
      const settings = ctx.settings<PhysicsSettings>(PHYSICS_SETTINGS_SECTION);
      service = new PhysicsService(ctx.app, host, settings);
      ctx.registerService(PhysicsHostKey, host);
      ctx.registerService(PhysicsService, service);
      ctx.defineAppProperty("physics", (): unknown => service);
      ctx.registerSystem(new PhysicsRestoreSystem(host), {
        phase: Phase.FixedUpdate,
        order: PHYSICS_RESTORE_ORDER,
      });
      ctx.registerSystem(new PhysicsStepSystem(host), { phase: Phase.FixedUpdate, order: PHYSICS_STEP_ORDER });
      // `Update`, not `PreRender`: camera rigs and scripts must read the same pose the renderer
      // draws (`runtime/systems.ts`, `docs/architecture/01-lifecycle-and-time.md` §3).
      ctx.registerSystem(new PhysicsInterpolationSystem(host), {
        phase: Phase.Update,
        order: PHYSICS_INTERPOLATE_ORDER,
      });
    },

    async onStart(app: App): Promise<void> {
      const ctx = context;
      if (ctx === null) {
        return;
      }
      const settings = ctx.settings<PhysicsSettings>(PHYSICS_SETTINGS_SECTION);
      const havok = await loadHavok({
        ...(options.havok === undefined ? {} : { module: options.havok }),
        ...(options.wasmBinary === undefined ? {} : { wasmBinary: options.wasmBinary }),
        url: settings.havokWasm === HAVOK_WASM_AUTO ? app.assets.resolveUrl(HAVOK_WASM_FILE_NAME) : settings.havokWasm,
      });
      const simulation = createSimulation();
      let world;
      try {
        world = createWorld(simulation.scene, havok, settings.gravity);
      } catch (cause: unknown) {
        disposeSimulation(simulation);
        throw cause;
      }
      const counters = app.diagnostics.registerGroup(PHYSICS_DIAGNOSTICS_GROUP, PHYSICS_DIAGNOSTICS_COUNTERS);
      host.runtime = new PhysicsRuntime({
        ctx,
        settings,
        simulation,
        world,
        collisionIdentities: options.collisionIdentities ?? "upstream",
        counters,
      });
      ctx.setSimulationScene(simulation.scene);
      seedExistingBodies(app, host);
    },

    dispose(): void {
      // The world is disposed before the extensions and has already dropped the scene; the kernel
      // treats a clear at this point as a no-op (`ExtensionContext.setSimulationScene`).
      context?.setSimulationScene(null);
      service?.dispose();
      host.runtime?.dispose();
      host.runtime = null;
      context = null;
      service = null;
    },
  };
});

/** Every component this extension registers, in a stable order. */
const PHYSICS_COMPONENTS: readonly ConcreteComponentType[] = Object.freeze([
  Rigidbody,
  BoxCollider,
  SphereCollider,
  CapsuleCollider,
  CylinderCollider,
  MeshCollider,
  HeightfieldCollider,
  CharacterController,
]);

/** The collider classes the seed pass walks, in registration order. */
const COLLIDER_TYPES: readonly ComponentType<Collider>[] = Object.freeze([
  BoxCollider,
  SphereCollider,
  CapsuleCollider,
  CylinderCollider,
  MeshCollider,
  HeightfieldCollider,
]);

/**
 * Marks every collider and controller that already exists when the runtime is built.
 *
 * @remarks
 * A component attached before `onStart` — from a scene the `assets.preload` list pulled in, say —
 * called `markDirty` while `app.services.tryGet(PhysicsRuntimeKey)` was still `null`. This is the
 * catch-up pass that makes those bodies exist, and it walks the component store in registration
 * order so body creation order stays deterministic (`09-physics.md` §8).
 *
 * @param app - The app being started.
 * @param host - The holder the runtime landed in.
 */
function seedExistingBodies(app: App, host: PhysicsHost): void {
  const runtime = host.runtime;
  if (runtime === null) {
    return;
  }
  for (const type of COLLIDER_TYPES) {
    const components = app.world.components(type);
    for (let index = 0; index < components.length; index += 1) {
      const collider = components[index];
      if (collider !== undefined) {
        runtime.markDirty(collider.entity);
      }
    }
  }
  const controllers = app.world.components(CharacterController);
  for (let index = 0; index < controllers.length; index += 1) {
    const controller = controllers[index];
    if (controller !== undefined) {
      runtime.markControllerDirty(controller);
    }
  }
}
