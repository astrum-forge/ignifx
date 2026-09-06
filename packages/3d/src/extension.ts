import { defineExtension, Phase } from "@ignifx/core";
import { THREE_D_ANIMATION_ORDER, ThreeDAnimationSystem } from "./animator/animation-system.js";
import { Animator } from "./animator/animator.js";
import { createAnimatorLoader } from "./animator/loader.js";
import { defineNavigationAppProperty } from "./augmentation.js";
import { ThirdPersonCamera } from "./camera/third-person-camera.js";
import { FirstPersonController } from "./character/first-person-controller.js";
import { PlatformMover, Projectile, RigidbodyMover } from "./character/movers.js";
import { ThirdPersonController } from "./character/third-person-controller.js";
import { BILLBOARD_ORDER, Billboard, BillboardSystem } from "./environment/billboard.js";
import { LOD_ORDER, LodGroup, LodSystem } from "./environment/lod-group.js";
import { THREE_D_ERROR_MESSAGES } from "./errors.js";
import { NavMeshAgent } from "./navigation/nav-mesh-agent.js";
import { NavMeshObstacle } from "./navigation/nav-mesh-obstacle.js";
import { NavMeshSurface } from "./navigation/nav-mesh-surface.js";
import { NavigationService } from "./navigation/navigation-service.js";
import { NAVIGATION_ORDER, NavigationSystem } from "./navigation/navigation-system.js";
import { THREE_D_SETTINGS_SECTION, defaultThreeDSettings, threeDSettingsSchema } from "./settings.js";
import { VERSION } from "./version.js";
import type { ThreeDSettings } from "./settings.js";
import type { App, ConcreteComponentType, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/3d` extension (`docs/architecture/04-extensions.md` §1, `12-3d-toolkit.md`).
 *
 * Registering it is the whole installation: `threeD()` gives a game `app.navigation`, twelve
 * components, the `animator` asset type, the `threeD` settings section, and the four systems that
 * drive the toolkit — skeletal animation in `PostUpdate`, billboards just after it, LOD selection
 * in `PreRender`, and the navigation crowd in `FixedUpdate`.
 *
 * ## Phase order, and why
 *
 * | System | Phase | Order | Why there |
 * | --- | --- | --- | --- |
 * | `ThreeDAnimationSystem` | `PostUpdate` | `10` | After core's tweens (`-100`) and `@ignifx/2d`'s sprite clock (`0`), so a tween driving an `Animator` parameter is read the same frame. |
 * | `BillboardSystem` | `PostUpdate` | `20` | After animation, so a billboard on an animated bone uses this frame's pose. |
 * | `LodSystem` | `PreRender` | `-10` | Before core's render sync (`0`), so a switched renderer reaches the scene this frame. |
 * | `NavigationSystem` | `FixedUpdate` | `200` | After `fixedUpdate` scripts and the physics step, on the fixed clock Lite asks for (`index.d.ts` 2718-2721). |
 *
 * ## The "not ready yet" state
 *
 * Recast is a WebAssembly module and loading it is asynchronous, so a `NavMeshSurface` cannot be
 * baked synchronously in `onStart`. The extension does not try: the navigation system starts the
 * bake of any surface that wants one and moves on, agents simply do not join a crowd that does not
 * exist yet, and `NavMeshSurface.onBaked` is what a game waits on. A query made too early answers
 * with an empty path rather than throwing, because a companion that stands still for one frame is a
 * far better failure than a scene that does not load.
 */

/**
 * What `threeD()` accepts. Every field overrides the matching `threeD` settings section value.
 *
 * @public
 */
export interface ThreeDOptions {
  /** The seed Recast's randomized queries start from. */
  readonly navigationSeed?: number;
  /**
   * Where the Recast `.wasm` is served from. Omit it to use the copy Babylon Lite inlines as a
   * `data:` URL, which needs no build configuration at all
   * (`docs/adr/0017-navigation-wasm.md`).
   */
  readonly navigationWasmUrl?: string;
  /** Whether a `NavMeshSurface` bakes itself when the world loads. */
  readonly autoBakeNavMesh?: boolean;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `threeD` section.
 * @param options - What the game passed to `threeD(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: ThreeDSettings, options: ThreeDOptions): ThreeDSettings {
  return {
    navigationSeed: options.navigationSeed ?? settings.navigationSeed,
    navigationWasmUrl: options.navigationWasmUrl ?? settings.navigationWasmUrl,
    autoBakeNavMesh: options.autoBakeNavMesh ?? settings.autoBakeNavMesh,
  };
}

/**
 * The components the extension registers, in the order the API report lists them.
 *
 * @returns The classes.
 */
function components(): readonly ConcreteComponentType[] {
  return [
    Animator,
    ThirdPersonController,
    FirstPersonController,
    RigidbodyMover,
    PlatformMover,
    Projectile,
    ThirdPersonCamera,
    NavMeshSurface,
    NavMeshAgent,
    NavMeshObstacle,
    LodGroup,
    Billboard,
  ];
}

/**
 * Registers everything the package contributes.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `threeD(...)`.
 */
function registerThreeD(ctx: ExtensionContext, options: ThreeDOptions): void {
  ctx.registerErrorCodes(THREE_D_ERROR_MESSAGES);
  ctx.registerSettings<ThreeDSettings>(THREE_D_SETTINGS_SECTION, threeDSettingsSchema(), defaultThreeDSettings());
  const settings = mergeSettings(ctx.settings<ThreeDSettings>(THREE_D_SETTINGS_SECTION), options);
  // Skinned meshes need Lite's bone control switched on *before* any model loads, which is what
  // `requireRenderingFeature` is for (`docs/architecture/07-rendering.md` §1.1): an `Animator`
  // driving a skeleton is the whole reason this package exists.
  ctx.requireRenderingFeature("boneControl");
  const navigation = new NavigationService(
    ctx.app,
    settings.navigationWasmUrl === "" ? null : (): string => settings.navigationWasmUrl,
  );
  ctx.registerService(NavigationService, navigation);
  defineNavigationAppProperty(ctx, navigation);
  ctx.registerAssetLoader(createAnimatorLoader());
  ctx.registerComponents(components());
  ctx.registerSystem(new ThreeDAnimationSystem(), { phase: Phase.PostUpdate, order: THREE_D_ANIMATION_ORDER });
  ctx.registerSystem(new BillboardSystem(), { phase: Phase.PostUpdate, order: BILLBOARD_ORDER });
  ctx.registerSystem(new LodSystem(), { phase: Phase.PreRender, order: LOD_ORDER });
  ctx.registerSystem(new NavigationSystem(navigation), { phase: Phase.FixedUpdate, order: NAVIGATION_ORDER });
  ctx.onDispose((): void => {
    navigation.dispose();
  });
}

/**
 * Applies the project's navigation defaults to every surface that has not been told otherwise.
 *
 * @param app - The app being started.
 * @param settings - The effective `threeD` settings.
 */
function startThreeD(app: App, settings: ThreeDSettings): void {
  const surfaces = app.world.components(NavMeshSurface);
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index];
    if (surface === undefined) {
      continue;
    }
    if (surface.randomSeed === 0) {
      surface.randomSeed = settings.navigationSeed;
    }
    if (!settings.autoBakeNavMesh) {
      surface.bakeOnAwake = false;
    }
  }
}

/**
 * The `@ignifx/3d` extension factory.
 *
 * @param options - Overrides for the `threeD` settings section.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   extensions: [physics(), input(), threeD({ navigationSeed: 42 })],
 * });
 * ```
 *
 * @public
 */
export const threeD: (options?: ThreeDOptions) => Extension = defineExtension<ThreeDOptions | undefined>((raw) => {
  // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
  // game wrote `threeD()`; the typed signature cannot express that, so the default lands here.
  const options: ThreeDOptions = raw ?? {};
  return {
    name: "@ignifx/3d",
    version: VERSION,
    engine: ">=0.0.0 <1.0.0",
    requires: ["@ignifx/core", "@ignifx/physics", "@ignifx/input"],
    register(ctx: ExtensionContext): void {
      registerThreeD(ctx, options);
    },
    onStart(app: App): void {
      startThreeD(app, mergeSettings(app.settings.section<ThreeDSettings>(THREE_D_SETTINGS_SECTION), options));
    },
  };
});
