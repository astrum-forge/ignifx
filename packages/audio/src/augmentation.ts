import type { AudioService } from "./service/audio-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
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
