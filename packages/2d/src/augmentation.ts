import type { TwoDService } from "./service/two-d-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry point (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.twoD` fully typed when `@ignifx/2d` is installed and a compile
 * error when it is not.
 *
 * Two mechanics carry over from `@ignifx/input`, both measured rather than assumed:
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
