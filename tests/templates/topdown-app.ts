import settings from "../../templates/2d-topdown/ignifx.config.js";
import { extensions } from "../../templates/2d-topdown/src/extensions.js";
import { createTemplateApp, scriptClasses, templatePaths } from "./headless-app.js";
import type { TemplateApp } from "./headless-app.js";

/**
 * A headless `2d-topdown` app, built the way the template's `main.ts` builds one: the template's own
 * `extensions()`, its `ignifx.config.ts` and every script under `src/scripts/`.
 */

/** The template's directories. */
export const TOPDOWN = templatePaths("2d-topdown");

/** Every module under the template's `src/scripts/`, the set `virtual:ignifx/scripts` registers. */
const SCRIPT_MODULES = import.meta.glob<Record<string, unknown>>("../../templates/2d-topdown/src/scripts/*.ts", {
  eager: true,
});

/**
 * Creates the headless app, so `app.world.loadScene` can be called next.
 *
 * @returns The app and its log sink. The caller disposes the app.
 */
export async function createTopdownApp(): Promise<TemplateApp> {
  return createTemplateApp({
    assetDir: TOPDOWN.assetDir,
    settings,
    extensions: extensions(),
    scripts: scriptClasses(SCRIPT_MODULES),
  });
}
