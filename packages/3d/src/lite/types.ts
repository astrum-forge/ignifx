import type {
  AnimationGroup,
  AnimationManager,
  NavCrowd,
  NavigationPlugin,
  NavMeshSource,
  ObstacleHandle,
} from "@babylonjs/lite";

/**
 * The Babylon Lite handles `@ignifx/3d` exposes through its documented escape hatches
 * (`CONSTITUTION.md` §3.4, `docs/architecture/00-overview.md` §3), re-exported under ignifx names so
 * that no consumer has to import `@babylonjs/lite` to name a type in a signature.
 *
 * Everything here is unstable and excluded from the stability guarantees of `CONSTITUTION.md`
 * Article IV.
 */

/**
 * A Babylon Lite animation manager — one per `Animator` (`index.d.ts` 430).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteAnimationManager = AnimationManager;

/**
 * A Babylon Lite animation group, the clip an `Animator` weights (`index.d.ts` 345).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteAnimationGroup = AnimationGroup;

/**
 * A Babylon Lite navigation plugin: the Recast module plus one baked navmesh (`index.d.ts` 7310).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteNavigationPlugin = NavigationPlugin;

/**
 * A Babylon Lite crowd (`index.d.ts` 7307).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteNavCrowd = NavCrowd;

/**
 * A Babylon Lite tile-cache obstacle handle (`index.d.ts` 7706).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteObstacleHandle = ObstacleHandle;

/**
 * A piece of world-space geometry a navmesh is baked from (`index.d.ts` 7345).
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @beta
 */
export type LiteNavMeshSource = NavMeshSource;
