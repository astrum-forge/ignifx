import { componentInternals } from "../component/internals.js";
import type { Script } from "../script/script.js";

/**
 * The `time.paused` filter the scheduler applies to `fixedUpdate`, `update`, and `lateUpdate`
 * (`docs/architecture/01-lifecycle-and-time.md` §2, §7): while the app is paused only scripts whose
 * class sets `static updateWhenPaused = true` keep receiving them.
 *
 * @remarks
 * The flag is resolved once per class, at registration, into `ScriptClassInfo.updateWhenPaused`;
 * this reads it back through the component's engine state, which is a symbol property access and no
 * lookup at all (coding standards §7).
 *
 * @param script - The script about to receive a callback.
 * @returns `true` when the script keeps updating while the app is paused.
 *
 * @internal
 */
export function updatesWhilePaused(script: Script): boolean {
  return componentInternals(script).info?.script?.updateWhenPaused ?? false;
}
