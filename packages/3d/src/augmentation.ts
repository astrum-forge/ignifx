import type { NavigationService } from "./navigation/navigation-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
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
