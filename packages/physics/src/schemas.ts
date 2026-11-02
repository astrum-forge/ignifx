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
      description: Rigidbody.description,
    }),
    "ignifx/BoxCollider": describeSchema("ignifx/BoxCollider", BoxCollider.schema, {
      description: BoxCollider.description,
    }),
    "ignifx/SphereCollider": describeSchema("ignifx/SphereCollider", SphereCollider.schema, {
      description: SphereCollider.description,
    }),
    "ignifx/CapsuleCollider": describeSchema("ignifx/CapsuleCollider", CapsuleCollider.schema, {
      description: CapsuleCollider.description,
    }),
    "ignifx/CylinderCollider": describeSchema("ignifx/CylinderCollider", CylinderCollider.schema, {
      description: CylinderCollider.description,
    }),
    "ignifx/MeshCollider": describeSchema("ignifx/MeshCollider", MeshCollider.schema, {
      description: MeshCollider.description,
    }),
    "ignifx/HeightfieldCollider": describeSchema("ignifx/HeightfieldCollider", HeightfieldCollider.schema, {
      description: HeightfieldCollider.description,
    }),
    "ignifx/CharacterController": describeSchema("ignifx/CharacterController", CharacterController.schema, {
      description: CharacterController.description,
    }),
    "ignifx/physicsmaterial-file": describePhysicsMaterialFileFormat(),
  };
}
