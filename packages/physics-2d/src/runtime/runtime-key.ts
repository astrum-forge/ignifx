import { createServiceKey } from "@ignifx/core";
import type { Physics2DHost } from "./host.js";
import type { ServiceNameKey } from "@ignifx/core";

/**
 * The key the extension registers its runtime holder under, so that `Rigidbody2D`, the 2D
 * colliders, and `CharacterController2D` can reach the runtime through `this.app.services` without
 * a module-level singleton (`CONSTITUTION.md` §3.6: no globals, two apps in one process).
 *
 * The **holder** is registered rather than the runtime itself, because everything an extension
 * contributes is declared in `register` (`docs/architecture/04-extensions.md` §1) and the runtime
 * does not exist until `onStart`.
 *
 * @internal
 */
export const Physics2DHostKey: ServiceNameKey<Physics2DHost> =
  createServiceKey<Physics2DHost>("@ignifx/physics-2d:host");
