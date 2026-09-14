import type { UiHost } from "./dom/host.js";
import type { I18nService } from "./i18n/i18n-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
 */

declare module "@ignifx/core" {
  interface App {
    /**
     * The DOM overlay host (`docs/architecture/13-ui.md` §1): the root over the canvas, the named
     * layers, the scaling modes, the safe-area variables, and the focus flag.
     */
    readonly ui: UiHost;
    /**
     * The localization service (`docs/architecture/13-ui.md` §3): `.i18n.json` documents,
     * `{name}` interpolation, ICU-style plurals, and the active locale.
     */
    readonly i18n: I18nService;
  }
}

/**
 * Defines `app.ui`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param host - The host the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.ui`.
 *
 * @internal
 */
export function defineUiAppProperty(ctx: ExtensionContext, host: UiHost): void {
  ctx.defineAppProperty("ui", (): unknown => host);
}

/**
 * Defines `app.i18n`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.i18n`.
 *
 * @internal
 */
export function defineI18nAppProperty(ctx: ExtensionContext, service: I18nService): void {
  ctx.defineAppProperty("i18n", (): unknown => service);
}
