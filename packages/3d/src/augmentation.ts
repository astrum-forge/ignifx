import type { NavigationService } from "./navigation/navigation-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry point (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.navigation` fully typed when `@ignifx/3d` is installed and a
 * compile error when it is not.
 *
 * Two mechanics carry over from `@ignifx/2d`, both measured rather than assumed:
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
     * Navigation (`docs/architecture/12-3d-toolkit.md` §5): path queries, the navmesh surfaces in
     * the world, and the lazily loaded Recast module behind both.
     */
    readonly navigation: NavigationService;
  }
}

/**
 * Defines `app.navigation`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.navigation`.
 *
 * @internal
 */
export function defineNavigationAppProperty(ctx: ExtensionContext, service: NavigationService): void {
  ctx.defineAppProperty("navigation", (): unknown => service);
}
