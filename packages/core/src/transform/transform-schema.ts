import { quat, vec3 } from "../schema/field-kinds.js";
import { defineSchema } from "../schema/schema.js";
import type { Schema } from "../schema/types.js";

/**
 * The entity transform as a schema: the fields of a scene file's `transform` block, so an
 * inspector and its ops can treat the transform like any component
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @remarks
 * The schema **describes** the transform; {@link (Transform:class)} does not declare it. The class keeps
 * no schema because its `position` and `rotation` are world-space getters, while the file, this
 * schema, and the editor's `setTransform` op all carry **local** values. Every entity has exactly
 * one transform, which is never in a file's `components` list, so `describeSchemas()` and
 * `describeRegisteredSchemas()` mark `ignifx/Transform` as `builtIn`: it cannot be added or
 * removed, and its values are edited as the whole block, not with a per-prop op.
 *
 * `rotation` is a `quat` field: files and ops store a unit quaternion, and an inspector shows
 * intrinsic XYZ Euler angles in degrees (ADR-0011), so its `step` is in degrees.
 *
 * @returns A new schema: `position` (`vec3`, origin, step 0.01), `rotation` (`quat`, identity,
 * step 0.5 degrees), `scale` (`vec3`, one, step 0.01).
 *
 * @example
 * ```ts
 * const fields = describeSchema("ignifx/Transform", transformSchema()).fields;
 * fields["rotation"]?.default; // [0, 0, 0, 1]
 * ```
 *
 * @public
 */
export function transformSchema(): Schema {
  return defineSchema({
    position: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "Local position relative to the parent, in metres.", step: 0.01 }),
    rotation: quat(
      { x: 0, y: 0, z: 0, w: 1 },
      {
        tooltip:
          "Local rotation relative to the parent: a unit quaternion [x, y, z, w], shown as intrinsic XYZ Euler angles in degrees.",
        step: 0.5,
      },
    ),
    scale: vec3({ x: 1, y: 1, z: 1 }, { tooltip: "Local scale relative to the parent.", step: 0.01 }),
  });
}
