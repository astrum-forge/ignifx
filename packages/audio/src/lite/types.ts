import type { AudioBus, AudioEngine, SoundBuffer, SpatialTarget, StaticSound, StreamingSound } from "@babylonjs/lite";

/**
 * The Babylon Lite audio types that appear in `@ignifx/audio`'s public `.lite` escape hatches
 * (`docs/architecture/00-overview.md` §3, `CONSTITUTION.md` §3.4). Re-exporting them as aliases is
 * what keeps `@babylonjs/lite` out of every other file's imports while still letting a signature
 * name the object it hands back.
 *
 * The module is **type-only**: it emits no JavaScript, so it costs nothing at run time and is
 * reachable from the headless backend, which never touches Web Audio.
 *
 * Line numbers below are `@babylonjs/lite@1.27.0`'s `index.d.ts`.
 */

/**
 * Babylon Lite's audio engine (`index.d.ts` 926). Unstable escape hatch: excluded from the
 * stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteAudioEngine = AudioEngine;

/**
 * Babylon Lite's generic mixer bus (`index.d.ts` 910). Unstable escape hatch.
 *
 * @public
 */
export type LiteAudioBus = AudioBus;

/**
 * Babylon Lite's decoded audio buffer (`index.d.ts` 11707). Unstable escape hatch.
 *
 * @public
 */
export type LiteSoundBuffer = SoundBuffer;

/**
 * Babylon Lite's buffer-backed sound (`index.d.ts` 12336). Unstable escape hatch.
 *
 * @public
 */
export type LiteStaticSound = StaticSound;

/**
 * Babylon Lite's media-element-backed sound (`index.d.ts` 12499). Unstable escape hatch.
 *
 * @public
 */
export type LiteStreamingSound = StreamingSound;

/**
 * Anything Lite's spatial nodes can follow: an object exposing a column-major `worldMatrix`
 * (`index.d.ts` 11807). A Lite `SceneNode` — which is what `Transform.lite` hands back — satisfies
 * it, which is how a spatial `AudioSource` follows its entity.
 *
 * @public
 */
export type LiteSpatialTarget = SpatialTarget;
