import type { TwoDService } from "./service/two-d-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
 */

declare module "@ignifx/core" {
  interface App {
    /**
     * The 2D service (`docs/architecture/11-2d-toolkit.md` §1): the pixels-per-unit conversion, the
     * active `Camera2D`, sprite picking, the sprite-layer diagnostics, and the Lite escape hatch.
     */
    readonly twoD: TwoDService;
  }
}

/**
 * Defines `app.twoD`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.twoD`.
 *
 * @internal
 */
export function defineTwoDAppProperty(ctx: ExtensionContext, service: TwoDService): void {
  ctx.defineAppProperty("twoD", (): unknown => service);
}
