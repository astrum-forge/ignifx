import type { App, Component, ConcreteComponentType } from "@ignifx/core";

/**
 * The class of a project script, looked up by its `typeId` in the registry `main.ts` filled from
 * `virtual:ignifx/scripts`.
 *
 * Code outside `src/scripts/` reaches a script this way rather than by importing its module. An
 * import from `main.ts`, or from anything `main.ts` imports, would make that module part of the
 * entry's graph, and an edit to the script would then reload the page instead of hot-patching the
 * class. `import type` is fine: it is erased before the dev server sees the file.
 *
 * @typeParam T - The script's instance type, named with an `import type`.
 * @param app - The app the scripts were registered with.
 * @param typeId - The script's `static typeId`.
 * @returns The registered class.
 * @throws Error when nothing is registered under `typeId`.
 */
export function scriptType<T extends Component>(app: App, typeId: string): ConcreteComponentType<T> {
  const type = app.world.registry.get(typeId);
  if (type === null) {
    throw new Error(`No script is registered as ${typeId}; is its class exported from a file under src/scripts/?`);
  }
  // Boundary assertion (coding standards §5.2): the registry holds classes by id, and the caller
  // names the class that owns the id.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return type as unknown as ConcreteComponentType<T>;
}
