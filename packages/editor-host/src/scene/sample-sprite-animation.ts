/**
 * `sampleSpriteAnimation`: the scene view shows one frame of a clip on an entity's `SpriteAnimator`
 * (engine ask E51), through `@ignifx/2d`'s `SpriteAnimator.sample` and `sampleTime`. The host
 * depends on core only, so it finds the `SpriteAnimator` by its type id and calls them by shape.
 */

import { isIgnifxError } from "@ignifx/core";
import { InvalidParamsError } from "../channel.js";
import { isSampleSpriteAnimationParams, SAMPLE_ANIMATION_MAX_NAME_LENGTH } from "../protocol/index.js";
import { componentTypeOf } from "./view-2d.js";
import type { DocumentMirror } from "./document.js";
import type { SampleSpriteAnimationResult } from "../protocol/index.js";
import type { App } from "@ignifx/core";

/** The type id `@ignifx/2d` registers its `SpriteAnimator` under. */
export const SPRITE_ANIMATOR_TYPE_ID = "ignifx/SpriteAnimator";

/**
 * Answers `sampleSpriteAnimation` on the open document.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param params - The received `params`.
 * @returns Whether the frame was written.
 * @throws InvalidParamsError for malformed params, an entity the document lacks or one without a
 * `SpriteAnimator`, and any `IgnifxError` the engine throws, whose code it carries as `data.code`.
 */
export function sampleSpriteAnimation(app: App, mirror: DocumentMirror, params: unknown): SampleSpriteAnimationResult {
  if (!isSampleSpriteAnimationParams(params)) {
    throw new InvalidParamsError(
      `sampleSpriteAnimation takes { entity: uid, clip: string, frame: number } or { entity: uid, clip: string, time: number }, with names of at most ${String(SAMPLE_ANIMATION_MAX_NAME_LENGTH)} characters.`,
    );
  }
  const entity = mirror.index()?.entities.get(params.entity);
  if (entity === undefined) {
    throw new InvalidParamsError(
      `sampleSpriteAnimation names ${params.entity}, which is not an entity of the open scene.`,
    );
  }
  const type = componentTypeOf(app, SPRITE_ANIMATOR_TYPE_ID);
  const animator = type === null ? null : entity.getComponent(type);
  const byTime = params.frame === undefined;
  const method: unknown = animator === null ? undefined : Reflect.get(animator, byTime ? "sampleTime" : "sample");
  if (animator === null || typeof method !== "function") {
    throw new InvalidParamsError(`The entity ${params.entity} has no SpriteAnimator to sample.`);
  }
  try {
    const posed: unknown = Reflect.apply(method, animator, [params.clip, params.frame ?? params.time ?? 0]);
    return { posed: posed === true };
  } catch (error) {
    if (isIgnifxError(error)) {
      throw new InvalidParamsError(error.message, { code: error.code });
    }
    throw error;
  }
}
