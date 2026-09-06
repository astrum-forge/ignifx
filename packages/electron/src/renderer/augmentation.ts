import type { Desktop } from "./desktop.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry point (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.desktop` fully typed when `@ignifx/electron` is installed and a
 * compile error when it is not.
 *
 * Two mechanics, both measured rather than assumed, and both the same as `@ignifx/input`'s:
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
