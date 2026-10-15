import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import settings from "../../templates/3d-third-person/ignifx.config.js";
import { extensions } from "../../templates/3d-third-person/src/extensions.js";
import type { App, ConcreteComponentType, FetchLike, MemorySink } from "@ignifx/core";

/**
 * A headless `3d-third-person` app, built the way the template's `main.ts` and the ignifx editor's
 * scene view (`@ignifx/editor-host`) build one: the template's own `extensions()`, its
 * `ignifx.config.ts` and every script under `src/scripts/`, and nothing else before a scene loads.
 * Only the renderer differs: there is no canvas, so Lite's null engine runs and nothing is uploaded.
 */

/** The template directory. */
export const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/3d-third-person/", import.meta.url));

/** The template's asset root, which every address is relative to. */
export const ASSET_DIR = fileURLToPath(new URL("../../templates/3d-third-person/assets/", import.meta.url));

/** Every module under the template's `src/scripts/`, the set `virtual:ignifx/scripts` registers. */
const SCRIPT_MODULES = import.meta.glob<Record<string, unknown>>("../../templates/3d-third-person/src/scripts/*.ts", {
  eager: true,
});

/** A started-or-not headless app and the sink its log writes to. */
export interface ThirdPersonApp {
  /** The app. */
  readonly app: App;
  /** Everything `app.log` wrote. */
  readonly sink: MemorySink;
}

/**
 * The template's script classes: every export with a string `static typeId`, which is the rule
 * `@ignifx/vite-plugin` applies to `src/scripts/**`.
 *
 * @returns The classes, in module then export order.
 */
export function templateScripts(): ConcreteComponentType[] {
  const found: ConcreteComponentType[] = [];
  for (const module of Object.values(SCRIPT_MODULES)) {
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
 * Serves asset requests from the template's `assets/` directory.
 *
 * @param input - The URL the asset service asks for, `assets/<address>`.
 * @returns The file's bytes, or a 404.
 */
const fetchFromDisk: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const address = url.replace(/^.*?assets\//u, "");
  try {
    return new Response(await readFile(join(ASSET_DIR, address)));
  } catch {
    return new Response(null, { status: 404 });
  }
};

/**
 * Creates the headless app, so `app.world.loadScene` can be called next. It runs no game code: the
 * level's primitive meshes are `assets/meshes/*.mesh.json` files the scene names, not something
 * published first.
 *
 * @returns The app and its log sink. The caller disposes the app.
 */
export async function createThirdPersonApp(): Promise<ThirdPersonApp> {
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: sink,
    settings,
    fetch: fetchFromDisk,
    extensions: extensions(),
  });
  app.registerComponents(templateScripts());
  return { app, sink };
}
