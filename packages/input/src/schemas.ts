import { describeSchema } from "@ignifx/core";
import { describeInputActionsFormat } from "./asset/schemas.js";
import { PlayerInput } from "./components/player-input.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/input` declares
 * (`scripts/README.md`, "Schema discovery convention";
 * `docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * The **function** form is what a package uses rather than a `schemas` object, because building the
 * record means calling `describeSchema` and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 */

/**
 * Describes every component and file format this package declares, for the documentation harness.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * describeInputSchemas()["ignifx/PlayerInput"].fields["deviceSlot"].default; // 0
 * ```
 *
 * @public
 */
export function describeInputSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/PlayerInput": describeSchema("ignifx/PlayerInput", PlayerInput.schema, {
      description: "Binds an entity to an input actions document and one device slot, for local multiplayer.",
    }),
    "ignifx/inputactions-file": describeInputActionsFormat(),
  };
}

/**
 * The name `pnpm docs:schemas` discovers this package's schemas under.
 *
 * @returns The same records {@link describeInputSchemas} returns.
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return describeInputSchemas();
}
