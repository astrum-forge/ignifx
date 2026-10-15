import settings from "../../templates/3d-third-person/ignifx.config.js";
import { extensions } from "../../templates/3d-third-person/src/extensions.js";
import { createTemplateApp, scriptClasses, templatePaths } from "./headless-app.js";
import type { TemplateApp } from "./headless-app.js";

/**
 * A headless `3d-third-person` app, built the way the template's `main.ts` and the ignifx editor's
 * scene view (`@ignifx/editor-host`) build one: the template's own `extensions()`, its
 * `ignifx.config.ts` and every script under `src/scripts/`, and nothing else before a scene loads.
 */

/** The template's directories. */
export const THIRD_PERSON = templatePaths("3d-third-person");

/** Every module under the template's `src/scripts/`, the set `virtual:ignifx/scripts` registers. */
const SCRIPT_MODULES = import.meta.glob<Record<string, unknown>>("../../templates/3d-third-person/src/scripts/*.ts", {
  eager: true,
});

/**
 * Creates the headless app, so `app.world.loadScene` can be called next.
 *
 * @returns The app and its log sink. The caller disposes the app.
 */
export async function createThirdPersonApp(): Promise<TemplateApp> {
  return createTemplateApp({
    assetDir: THIRD_PERSON.assetDir,
    settings,
    extensions: extensions(),
    scripts: scriptClasses(SCRIPT_MODULES),
  });
}
