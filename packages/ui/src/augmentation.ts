import type { UiHost } from "./dom/host.js";
import type { I18nService } from "./i18n/i18n-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry points (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.ui` and `this.app.i18n` fully typed when `@ignifx/ui` is
 * installed and a compile error when it is not.
 *
 * Two mechanics carry over from `@ignifx/input` and `@ignifx/2d`, both measured rather than assumed:
 *
 * - The module **must** import something from `@ignifx/core`. A `declare module "@ignifx/core"`
 *   block in a file that never imports the module is `TS2664: Invalid module name in augmentation`
 *   under both `tsc --build` and TypeDoc; importing the `ExtensionContext` type used below is
 *   enough to bring the module into the program.
 * - The barrel **must** name this module in a bare `import "./augmentation.js"`. Declaration
 *   bundling drops a module whose only exports are unreferenced from the public surface, which
 *   silently takes the augmentation out of `dist/index.d.ts` with it. The bare import is a
 *   type-only side effect: the emitted JavaScript keeps no statement for it, so `sideEffects: false`
 *   stays honest.
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
