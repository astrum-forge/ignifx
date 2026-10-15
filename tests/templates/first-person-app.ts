import settings from "../../templates/3d-first-person/ignifx.config.js";
import { extensions } from "../../templates/3d-first-person/src/extensions.js";
import { publishLevelMeshes } from "../../templates/3d-first-person/src/level-meshes.js";
import { createTemplateApp, scriptClasses, templatePaths } from "./headless-app.js";
import type { TemplateApp } from "./headless-app.js";

/**
 * A headless `3d-first-person` app, built the way the template's `main.ts` builds one: the
 * template's own `extensions()`, its `ignifx.config.ts`, every script under `src/scripts/`, and the
 * level's primitive meshes published before any scene loads.
 */

/** The template's directories. */
export const FIRST_PERSON = templatePaths("3d-first-person");

/** Every module under the template's `src/scripts/`, the set `virtual:ignifx/scripts` registers. */
const SCRIPT_MODULES = import.meta.glob<Record<string, unknown>>("../../templates/3d-first-person/src/scripts/*.ts", {
  eager: true,
});

/**
 * Creates the headless app and publishes the level meshes, so `app.world.loadScene` can be called
 * next — the same two steps `main.ts` takes before it loads the level.
 *
 * @returns The app and its log sink. The caller disposes the app.
 */
export async function createFirstPersonApp(): Promise<TemplateApp> {
  const created = await createTemplateApp({
    assetDir: FIRST_PERSON.assetDir,
    settings,
    extensions: extensions(),
    scripts: scriptClasses(SCRIPT_MODULES),
  });
  publishLevelMeshes(created.app);
  return created;
}
