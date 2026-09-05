/**
 * The committed kernel-level determinism baseline. Regenerating it is a deliberate act: a change
 * here means the frame loop, the dispatch order, or the transform math produced different numbers,
 * which is either a Babylon Lite upgrade or a bug (`CONSTITUTION.md` §2.1).
 *
 * Produced by building the scene in `app-scene.ts` in a headless app and calling `app.step(1 / 60)`
 * 600 times, then hashing all 16 elements of all 50 world matrices with FNV-1a over their
 * `Float64` bit patterns. The same value is asserted in Chromium.
 *
 * It is deliberately the **same** constant as `test/lite/fixtures/determinism-expected.ts`: the
 * scene here is the Lite-level S1.3 scene rebuilt on entities, with the same node graph, the same
 * LCG seed, and the same write order, so the kernel reproducing that hash proves the scheduler and
 * `Transform` add no numeric noise of their own.
 */

/** The hash of the 50 world matrices after 600 frames. */
export const EXPECTED_APP_HASH = "7b79fbda";
