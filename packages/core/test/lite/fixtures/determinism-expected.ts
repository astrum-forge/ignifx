/**
 * The committed S1.3 baseline. Regenerating it is a deliberate act: a change here means the
 * transform math produced different numbers, which is either a Babylon Lite upgrade or a bug
 * (`CONSTITUTION.md` §2.1).
 *
 * Produced by building the scene in `determinism-scene.ts`, advancing it 600 times through one
 * ignifx frame callback on a Lite null engine, and hashing all 16 elements of all 50 world matrices
 * with FNV-1a over their `Float64` bit patterns. The same value is asserted in Chromium.
 */

/** The hash of the 50 world matrices after 600 fixed steps. */
export const EXPECTED_HASH = "7b79fbda";
