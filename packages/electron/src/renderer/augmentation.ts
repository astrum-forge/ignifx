import type { Desktop } from "./desktop.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import so declaration bundling retains these types.
 * The augmentation emits no runtime registration.
 */

declare module "@ignifx/core" {
  interface App {
    /**
     * The desktop service (`docs/architecture/14-platform-electron.md` §3): full screen, the window
     * title, quitting, the open dialog, external links, and the host window's lifecycle events.
     *
     * @remarks
     * Always defined once `electron()` is registered. In a browser build every method rejects with
     * `IGX-1462` and `isElectron` is `false`.
     */
    readonly desktop: Desktop;
  }
}

/**
 * Defines `app.desktop`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param desktop - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.desktop`.
 *
 * @internal
 */
export function defineDesktopAppProperty(ctx: ExtensionContext, desktop: Desktop): void {
  ctx.defineAppProperty("desktop", (): unknown => desktop);
}
