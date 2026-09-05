import { VERSION } from "../app/version.js";
import { array, f64, str } from "../schema/field-kinds.js";
import { defineSchema } from "../schema/schema.js";
import { Transform } from "../transform/transform.js";
import { defineExtension } from "./define-extension.js";
import type { Extension, ExtensionContext, LayersSettings, SortingLayersSettings, TimeSettings } from "../app/types.js";

/**
 * The implicit core extension (`docs/architecture/04-extensions.md` §7). `@ignifx/core` registers
 * itself through the same contract as everything else, so there is one code path and one set of
 * guarantees.
 *
 * @remarks
 * Phase 1 registers what the kernel owns: `Transform` and the `layers`, `sortingLayers`, and `time`
 * settings sections. `Camera`, `Light`, `MeshRenderer`, the asset loaders, and the `assets` and
 * `rendering` sections join it as the phases of `docs/plan/engineering-plan.md` deliver them.
 *
 * The core diagnostic codes are **not** registered here: `createErrorCodeRegistry()` already
 * pre-loads `CORE_ERROR_MESSAGES`, and registering them a second time is `IGX-1501`.
 *
 * The schemas and defaults are built inside `register`, not at module scope: a schema field is a
 * function call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4). They are built once per app, which is where the
 * cost belongs.
 */

/**
 * The default project layer list (`docs/architecture/04-extensions.md` §5). It is the first five of
 * the eight engine-reserved names, which is why a default project consumes no user layer slot
 * (`02-scene-graph.md` §7).
 */
const DEFAULT_LAYERS: readonly string[] = Object.freeze(["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"]);

/** The default sorting-layer list, consumed by the 2D toolkit. */
const DEFAULT_SORTING_LAYERS: readonly string[] = Object.freeze(["Default"]);

/** The default fixed step, in seconds (`01-lifecycle-and-time.md` §2). */
const DEFAULT_FIXED_DELTA_TIME = 1 / 60;

/** The default frame-delta clamp, in seconds. */
const DEFAULT_MAXIMUM_DELTA_TIME = 0.1;

/** The default time scale. */
const DEFAULT_TIME_SCALE = 1;

/**
 * Registers the core settings sections and the core components.
 *
 * @param ctx - The registration surface.
 */
function registerCore(ctx: ExtensionContext): void {
  ctx.registerSettings<LayersSettings>("layers", defineSchema({ layers: array(str(), DEFAULT_LAYERS) }), {
    layers: DEFAULT_LAYERS,
  });
  ctx.registerSettings<SortingLayersSettings>(
    "sortingLayers",
    defineSchema({ sortingLayers: array(str(), DEFAULT_SORTING_LAYERS) }),
    { sortingLayers: DEFAULT_SORTING_LAYERS },
  );
  ctx.registerSettings<TimeSettings>(
    "time",
    defineSchema({
      fixedDeltaTime: f64(DEFAULT_FIXED_DELTA_TIME, { min: Number.EPSILON }),
      maximumDeltaTime: f64(DEFAULT_MAXIMUM_DELTA_TIME, { min: Number.EPSILON }),
      timeScale: f64(DEFAULT_TIME_SCALE, { min: 0 }),
    }),
    {
      fixedDeltaTime: DEFAULT_FIXED_DELTA_TIME,
      maximumDeltaTime: DEFAULT_MAXIMUM_DELTA_TIME,
      timeScale: DEFAULT_TIME_SCALE,
    },
  );
  ctx.registerComponent(Transform);
}

/**
 * Builds the extension `createApp` always puts first (`docs/architecture/04-extensions.md` §2
 * rule 1).
 *
 * @returns The core extension descriptor.
 *
 * @example
 * ```ts
 * // createApp does this for you; the list is only ever built by the kernel.
 * const extensions = [coreExtension(), physics(), input()];
 * ```
 *
 * @public
 */
export const coreExtension: (options?: void) => Extension = defineExtension(() => ({
  name: "@ignifx/core",
  version: VERSION,
  register: registerCore,
}));
