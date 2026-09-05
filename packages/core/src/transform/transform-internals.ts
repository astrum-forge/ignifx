import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { Transform } from "./transform.js";
import type { LiteSceneNode } from "../lite/node.js";

/**
 * The link between a `Transform` and the Babylon Lite node it is a view over. It lives behind a
 * module symbol for the same reason the component's engine state does: the entity creates the node
 * and hands it to a transform that has already been constructed, and the property must not be
 * nameable from game code (`transform.lite` is the documented way in).
 */

/**
 * The key the Lite node hangs off a transform.
 *
 * @internal
 */
export const TRANSFORM_NODE: unique symbol = Symbol("ignifx.transform.node");

/**
 * Binds a freshly constructed transform to its entity's Lite node. Called once, by the entity
 * constructor, before the transform is attached.
 *
 * @param transform - The transform.
 * @param node - The entity's Lite node.
 *
 * @internal
 */
export function attachTransform(transform: Transform, node: LiteSceneNode): void {
  transform[TRANSFORM_NODE] = node;
}

/**
 * The Lite node a transform views.
 *
 * @param transform - The transform.
 * @returns The node.
 * @throws IgnifxError with code `IGX-0206` when the transform has not been bound to a node — only
 * possible for a `new Transform()` that the engine never attached.
 *
 * @internal
 */
export function transformNode(transform: Transform): LiteSceneNode {
  const node = transform[TRANSFORM_NODE];
  if (node === null) {
    throw new IgnifxError(CoreErrorCode.componentNotAttached, "This Transform is not attached to an entity yet.", {
      context: { component: "Transform" },
      hint: "Transforms are created by the engine; use `world.createEntity()` and read `entity.transform`.",
    });
  }
  return node;
}

/**
 * Builds the "a transform cannot be removed or disabled" error
 * (`docs/architecture/01-lifecycle-and-time.md` §6).
 *
 * @returns The error to throw.
 *
 * @internal
 */
export function transformIsNotRemovable(): IgnifxError {
  return new IgnifxError(CoreErrorCode.transformIsNotRemovable, "Transform cannot be removed or disabled.", {
    context: { component: "Transform" },
    hint: "Every entity keeps exactly one transform for its whole life; deactivate the entity instead.",
  });
}
