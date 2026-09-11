import { app } from "electron";

/**
 * Append WebGPU switches before `app.whenReady`, when Chromium reads its command line.
 * The pinned Electron build needs `enable-unsafe-webgpu`; see ADR-0018 for validation.
 */

/**
 * The switch that turns WebGPU on in an Electron renderer.
 *
 * @public
 */
export const WEBGPU_SWITCH = "enable-unsafe-webgpu";

/**
 * The switch and value that point Chromium at Vulkan, needed on Linux where the default backend
 * has no WebGPU implementation.
 *
 * @remarks
 * **Documented, not verified.** This machine is macOS arm64; the Linux path is written from
 * Chromium's own flag list and is unverified in this repository until CI runs a Linux desktop job
 * with a display.
 *
 * @public
 */
export const LINUX_FEATURES_SWITCH: Readonly<{ readonly name: string; readonly value: string }> = Object.freeze({
  name: "enable-features",
  value: "Vulkan",
});

/**
 * The subset of `app.commandLine` {@link applyWebGpuSwitches} touches.
 *
 * @remarks
 * An interface rather than the Electron type, so the unit suite can record the calls without an
 * Electron process. `app.commandLine.appendSwitch` is `electron.d.ts` 7112.
 *
 * @public
 */
export interface CommandLineLike {
  /**
   * Appends a switch to Chromium's command line.
   *
   * @param the_switch - The switch name, without leading dashes.
   * @param value - The switch's value, when it takes one.
   */
  appendSwitch(the_switch: string, value?: string): void;
}

/**
 * Appends the switches a WebGPU game window needs. **Call before `app.whenReady()`.**
 *
 * @param commandLine - Where to append; defaults to the running app's command line.
 * @param platform - The platform to decide the Linux switch on; defaults to `process.platform`.
 * @returns The switches appended, as `name` or `name=value`, in order — so a test can assert them.
 *
 * @example
 * ```ts
 * import { app } from "electron";
 * import { applyWebGpuSwitches, registerIgnifxScheme } from "@ignifx/electron/main";
 *
 * applyWebGpuSwitches();
 * registerIgnifxScheme();
 * await app.whenReady();
 * ```
 *
 * @public
 */
export function applyWebGpuSwitches(
  commandLine: CommandLineLike = app.commandLine,
  platform: string = process.platform,
): readonly string[] {
  const applied: string[] = [WEBGPU_SWITCH];
  commandLine.appendSwitch(WEBGPU_SWITCH);
  if (platform === "linux") {
    commandLine.appendSwitch(LINUX_FEATURES_SWITCH.name, LINUX_FEATURES_SWITCH.value);
    applied.push(`${LINUX_FEATURES_SWITCH.name}=${LINUX_FEATURES_SWITCH.value}`);
  }
  return applied;
}
