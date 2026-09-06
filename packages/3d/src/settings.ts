import { bool, defineSchema, str, u32 } from "@ignifx/core";
import type { Schema } from "@ignifx/core";

/**
 * The `threeD` project settings section (`docs/architecture/04-extensions.md` §5,
 * `12-3d-toolkit.md` §5).
 *
 * The section is small on purpose. Almost everything the 3D toolkit does is per-entity and belongs
 * on a component, where a scene file can author it; the only genuinely project-wide decisions are
 * about navigation, which loads a half-megabyte WebAssembly module and needs one deterministic seed
 * for the whole game.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const THREE_D_SETTINGS_SECTION = "threeD";

/** The seed every navmesh starts from unless a surface overrides it. */
const DEFAULT_NAVIGATION_SEED = 1337;

/**
 * The resolved `threeD` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({
 *   threeD: { navigationSeed: 42, navigationWasmUrl: "/recast-navigation.wasm" },
 * });
 * ```
 *
 * @public
 */
export interface ThreeDSettings {
  /**
   * The seed Recast's randomized queries start from. One seed for the whole project is what makes
   * two runs of a level produce the same paths.
   */
  readonly navigationSeed: number;
  /**
   * Where the Recast `.wasm` is served from, or the empty string to use the copy Babylon Lite
   * inlines as a `data:` URL. See `docs/adr/0017-navigation-wasm.md`.
   */
  readonly navigationWasmUrl: string;
  /** Whether a `NavMeshSurface` bakes itself when the world loads, without being asked. */
  readonly autoBakeNavMesh: boolean;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `threeD` section.
 *
 * @public
 */
export function defaultThreeDSettings(): ThreeDSettings {
  return { navigationSeed: DEFAULT_NAVIGATION_SEED, navigationWasmUrl: "", autoBakeNavMesh: true };
}

/**
 * The schema the `threeD` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function threeDSettingsSchema(): Schema {
  return defineSchema({
    navigationSeed: u32(DEFAULT_NAVIGATION_SEED, { tooltip: "The seed Recast's randomized queries start from." }),
    navigationWasmUrl: str("", { tooltip: "Where the Recast wasm is served from; empty uses Lite's inlined copy." }),
    autoBakeNavMesh: bool(true, { tooltip: "Whether a NavMeshSurface bakes itself when the world loads." }),
  });
}
