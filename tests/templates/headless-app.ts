import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import type {
  App,
  Component,
  ConcreteComponentType,
  Entity,
  Extension,
  FetchLike,
  SettingsInput,
  MemorySink,
  SceneInstance,
} from "@ignifx/core";

/**
 * What every template test needs to build a template's app headless the way its `main.ts` does:
 * the template's own `extensions()`, its `ignifx.config.ts`, every script under `src/scripts/`, and
 * assets read from its `assets/` directory. Only the renderer differs: there is no canvas, so Lite's
 * null engine runs and nothing is uploaded.
 */

/** Where a template lives on disk. */
export interface TemplatePaths {
  /** The template directory. */
  readonly templateDir: string;
  /** Its `src/` directory. */
  readonly sourceDir: string;
  /** Its asset root, which every address is relative to. */
  readonly assetDir: string;
}

/**
 * The directories of one template.
 *
 * @param name - The template's directory name under `templates/`.
 * @returns Its paths.
 */
export function templatePaths(name: string): TemplatePaths {
  const templateDir = fileURLToPath(new URL(`../../templates/${name}/`, import.meta.url));
  return { templateDir, sourceDir: join(templateDir, "src"), assetDir: join(templateDir, "assets") };
}

/**
 * A template's script classes: every export with a string `static typeId`, which is the rule
 * `@ignifx/vite-plugin` applies to `src/scripts/**`.
 *
 * @param modules - The modules under the template's `src/scripts/`, from an eager `import.meta.glob`.
 * @returns The classes, in module then export order.
 */
export function scriptClasses(modules: Readonly<Record<string, Record<string, unknown>>>): ConcreteComponentType[] {
  const found: ConcreteComponentType[] = [];
  for (const module of Object.values(modules)) {
    for (const value of Object.values(module)) {
      if (typeof value === "function" && typeof Reflect.get(value, "typeId") === "string") {
        // Boundary assertion (coding standards §5.2): a class with a static `typeId` under
        // `src/scripts/` is a component class, which is what the plugin's registry assumes too.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        found.push(value as ConcreteComponentType);
      }
    }
  }
  return found;
}

/**
 * Serves asset requests from a template's `assets/` directory.
 *
 * @param assetDir - The directory.
 * @returns A fetch that answers `assets/<address>` with the file's bytes, or a 404.
 */
function fetchFrom(assetDir: string): FetchLike {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const address = url.replace(/^.*?assets\//u, "");
    try {
      return new Response(await readFile(join(assetDir, address)));
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

/** What {@link createTemplateApp} needs. */
export interface TemplateAppOptions {
  /** The template's asset root. */
  readonly assetDir: string;
  /** The template's `ignifx.config.ts`. */
  readonly settings: SettingsInput;
  /** The template's `extensions()`. */
  readonly extensions: readonly Extension[];
  /** The template's script classes. */
  readonly scripts: readonly ConcreteComponentType[];
}

/** A headless app and the sink its log writes to. */
export interface TemplateApp {
  /** The app. */
  readonly app: App;
  /** Everything `app.log` wrote. */
  readonly sink: MemorySink;
}

/**
 * Creates a template's app headless and registers its scripts.
 *
 * @param options - The template's settings, extensions, scripts and asset root.
 * @returns The app and its log sink. The caller disposes the app.
 */
export async function createTemplateApp(options: TemplateAppOptions): Promise<TemplateApp> {
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: sink,
    settings: options.settings,
    fetch: fetchFrom(options.assetDir),
    extensions: [...options.extensions],
  });
  app.registerComponents([...options.scripts]);
  return { app, sink };
}

/**
 * A loaded scene's entities in tree order, the order its file lists them in.
 *
 * @param instance - The scene.
 * @returns Every entity, each followed by its descendants.
 */
export function entitiesInTreeOrder(instance: SceneInstance): Entity[] {
  const entities: Entity[] = [];
  const visit = (entity: Entity): void => {
    entities.push(entity);
    for (const child of entity.children) {
      visit(child);
    }
  };
  for (const root of instance.roots) {
    visit(root);
  }
  return entities;
}

/**
 * The one entity of a list with a given name.
 *
 * @param entities - Where to look.
 * @param name - The name.
 * @returns The entity.
 */
export function named(entities: readonly Entity[], name: string): Entity {
  const found = entities.find((entity) => entity.name === name);
  if (found === undefined) {
    throw new Error(`no entity named ${name}`);
  }
  return found;
}

/**
 * Reads a schema field off a component by name, as a scene file names it.
 *
 * @param entity - The entity.
 * @param typeId - The component's type id.
 * @param name - The field.
 * @returns The field's value.
 */
export function field(entity: Entity, typeId: string, name: string): unknown {
  const component = entity.components.find(
    (candidate: Component) => entity.world.registry.describe(candidate.constructor).typeId === typeId,
  );
  if (component === undefined) {
    throw new Error(`${entity.name} has no ${typeId}`);
  }
  return Reflect.get(component, name);
}
