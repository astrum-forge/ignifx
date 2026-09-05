import { describeSchema } from "@ignifx/core";
import { CharacterController } from "./components/character-controller.js";
import {
  BoxCollider,
  CapsuleCollider,
  CylinderCollider,
  HeightfieldCollider,
  MeshCollider,
  SphereCollider,
} from "./components/colliders.js";
import { Rigidbody } from "./components/rigidbody.js";
import { describePhysicsMaterialFileFormat } from "./material.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/physics` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`).
 *
 * `pnpm docs:schemas` imports the built entry point, calls {@link describeSchemas}, and turns the
 * result into `skills/ignifx/references/formats/<format>.md`. Keys are namespaced `<package>/<Name>`
 * type ids; the file format is keyed `ignifx/physicsmaterial-file` for the same reason `@ignifx/core`
 * keys its file formats that way — the harness rejects a key with no `/` and groups pages by
 * `format`.
 */

/**
 * Describes every component and file format this package declares.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * const schemas = describeSchemas();
 * schemas["ignifx/Rigidbody"].fields["mass"].default; // 1
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/Rigidbody": describeSchema("ignifx/Rigidbody", Rigidbody.schema, {
      description: "Makes an entity's colliders a dynamic, kinematic, or static Havok body.",
    }),
    "ignifx/BoxCollider": describeSchema("ignifx/BoxCollider", BoxCollider.schema, {
      description: "A box collision shape, sized in local units and scaled by the entity.",
    }),
    "ignifx/SphereCollider": describeSchema("ignifx/SphereCollider", SphereCollider.schema, {
      description: "A sphere collision shape; the largest scale axis wins.",
    }),
    "ignifx/CapsuleCollider": describeSchema("ignifx/CapsuleCollider", CapsuleCollider.schema, {
      description: "A capsule collision shape standing along X, Y, or Z.",
    }),
    "ignifx/CylinderCollider": describeSchema("ignifx/CylinderCollider", CylinderCollider.schema, {
      description: "A cylinder collision shape standing along Y.",
    }),
    "ignifx/MeshCollider": describeSchema("ignifx/MeshCollider", MeshCollider.schema, {
      description: "A triangle-mesh or convex-hull shape built from real geometry; needs a GPU app.",
    }),
    "ignifx/HeightfieldCollider": describeSchema("ignifx/HeightfieldCollider", HeightfieldCollider.schema, {
      description: "A terrain collision shape built from a regular grid of height samples.",
    }),
    "ignifx/CharacterController": describeSchema("ignifx/CharacterController", CharacterController.schema, {
      description: "A kinematic capsule with collide-and-slide, support detection, and body pushing.",
    }),
    "ignifx/physicsmaterial-file": describePhysicsMaterialFileFormat(),
  };
}
