import { describeSchema } from "@ignifx/core";
import { Animator } from "./animator/animator.js";
import { ANIMATOR_FORMAT } from "./animator/definition.js";
import { ThirdPersonCamera } from "./camera/third-person-camera.js";
import { FirstPersonController } from "./character/first-person-controller.js";
import { PlatformMover, Projectile, RigidbodyMover } from "./character/movers.js";
import { ThirdPersonController } from "./character/third-person-controller.js";
import { Billboard } from "./environment/billboard.js";
import { LodGroup } from "./environment/lod-group.js";
import { animatorFileSchema } from "./file-schemas.js";
import { NavMeshAgent } from "./navigation/nav-mesh-agent.js";
import { NavMeshObstacle } from "./navigation/nav-mesh-obstacle.js";
import { NavMeshSurface } from "./navigation/nav-mesh-surface.js";
import { threeDSettingsSchema } from "./settings.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/3d` declares
 * (`scripts/README.md`, "Schema discovery convention";
 * `docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * The **function** form is what a package uses rather than a `schemas` object, because building the
 * record means calling `describeSchema` and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 */

/**
 * Describes the `ignifx.animator` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeAnimatorFormat(): SchemaDescription {
  return describeSchema("ignifx/animator-file", animatorFileSchema(), {
    title: "Animator",
    format: ANIMATOR_FORMAT,
    description: "An animation state machine: parameters, layers, states, transitions, and 1D blend trees.",
  });
}

/**
 * Describes every component and settings section this package registers.
 *
 * @returns The record `pnpm docs:schemas` renders, keyed by schema id.
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return Object.freeze({
    "ignifx/Animator": describeSchema("ignifx/Animator", Animator.schema, { title: "Animator" }),
    "ignifx/Billboard": describeSchema("ignifx/Billboard", Billboard.schema, { title: "Billboard" }),
    "ignifx/FirstPersonController": describeSchema("ignifx/FirstPersonController", FirstPersonController.schema, {
      title: "First person controller",
    }),
    "ignifx/LodGroup": describeSchema("ignifx/LodGroup", LodGroup.schema, { title: "LOD group" }),
    "ignifx/NavMeshAgent": describeSchema("ignifx/NavMeshAgent", NavMeshAgent.schema, { title: "Nav mesh agent" }),
    "ignifx/NavMeshObstacle": describeSchema("ignifx/NavMeshObstacle", NavMeshObstacle.schema, {
      title: "Nav mesh obstacle",
    }),
    "ignifx/NavMeshSurface": describeSchema("ignifx/NavMeshSurface", NavMeshSurface.schema, {
      title: "Nav mesh surface",
    }),
    "ignifx/PlatformMover": describeSchema("ignifx/PlatformMover", PlatformMover.schema, { title: "Platform mover" }),
    "ignifx/Projectile": describeSchema("ignifx/Projectile", Projectile.schema, { title: "Projectile" }),
    "ignifx/RigidbodyMover": describeSchema("ignifx/RigidbodyMover", RigidbodyMover.schema, {
      title: "Rigidbody mover",
    }),
    "ignifx/ThirdPersonCamera": describeSchema("ignifx/ThirdPersonCamera", ThirdPersonCamera.schema, {
      title: "Third person camera",
    }),
    "ignifx/ThirdPersonController": describeSchema("ignifx/ThirdPersonController", ThirdPersonController.schema, {
      title: "Third person controller",
    }),
    "ignifx/threeD-settings": describeSchema("ignifx/threeD-settings", threeDSettingsSchema(), {
      title: "3D settings",
      description: "The threeD project settings section.",
    }),
    "ignifx/animator-file": describeAnimatorFormat(),
  });
}
