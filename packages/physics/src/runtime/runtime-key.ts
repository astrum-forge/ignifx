import { createServiceKey } from "@ignifx/core";
import type { PhysicsHost } from "./host.js";
import type { ServiceNameKey } from "@ignifx/core";

/**
 * The key the extension registers its runtime holder under, so that `Rigidbody`, the colliders, and
 * `CharacterController` can reach the runtime from `this.app.services` without a module-level
 * singleton (`CONSTITUTION.md` §3.6: no globals, two apps in one process).
 *
 * The **holder** is registered rather than the runtime itself, because everything an extension
 * contributes is declared in `register` (`docs/architecture/04-extensions.md` §1) and the runtime
 * does not exist until `onStart`.
 *
 * @internal
 */
export const PhysicsHostKey: ServiceNameKey<PhysicsHost> = createServiceKey<PhysicsHost>("@ignifx/physics:host");
