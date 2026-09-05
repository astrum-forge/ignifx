import { enableDeviceLostSceneRecovery, forceWebGpuDeviceLossForTesting } from "@babylonjs/lite";
import type { DeviceLostRecoveryCallbacks, DeviceLostRecoveryHandle, EngineContext } from "@babylonjs/lite";

/**
 * Device-loss recovery (`docs/architecture/07-rendering.md` §4). Enabling it reads the current
 * device's feature list immediately, so this module is GPU-only.
 *
 * Everything here is `@internal`.
 *
 * ## Why it must be enabled first (verified against `@babylonjs/lite@1.27.0`)
 *
 * `enableDeviceLostSceneRecovery(engine, callbacks)` (`index.d.ts` 4367) registers a recovery
 * strategy and calls `_retainDeviceLostRecoveryCapture(engine, true)`
 * (`lib/engine/device-lost-scene-recovery.js`). That capture is what stamps a *recovery source* —
 * the URL, bitmap, or pixel array a texture came from — onto every texture created **after** it is
 * installed (`lib/engine/device-lost-recovery-capture.js`). Resources created before it therefore
 * have no source to rebuild from, which is why `docs/architecture/07-rendering.md` §4 requires the
 * call before any resource exists, and why `createApp` makes it before the first scene is built.
 *
 * Two more facts from `lib/engine/device-lost-recovery.js`:
 *
 * - The very first registration snapshots `engine._device.features`, so the replacement device is
 *   requested with the same feature set.
 * - A `"destroyed"` loss is ignored unless {@link forceDeviceLossForTesting} armed it. That is what
 *   keeps `disposeEngine` from looking like a crash — and it is why forcing a loss without an
 *   enabled recovery strategy throws instead of silently doing nothing.
 */

/**
 * Enables best-effort recovery for every scene registered on an engine.
 *
 * @remarks
 * Call before creating any resource. Every kind of rendering context registered at loss time needs
 * its own strategy — the 2D and UI extensions enable the sprite and text ones — or recovery fails
 * rather than leave a context bound to the lost device.
 *
 * @param engine - The engine to protect.
 * @param callbacks - Fired on loss, on successful recovery, and on failure.
 * @returns A handle whose `disable()` removes this registration. Idempotent.
 *
 * @example
 * ```ts
 * const recovery = enableSceneDeviceLossRecovery(engine, {
 *   onLost: () => app.events.onDeviceLost.emit(),
 *   onRecovered: () => app.events.onDeviceRecovered.emit(),
 * });
 * ```
 *
 * @internal
 */
export function enableSceneDeviceLossRecovery(
  engine: EngineContext,
  callbacks: DeviceLostRecoveryCallbacks,
): DeviceLostRecoveryHandle {
  return enableDeviceLostSceneRecovery(engine, callbacks);
}

/**
 * Destroys the engine's device in a way that looks like a real loss, so recovery runs.
 *
 * @remarks
 * Test-only. It throws when no recovery strategy is enabled on the engine
 * (`lib/engine/device-lost-recovery-testing.js`).
 *
 * @param engine - The engine to break.
 *
 * @internal
 */
export function forceDeviceLossForTesting(engine: EngineContext): void {
  forceWebGpuDeviceLossForTesting(engine);
}
