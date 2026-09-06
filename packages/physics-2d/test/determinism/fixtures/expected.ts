/**
 * The committed 2D determinism baseline (`docs/architecture/09-physics.md` §8, ADR-0006).
 *
 * Produced by building the scene in `physics-2d-scene.ts` in a headless app and stepping it 600
 * times at `1 / 60`, then hashing every body's world position and `rotation2D` with FNV-1a over
 * their `Float64` bit patterns.
 *
 * Regenerating it is a deliberate act: a change here means Rapier or the extension's own ordering
 * produced different numbers, which is either a dependency upgrade or a bug.
 *
 * This is a same-platform, same-build guarantee only. `@dimforge/rapier2d-compat@0.20.0` is the
 * main Rapier build, whose README says it does not guarantee cross-platform determinism of the
 * physics simulation, only local determinism on the same machine;
 * `@dimforge/rapier2d-deterministic-compat` is the build that does. ADR-0006's validation section
 * records the correction.
 */

/** The hash of the pile's poses after 600 fixed steps. */
export const EXPECTED_PHYSICS_2D_HASH = "5718c5f0";
