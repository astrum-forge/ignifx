import { describeSchema } from "./describe.js";
import type { SchemaDescription, SchemaDescriptionMeta } from "./describe.js";
import type { ComponentRegistry } from "../component/component-registry.js";

/**
 * The package a registered component belongs to: the extension that registered it, or else the
 * namespace of its type id.
 *
 * @param registry - The registry the component is registered in.
 * @param typeId - The component's type id.
 * @returns The extension's `name` (`@ignifx/3d`), or everything before the type id's last `/`
 * (`mygame` for `mygame/Mover`) when no extension registered it.
 *
 * @internal
 */
function componentPackage(registry: ComponentRegistry, typeId: string): string {
  return registry.registrarOf(typeId) ?? typeId.slice(0, Math.max(0, typeId.lastIndexOf("/")));
}

/**
 * Describes every component an app has registered, the engine's, its extensions' and the game's,
 * the way {@link describeSchema} describes one, plus what only the registry knows: whether an
 * entity may hold more than one (`allowMultiple`) and which package registered it (`package`).
 * This is what an external inspector, such as the ignifx editor, is generated from.
 *
 * @remarks
 * `package` is the `name` of the extension whose `register(ctx)` registered the class, which is the
 * npm package name for a published extension (`@ignifx/core`, `@ignifx/3d`). A class the game
 * registered itself with `app.registerComponents` has no extension, so its `package` is its type
 * id's namespace: everything before the last `/` (`third-person` for `third-person/Beacon`).
 *
 * @param registry - The registry to walk, usually `app.world.registry`.
 * @param curated - Titles, formats and summaries by type id, for example a package's own
 * `describeSchemas()`; a component without an entry is titled from its type id.
 * @returns The descriptions, keyed by type id, in registration order.
 *
 * @example
 * ```ts
 * const schemas = describeRegisteredSchemas(app.world.registry, describeSchemas());
 * schemas["ignifx/Camera"]?.package; // "@ignifx/core"
 * schemas["ignifx/Camera"]?.allowMultiple; // false
 * ```
 *
 * @public
 */
export function describeRegisteredSchemas(
  registry: ComponentRegistry,
  curated?: Readonly<Record<string, SchemaDescriptionMeta>>,
): Readonly<Record<string, SchemaDescription>> {
  const described: Record<string, SchemaDescription> = {};
  for (const [typeId, type] of registry.registrations()) {
    const info = registry.describe(type);
    const meta = curated?.[typeId];
    described[typeId] = describeSchema(typeId, info.schema ?? {}, {
      ...(meta?.title === undefined ? {} : { title: meta.title }),
      ...(meta?.format === undefined ? {} : { format: meta.format }),
      ...(meta?.description === undefined ? {} : { description: meta.description }),
      allowMultiple: info.allowMultiple,
      package: componentPackage(registry, typeId),
    });
  }
  return described;
}
