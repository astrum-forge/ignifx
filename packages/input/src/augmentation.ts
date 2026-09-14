import type { InputService } from "./service/input-service.js";
import type { ExtensionContext } from "@ignifx/core";

/**
 * Import core before augmenting it so TypeScript resolves the target module.
 * Keep the barrel's bare augmentation import: declaration bundling otherwise drops these types.
 * The augmentation emits no runtime registration (docs/architecture/03-scripting-and-components.md §7).
 */

declare module "@ignifx/core" {
  interface App {
    /**
     * The input service (`docs/architecture/08-input.md` §1): devices, action maps, control
     * schemes, pointer lock, the cursor, and the frame's raw event stream.
     */
    readonly input: InputService;
  }
}

/**
 * Defines `app.input`, pairing with the augmentation above.
 *
 * @param ctx - The extension registration surface.
 * @param service - The service the property returns.
 * @throws IgnifxError with code `IGX-0401` when something already defined `app.input`.
 *
 * @internal
 */
export function defineInputAppProperty(ctx: ExtensionContext, service: InputService): void {
  ctx.defineAppProperty("input", (): unknown => service);
}
