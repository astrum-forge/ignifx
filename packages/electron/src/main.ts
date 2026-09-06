/**
 * `@ignifx/electron/main` public barrel: the Electron main-process surface — the game window
 * factory that turns WebGPU on, the `ignifx://` protocol that serves packaged assets, the typed IPC
 * handlers behind the preload bridge, and the file-system store `app.storage` writes through
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * This entry imports `electron` and Node built-ins. A renderer bundle must never reach it; the
 * renderer's half of the package is the root export.
 *
 * The ordering the main process must follow is a property of Chromium's initialisation, not of this
 * package:
 *
 * ```ts
 * import { app } from "electron";
 * import { applyWebGpuSwitches, createGameWindow, installHostHandlers, registerIgnifxScheme,
 *   serveIgnifxProtocol } from "@ignifx/electron/main";
 *
 * applyWebGpuSwitches();   // before whenReady: a switch appended later is inert
 * registerIgnifxScheme();  // before whenReady: privileges are read while the net stack is built
 * await app.whenReady();
 * serveIgnifxProtocol(rendererDirectory);
 * const window = createGameWindow({ entry: "index.html", preload });
 * installHostHandlers({ window });
 * ```
 *
 * @packageDocumentation
 */

export {
  CSP_ASSET_SCHEMES,
  CSP_DIRECTIVE_ORDER,
  cspFor,
  defaultCsp,
  PACKAGED_ORIGIN,
  type CspOptions,
} from "./main/csp.js";
export {
  allowedSenderOrigins,
  installHostHandlers,
  isAllowedExternalUrl,
  isTrustedSender,
  openDialogOptionsFor,
  resolveHostPaths,
  type HostHandlerOptions,
  type SenderIdentity,
} from "./main/ipc.js";
export { originOfUrl } from "./main/origin.js";
export {
  IGNIFX_SCHEME_PRIVILEGES,
  mimeTypeFor,
  packagedEntryUrl,
  parseRangeHeader,
  PROTOCOL_COMMON_HEADERS,
  PROTOCOL_FALLBACK_MIME_TYPE,
  PROTOCOL_INDEX_FILE,
  PROTOCOL_MIME_TYPES,
  protocolPathFor,
  registerIgnifxScheme,
  respondToProtocolRequest,
  serveIgnifxProtocol,
  type ByteRange,
  type RangeDecision,
} from "./main/protocol.js";
export { BYTES_EXTENSION, FileStorage, isMissingFileError, isQuotaError, JSON_EXTENSION } from "./main/storage-fs.js";
export { decodeStorageFileName, encodeStorageFileName, storageDirectoryFor } from "./main/storage-names.js";
export { applyWebGpuSwitches, LINUX_FEATURES_SWITCH, WEBGPU_SWITCH, type CommandLineLike } from "./main/switches.js";
export {
  ALLOWED_PERMISSIONS,
  createGameWindow,
  cspValueFor,
  DEFAULT_EXTERNAL_PROTOCOLS,
  DEFAULT_WINDOW_SIZE,
  ENFORCED_WEB_PREFERENCES,
  FORWARDED_WINDOW_EVENTS,
  forwardWindowEvents,
  installCspHeader,
  isDevServerEntry,
  lockNavigation,
  restrictPermissions,
  windowOptionsFor,
  type GameWindowOptions,
} from "./main/window.js";
export {
  HOST_CHANNELS,
  HOST_CONTRACT_VERSION,
  HOST_WINDOW_EVENT_CHANNEL,
  IGNIFX_HOST_AUTHORITY,
  IGNIFX_ORIGIN,
  IGNIFX_SCHEME,
  QUOTA_MESSAGE_PREFIX,
  type HostOpenDialogOptions,
  type HostOpenDialogResult,
  type HostPaths,
  type HostStoredValue,
  type HostWindowEvent,
} from "./host-contract.js";
