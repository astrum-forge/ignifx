import type { AudioService } from "./service/audio-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * The typed entry point (`docs/architecture/03-scripting-and-components.md` §7). Declaration
 * merging is what makes `this.app.audio` fully typed when `@ignifx/audio` is installed and a compile
 * error when it is not.
 *
 * Two mechanics, both of which `@ignifx/input` measured first:
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
     * The audio service (`docs/architecture/10-audio.md` §1): the mixer tree, the unlock state,
     * one-shots, and the listener.
     */
    readonly audio: AudioService;
  }
}

/**
 * Defines `app.audio`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.audio`.
 *
 * @internal
 */
export function defineAudioAppProperty(ctx: ExtensionContext, service: AudioService): void {
  ctx.defineAppProperty("audio", (): unknown => service);
}
