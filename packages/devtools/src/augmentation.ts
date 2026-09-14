import type { DevtoolsService } from "./service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
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
