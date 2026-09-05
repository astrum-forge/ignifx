/**
 * The committed physics determinism baseline (`docs/architecture/09-physics.md` §8).
 *
 * Produced by building the scene in `physics-scene.ts` in a headless app and stepping it 600 times
 * at `1 / 60`, then hashing every body's world position and rotation with FNV-1a over their
 * `Float64` bit patterns.
 *
 * Regenerating it is a deliberate act: a change here means Havok, Babylon Lite, or the extension's
 * own ordering produced different numbers, which is either a dependency upgrade or a bug. §8 is
 * explicit that this is a **same-platform, same-build** guarantee: the constant is asserted on the
 * platform CI runs, and cross-platform bit-exactness is measured, not promised (risk R-14).
 */

/** The hash of the pile's poses after 600 fixed steps. */
export const EXPECTED_PHYSICS_HASH = "2301e7d4";
