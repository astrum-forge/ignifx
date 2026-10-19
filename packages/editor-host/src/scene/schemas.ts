/**
 * `getSchemas` and `schemasChanged`: every registered component's schema, as the inspector reads
 * it, plus core's file-format entries.
 */

import { describeSchema, describeSchemas, toJsonSchema, Transform, transformSchema } from "@ignifx/core";
import type { SchemaDescription, SchemaSet } from "../protocol/index.js";
import type { App } from "@ignifx/core";

/** The `format` core's component entries carry; file formats carry their own name instead. */
const COMPONENTS_FORMAT = "components";

/**
 * Describes every component class the app has registered (engine, extensions and the project's
 * scripts) with the JSON Schema of its `props`, plus core's file-format entries.
 *
 * @remarks
 * A component core describes keeps core's title and summary; any other is titled from its type id.
 * The host's own classes are left out: they are not the document's. `ignifx/Transform`, whose
 * class declares no schema, is described with core's `transformSchema()` and carries `builtIn`:
 * its fields are each entity's `transform` block, edited with `setTransform`, and it is never added
 * or removed.
 *
 * @param app - The scene view's app.
 * @param hidden - Type ids to leave out.
 * @returns The set, keyed by type id.
 */
export function schemaSet(app: App, hidden: ReadonlySet<string>): SchemaSet {
  const core = describeSchemas();
  const schemas: Record<string, SchemaDescription> = {};
  for (const [typeId, type] of app.world.registry.registrations()) {
    if (hidden.has(typeId)) {
      continue;
    }
    const builtIn = type === Transform;
    const schema = builtIn ? transformSchema() : (app.world.registry.describe(type).schema ?? {});
    const known = core[typeId];
    const meta =
      known === undefined
        ? undefined
        : {
            title: known.title,
            ...(known.description === undefined ? {} : { description: known.description }),
            ...(builtIn ? { builtIn } : {}),
          };
    schemas[typeId] = { ...describeSchema(typeId, schema, meta), propsSchema: toJsonSchema(schema) };
  }
  for (const [id, description] of Object.entries(core)) {
    if (description.format !== COMPONENTS_FORMAT) {
      schemas[id] = description;
    }
  }
  return { schemas };
}
