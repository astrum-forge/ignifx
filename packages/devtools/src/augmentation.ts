import type { DevtoolsService } from "./service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry point (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.devtools` fully typed when `@ignifx/devtools` is installed and a
 * compile error when it is not.
 *
 * Two mechanics carry over from `@ignifx/ui`, both measured rather than assumed:
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
     * The devtools overlay (`docs/architecture/15-devtools-and-diagnostics.md` §4): open and close,
     * the nine panels, and the inspector's selection.
     */
    readonly devtools: DevtoolsService;
  }
}

/**
 * Defines `app.devtools`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.devtools`.
 *
 * @internal
 */
export function defineDevtoolsAppProperty(ctx: ExtensionContext, service: DevtoolsService): void {
  ctx.defineAppProperty("devtools", (): unknown => service);
}
