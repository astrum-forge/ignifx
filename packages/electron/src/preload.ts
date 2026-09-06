/**
 * `@ignifx/electron/preload` public barrel: the typed, versioned bridge exposed to the renderer
 * through `contextBridge` as `window.ignifxHost` — storage, paths, window controls, dialogs, the
 * shell, and the contract version (`docs/architecture/14-platform-electron.md` §3).
 *
 * A desktop app's preload entry is two lines:
 *
 * ```ts
 * // desktop/preload.ts
 * import { exposeIgnifxHost } from "@ignifx/electron/preload";
 *
 * exposeIgnifxHost();
 * ```
 *
 * **That file has to be built to CommonJS.** A sandboxed preload script cannot be an ES module —
 * measured on Electron 44.2.0 / macOS arm64, an `.mjs` preload under `sandbox: true` left
 * `window.ignifxHost` undefined with no error anywhere — and `CONSTITUTION.md` §9.2 fixes
 * `sandbox: true`. The templates' `electron.vite.config.ts` builds the preload with
 * `format: "cjs"` and an `index.cjs` file name for exactly this reason.
 *
 * @packageDocumentation
 */

export { createIgnifxHost, exposeIgnifxHost, readHostVersions } from "./preload/bridge.js";
export {
  HOST_CHANNELS,
  HOST_CONTRACT_VERSION,
  HOST_GLOBAL_NAME,
  HOST_WINDOW_EVENT_CHANNEL,
  type HostDialogs,
  type HostFileFilter,
  type HostOpenDialogOptions,
  type HostOpenDialogResult,
  type HostPaths,
  type HostShell,
  type HostStorage,
  type HostStoredValue,
  type HostVersions,
  type HostWindow,
  type HostWindowEvent,
  type IgnifxHost,
} from "./host-contract.js";
