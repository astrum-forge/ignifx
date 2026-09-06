import { electronError, ElectronErrorCode } from "../errors.js";
import { HOST_GLOBAL_NAME, isCompatibleHostVersion } from "../host-contract.js";
import type { IgnifxHost } from "../host-contract.js";

/**
 * Finding and validating the preload bridge from the renderer
 * (`docs/architecture/14-platform-electron.md` §3).
 *
 * Nothing here imports `electron`. The renderer half of this package runs inside a sandboxed,
 * context-isolated page that has no Node and no Electron module system at all; `window.ignifxHost`
 * is the entire interface, and treating it as untrusted data — checked member by member rather than
 * asserted — is what keeps a stale preload script from turning into a `TypeError` three frames into
 * a game.
 */

declare global {
  interface Window {
    /**
     * The bridge `@ignifx/electron/preload` exposes, present only in an Electron renderer whose
     * preload script called `exposeIgnifxHost()`.
     */
    readonly ignifxHost?: IgnifxHost;
  }
}

/**
 * The members {@link assertHostContract} requires, as `"path.name"` strings.
 *
 * @remarks
 * Checked by name rather than by counting: a bridge from a newer minor version has members this
 * build does not know about, and that is fine; a bridge missing one this build calls is not.
 *
 * @public
 */
export const REQUIRED_HOST_MEMBERS: readonly string[] = Object.freeze([
  "storage.get",
  "storage.set",
  "storage.delete",
  "storage.keys",
  "storage.clear",
  "paths",
  "window.setFullscreen",
  "window.isFullscreen",
  "window.setTitle",
  "window.quit",
  "window.onEvent",
  "dialogs.showOpenDialog",
  "shell.openExternal",
]);

/**
 * Narrows an unknown value to something whose string keys can be read.
 *
 * @param value - The value to test.
 * @returns `true` for any non-null object, arrays included.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a dotted member path off an object without asserting the object's type.
 *
 * @param root - The object to walk.
 * @param path - The dotted path, for example `"window.setTitle"`.
 * @returns The value found, or `undefined` when any step is missing.
 */
function memberAt(root: unknown, path: string): unknown {
  const steps = path.split(".");
  let current: unknown = root;
  for (let index = 0; index < steps.length; index += 1) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[steps[index] ?? ""];
  }
  return current;
}

/**
 * Finds the preload bridge on a global scope.
 *
 * @remarks
 * The absence of a bridge is not an error: the same renderer bundle runs in a browser tab, in a
 * headless Node test, and in an Electron window, and only the third has one. `electron()` logs one
 * debug line and stays inert in the other two.
 *
 * @param scope - The global to look on; defaults to `globalThis`. Tests pass a fake.
 * @returns The bridge, or `null` when there is none.
 *
 * @example
 * ```ts
 * const host = findIgnifxHost();
 * if (host === null) {
 *   // a browser build
 * }
 * ```
 *
 * @public
 */
export function findIgnifxHost(scope: unknown = globalThis): IgnifxHost | null {
  if (!isRecord(scope)) {
    return null;
  }
  const candidate: unknown = scope[HOST_GLOBAL_NAME];
  if (!isRecord(candidate)) {
    return null;
  }
  // The shape is checked member by member by `assertHostContract`, which every caller runs next;
  // this assertion only names what the object is claimed to be.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by assertHostContract.
  return candidate as unknown as IgnifxHost;
}

/**
 * Checks that a bridge is one this build can talk to.
 *
 * @remarks
 * Two checks, and they fail differently on purpose. A **major** version mismatch (`IGX-1460`) means
 * the preload script and the renderer bundle came from different installs — a partially applied
 * update, a stale `asar` — and the message says so. A **missing member** (`IGX-1461`) means the
 * bridge is the right generation but incomplete, which is what a hand-written preload script that
 * forgot `exposeIgnifxHost()` and rolled its own looks like.
 *
 * @param host - The bridge found on the window.
 * @throws An `IgnifxError` with code `IGX-1460` when the major versions differ, or `IGX-1461` when a
 * member this build calls is absent.
 *
 * @example
 * ```ts
 * const host = findIgnifxHost();
 * if (host !== null) {
 *   assertHostContract(host);
 * }
 * ```
 *
 * @public
 */
export function assertHostContract(host: IgnifxHost): void {
  const version = typeof host.version === "string" ? host.version : "";
  if (!isCompatibleHostVersion(version)) {
    throw electronError(
      ElectronErrorCode.hostVersionMismatch,
      `The preload bridge announces version "${version}", which this build of @ignifx/electron cannot talk to.`,
      {
        context: { host: version },
        hint: "Rebuild the desktop app so its preload script and its renderer bundle come from one install.",
      },
    );
  }
  for (let index = 0; index < REQUIRED_HOST_MEMBERS.length; index += 1) {
    const path = REQUIRED_HOST_MEMBERS[index] ?? "";
    if (typeof memberAt(host, path) !== "function") {
      throw electronError(ElectronErrorCode.hostContractIncomplete, `The preload bridge is missing ${path}().`, {
        context: { member: path },
        hint: "Call exposeIgnifxHost() from @ignifx/electron/preload in the app's preload script.",
      });
    }
  }
}

/**
 * Turns a rejection that came back over IPC into an `IgnifxError` naming the channel.
 *
 * @remarks
 * Electron flattens an error thrown inside `ipcMain.handle` to its message by the time it reaches
 * the renderer, so nothing but the text survives. Wrapping it keeps the original as `cause` and
 * gives the failure a code a game can branch on.
 *
 * @param channel - The bridge member that failed, for example `"storage.set"`.
 * @param error - What the invoke rejected with.
 * @returns The error to reject with.
 *
 * @public
 */
export function hostCallError(channel: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return electronError(ElectronErrorCode.hostCallFailed, `The main process refused ${channel}: ${detail}`, {
    context: { channel },
    cause: error,
  });
}
