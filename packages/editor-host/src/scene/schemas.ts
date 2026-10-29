/**
 * `getSchemas` and `schemasChanged`: every registered component's schema, as the inspector reads
 * it, plus core's file-format entries.
 */

import { describeRegisteredSchemas, describeSchemas, toJsonSchema, Transform, transformSchema } from "@ignifx/core";
import type { SchemaDescription, SchemaSet } from "../protocol/index.js";
import type { App, ComponentRegistry, ComponentType } from "@ignifx/core";

/** The `format` core's component entries carry; file formats carry their own name instead. */
const COMPONENTS_FORMAT = "components";

/**
 * Describes every component class the app's registry holds (engine, extensions and the project's
 * scripts) with core's `describeRegisteredSchemas`, plus the JSON Schema of its `props` and core's
 * file-format entries.
 *
 * @remarks
 * Each field carries its inspector options (`step`, `hidden`, `readonly`, `group`, an asset's
 * `assetType`, a `componentRef`'s `componentType`), and each component its `allowMultiple` and the
 * `package` that registered it, all optional members of protocol 0.3. A component core describes
 * keeps core's title and summary; any other is titled from its type id. The host's own classes are left out: they are not the
 * document's. `ignifx/Transform` is described with core's `transformSchema()` and carries
 * `builtIn`: its fields are each entity's `transform` block, edited with `setTransform`, and it is
 * never added or removed. Each component also carries `extends` (engine ask E44): the registered
 * components its class derives from, which count as present for a `requires` entry.
 *
 * The set is read from the live registry each time, so a hot reload that adds a field or a script
 * shows in the next `schemasChanged`.
 *
 * @param app - The scene view's app.
 * @param hidden - Type ids to leave out.
 * @returns The set, keyed by type id.
 */
export function schemaSet(app: App, hidden: ReadonlySet<string>): SchemaSet {
  const core = describeSchemas();
  const registry = app.world.registry;
  const described = describeRegisteredSchemas(registry, core);
  const schemas: Record<string, SchemaDescription> = {};
  for (const [typeId, type] of registry.registrations()) {
    const description = described[typeId];
    if (hidden.has(typeId) || description === undefined) {
      continue;
    }
    const schema = type === Transform ? transformSchema() : (registry.describe(type).schema ?? {});
    schemas[typeId] = {
      ...description,
      extends: registeredAncestors(registry, type),
      propsSchema: toJsonSchema(schema),
    };
  }
  for (const [id, description] of Object.entries(core)) {
    if (description.format !== COMPONENTS_FORMAT) {
      schemas[id] = description;
    }
  }
  return { schemas };
}

/**
 * The type ids of the registered component classes a class derives from, nearest first.
 *
 * @remarks
 * `Entity.getComponent`, and so `addComponent`'s `requires` check, matches a class against the
 * attached component's ancestor chain, by class identity. An ancestor is listed when it is
 * registered under its own `static typeId`, the id `requires` names it by; an intermediate class
 * that only inherits a registered parent's `typeId` is not that registration and is left out.
 *
 * @param registry - The app's component registry.
 * @param type - The described class.
 * @returns The ancestors' type ids, the class itself excluded; empty when none is registered.
 */
function registeredAncestors(registry: ComponentRegistry, type: ComponentType): readonly string[] {
  const ids: string[] = [];
  const ancestors = registry.describe(type).ancestors;
  for (let index = 1; index < ancestors.length; index += 1) {
    const ancestor = ancestors[index];
    if (ancestor !== undefined && registry.isRegistered(ancestor)) {
      ids.push(registry.requireTypeId(ancestor));
    }
  }
  return ids;
}
