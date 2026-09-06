import { describeSchema } from "@ignifx/core";
import { CharacterController2D } from "./components/character-controller.js";
import {
  BoxCollider2D,
  CapsuleCollider2D,
  CircleCollider2D,
  EdgeCollider2D,
  PolygonCollider2D,
} from "./components/colliders.js";
import { Rigidbody2D } from "./components/rigidbody.js";
import { TilemapCollider2D } from "./components/tilemap-collider.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/physics-2d` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`).
 *
 * The `ignifx.physicsmaterial` **file format** is deliberately absent: `@ignifx/physics` already
 * documents it and this package reads the very same document (`material.ts`), so describing it
 * twice would render the same table on the formats page twice — the harness keeps the first
 * declaration and drops the rest (`scripts/lib/schema-source.ts`).
 */

/**
 * Describes every component this package declares.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * const schemas = describeSchemas();
 * schemas["ignifx/Rigidbody2D"].fields["mass"].default; // 1
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/Rigidbody2D": describeSchema("ignifx/Rigidbody2D", Rigidbody2D.schema, {
      description: "Makes an entity's 2D colliders a dynamic, kinematic, or static Rapier body.",
    }),
    "ignifx/BoxCollider2D": describeSchema("ignifx/BoxCollider2D", BoxCollider2D.schema, {
      description: "An axis-aligned box, sized in local metres and scaled by the entity.",
    }),
    "ignifx/CircleCollider2D": describeSchema("ignifx/CircleCollider2D", CircleCollider2D.schema, {
      description: "A circle; the larger scale axis wins.",
    }),
    "ignifx/CapsuleCollider2D": describeSchema("ignifx/CapsuleCollider2D", CapsuleCollider2D.schema, {
      description: "A capsule standing along X or Y.",
    }),
    "ignifx/PolygonCollider2D": describeSchema("ignifx/PolygonCollider2D", PolygonCollider2D.schema, {
      description: "The convex hull of a point list, in local metres.",
    }),
    "ignifx/EdgeCollider2D": describeSchema("ignifx/EdgeCollider2D", EdgeCollider2D.schema, {
      description: "An open chain of line segments — a platformer's ground contour.",
    }),
    "ignifx/TilemapCollider2D": describeSchema("ignifx/TilemapCollider2D", TilemapCollider2D.schema, {
      description: "The merged collision surface of a Tilemap, rebuilt when its tiles change.",
    }),
    "ignifx/CharacterController2D": describeSchema("ignifx/CharacterController2D", CharacterController2D.schema, {
      description: "A kinematic character with collide-and-slide, slopes, autostep, and snap-to-ground.",
    }),
  };
}
