import type { App, Disconnect, HotReloadReport } from "@ignifx/core";

/**
 * The devtools **consumer** of script hot reload (`docs/architecture/15-devtools-and-diagnostics.md`
 * §5). `@ignifx/core` owns `app.hotReload` — `packages/core/src/hot-reload/contract.ts` declares the
 * frozen shapes and `hot-reload-host.ts` implements them — and `@ignifx/vite-plugin` owns the HMR
 * client that calls `apply`. This file only listens and formats.
 *
 * `@ignifx/core` is a required peer, so the contract is imported as a type rather than duck-typed;
 * the runtime reads are still defensive, because a report is displayed and a display must never be
 * the thing that throws.
 */

/**
 * One hot-reload report, flattened into the two strings the Console and Stats panels show.
 *
 * @internal
 */
export interface HotReloadReportView {
  /** What was reloaded — the kind, plus the `typeId`s the report names. */
  readonly label: string;
  /** The instance count, the duration, and the failures. */
  readonly detail: string;
  /** Whether the report carried at least one error. */
  readonly failed: boolean;
}

/**
 * Describes whatever was thrown without relying on `Object.prototype.toString`.
 *
 * @param error - The failure.
 * @returns A one-line description.
 *
 * @internal
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error === null || typeof error !== "object") {
    return "unknown error";
  }
  try {
    // `JSON.stringify` of a plain object is a string; a cycle or a throwing `toJSON` is the catch.
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

/**
 * Flattens one `HotReloadReport` into the shape a panel renders.
 *
 * @param report - The report `app.hotReload.onApplied` emitted.
 * @returns The view; never throws, whatever the payload turns out to be.
 *
 * @internal
 */
export function describeHotReloadReport(report: HotReloadReport): HotReloadReportView {
  const names = report.typeIds.length === 0 ? "" : ` ${report.typeIds.join(", ")}`;
  const parts: string[] = [`${String(report.instances)} instance${report.instances === 1 ? "" : "s"}`];
  if (report.durationMs > 0) {
    parts.push(`${report.durationMs.toFixed(2)} ms`);
  }
  for (let index = 0; index < report.errors.length; index += 1) {
    parts.push(describeThrown(report.errors[index]));
  }
  return { label: `${report.kind}${names}`, detail: parts.join(" · "), failed: report.errors.length > 0 };
}

/**
 * The narrow view of `app.hotReload` devtools uses.
 *
 * @internal
 */
export interface HotReloadBridge {
  /** Whether the app has a hot-reload host at all. */
  readonly isAvailable: boolean;
  /**
   * Whether `app.hotReload` is already re-instantiating scene instances on its own. It is set with
   * `createApp({ hotReload: { reloadScenes: true } })` and is read-only afterwards, which is why
   * devtools has a toggle of its own — and why that toggle stands down when this is `true`.
   */
  readonly reloadScenes: boolean;
  /**
   * Subscribes to applied reports.
   *
   * @param handler - What to call with each report.
   * @returns The unsubscribe, or `null` when there is no host to subscribe to.
   */
  onApplied(handler: (report: HotReloadReportView) => void): Disconnect | null;
}

/**
 * Reads a property off an object-ish value.
 *
 * @param target - The value to read from.
 * @param key - The property name.
 * @returns The value, or `undefined`.
 */
function read(target: unknown, key: string): unknown {
  if (target === null || typeof target !== "object") {
    return undefined;
  }
  return Reflect.get(target, key);
}

/**
 * Builds the bridge to `app.hotReload`.
 *
 * @remarks
 * The host is read through `Reflect.get` rather than `app.hotReload` so that an app built against
 * an older `@ignifx/core` — one whose `App` has no `hotReload` — degrades to a bridge that reports
 * nothing instead of throwing at construction.
 *
 * @param app - The app to bridge to.
 * @returns The bridge.
 *
 * @internal
 */
export function createHotReloadBridge(app: App): HotReloadBridge {
  const host: unknown = Reflect.get(app, "hotReload");
  const available = host !== null && host !== undefined && typeof host === "object";
  return {
    isAvailable: available,
    get reloadScenes(): boolean {
      return read(host, "reloadScenes") === true;
    },
    onApplied(handler: (report: HotReloadReportView) => void): Disconnect | null {
      const signal = read(host, "onApplied");
      const connect = read(signal, "connect");
      if (typeof connect !== "function") {
        return null;
      }
      const forward = (report: HotReloadReport): void => {
        handler(describeHotReloadReport(report));
      };
      const disconnect: unknown = Reflect.apply(connect, signal, [forward]);
      return typeof disconnect === "function"
        ? (): void => {
            Reflect.apply(disconnect, signal, []);
          }
        : null;
    },
  };
}
