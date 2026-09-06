/**
 * `@ignifx/electron` public barrel: the renderer half — the `electron()` extension, `app.desktop`,
 * the file-system storage backend, and the typed host contract both processes share
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * This entry imports no `electron` and no Node built-in, so a browser build can bundle it: a game
 * that registers `electron()` and is opened in a browser tab finds no bridge, logs one debug line,
 * and gets an `app.desktop` that reports `isElectron === false`. The main-process and preload halves
 * live behind the `@ignifx/electron/main` and `@ignifx/electron/preload` subpaths, which a renderer
 * bundle must never import.
 *
 * @packageDocumentation
 */

// Type-only side effect: brings the `App.desktop` declaration merge into `dist/index.d.ts`.
// Declaration bundling drops a module nothing references, and the augmentation would go with it.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./renderer/augmentation.js";

export { ELECTRON_ERROR_MESSAGES, electronError, ElectronErrorCode, type ElectronErrorOptions } from "./errors.js";
export {
  HOST_CHANNELS,
  HOST_CONTRACT_MAJOR,
  HOST_CONTRACT_VERSION,
  HOST_GLOBAL_NAME,
  HOST_WINDOW_EVENT_CHANNEL,
  IGNIFX_HOST_AUTHORITY,
  IGNIFX_ORIGIN,
  IGNIFX_SCHEME,
  isCompatibleHostVersion,
  QUOTA_MESSAGE_PREFIX,
  type HostChannel,
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
export { HostDesktop, UnavailableDesktop, type Desktop } from "./renderer/desktop.js";
export { electron, type ElectronOptions } from "./renderer/extension.js";
export { assertHostContract, findIgnifxHost, hostCallError, REQUIRED_HOST_MEMBERS } from "./renderer/host.js";
export {
  ELECTRON_STORAGE_BACKEND_NAME,
  ElectronStorageBackend,
  STORAGE_BACKEND_FAILED_CODE,
  STORAGE_QUOTA_CODE,
  STORAGE_VALUE_CORRUPT_CODE,
} from "./renderer/storage-backend.js";
export { VERSION } from "./version.js";
