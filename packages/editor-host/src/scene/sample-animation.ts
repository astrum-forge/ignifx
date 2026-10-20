/**
 * `sampleAnimation`: the scene view poses an entity's `Animator` at one point of one state, through
 * the engine's `Animator.sample` (ADR-0028, amendment 2026-10-20). The host depends on core only, so
 * it finds the `Animator` by its type id and calls `sample` by shape.
 */

import { isIgnifxError } from "@ignifx/core";
import { InvalidParamsError } from "../channel.js";
import { isSampleAnimationParams } from "../protocol/index.js";
import { componentTypeOf } from "./view-2d.js";
import type { DocumentMirror } from "./document.js";
import type { SampleAnimationResult } from "../protocol/index.js";
import type { App } from "@ignifx/core";

/** The type id `@ignifx/3d` registers its `Animator` under. */
export const ANIMATOR_TYPE_ID = "ignifx/Animator";

/**
 * Answers `sampleAnimation` on the open document.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param params - The received `params`.
 * @returns Whether the pose was written.
 * @throws InvalidParamsError for malformed params, an entity the document lacks or one without an
 * `Animator`, and any `IgnifxError` the engine throws, whose code it carries as `data.code`.
 */
export function sampleAnimation(app: App, mirror: DocumentMirror, params: unknown): SampleAnimationResult {
  if (!isSampleAnimationParams(params)) {
    throw new InvalidParamsError(
      "sampleAnimation takes { entity: uid, state: string, normalizedTime: number, parameters?: { [name]: number | boolean } }.",
    );
  }
  const entity = mirror.index()?.entities.get(params.entity);
  if (entity === undefined) {
    throw new InvalidParamsError(`sampleAnimation names ${params.entity}, which is not an entity of the open scene.`);
  }
  const type = componentTypeOf(app, ANIMATOR_TYPE_ID);
  const animator = type === null ? null : entity.getComponent(type);
  const sample: unknown = animator === null ? undefined : Reflect.get(animator, "sample");
  if (animator === null || typeof sample !== "function") {
    throw new InvalidParamsError(`The entity ${params.entity} has no Animator to sample.`);
  }
  const options = params.parameters === undefined ? [] : [{ parameters: params.parameters }];
  try {
    const posed: unknown = Reflect.apply(sample, animator, [params.state, params.normalizedTime, ...options]);
    return { posed: posed === true };
  } catch (error) {
    if (isIgnifxError(error)) {
      throw new InvalidParamsError(error.message, { code: error.code });
    }
    throw error;
  }
}
