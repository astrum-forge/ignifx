/**
 * The app's reports as the editor's Console reads them: log lines, `app.onError` reports and hot
 * reloads, made JSON. The scene view and the play view relay the same shapes.
 */

import { isIgnifxError, Phase } from "@ignifx/core";
import { HOST_LIST_MAX_LENGTH, HOST_TEXT_MAX_LENGTH } from "./protocol/index.js";
import type { AppErrorData, HostErrorParams, HotReloadedParams, LoggedError, LogParams } from "./protocol/index.js";
import type { App, Component, ErrorReport, HotReloadReport, LogRecord } from "@ignifx/core";

/** What ends a string {@link clipHostText} cut. */
export const CLIPPED_MARKER = "… [clipped]";

/**
 * Cuts a string to `HOST_TEXT_MAX_LENGTH`, the longest the editor accepts in a report: the editor
 * drops a whole report holding a longer one.
 *
 * @param text - The string.
 * @returns It unchanged when short enough, else its start and {@link CLIPPED_MARKER}, exactly
 * `HOST_TEXT_MAX_LENGTH` long or one shorter (a surrogate pair is never split).
 */
export function clipHostText(text: string): string {
  if (text.length <= HOST_TEXT_MAX_LENGTH) {
    return text;
  }
  let end = HOST_TEXT_MAX_LENGTH - CLIPPED_MARKER.length;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd8_00 && last <= 0xdb_ff) {
    end -= 1;
  }
  return `${text.slice(0, end)}${CLIPPED_MARKER}`;
}

/**
 * Like {@link clipHostText}, passing `null` through.
 *
 * @param text - The string, or `null`.
 * @returns The clipped string, or `null`.
 */
function clipHostTextOrNull(text: string | null): string | null {
  return text === null ? null : clipHostText(text);
}

/**
 * Keeps the first `HOST_LIST_MAX_LENGTH` items of a list, the most the editor accepts in a report.
 *
 * @param items - The list.
 * @returns It, or its start when longer.
 */
function clipHostList<T>(items: readonly T[]): readonly T[] {
  return items.length <= HOST_LIST_MAX_LENGTH ? items : items.slice(0, HOST_LIST_MAX_LENGTH);
}

/**
 * Names one of the engine's phases.
 *
 * @param phase - The phase's value.
 * @returns Its name in `Phase`, such as `"Update"`, or `null` for a value `Phase` does not have.
 */
function phaseName(phase: number): string | null {
  return Object.entries(Phase).find(([, value]) => value === phase)?.[0] ?? null;
}

/**
 * Reads a thrown value's message, clipped by {@link clipHostText}.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, or the value as a string when it is not an `Error`.
 */
export function messageOf(error: unknown): string {
  return clipHostText(error instanceof Error ? error.message : String(error));
}

/**
 * Reads a thrown value's stack, clipped by {@link clipHostText}.
 *
 * @param error - Whatever was thrown.
 * @returns Its `stack` when it is an `Error` with one, else `null`.
 */
function stackOf(error: unknown): string | null {
  return error instanceof Error && typeof error.stack === "string" && error.stack !== ""
    ? clipHostText(error.stack)
    : null;
}

/**
 * Reads a thrown value's `IGX-` code, clipped by {@link clipHostText}.
 *
 * @param error - Whatever was thrown.
 * @returns The code of an `IgnifxError`, else `null`.
 */
function codeOf(error: unknown): string | null {
  return isIgnifxError(error) ? clipHostText(error.code) : null;
}

/**
 * Names a component for the editor: its `typeId`, else its class name.
 *
 * @param component - The component.
 * @returns The name, clipped by {@link clipHostText}.
 */
function componentName(component: Component): string {
  const typeId: unknown = Reflect.get(component.constructor, "typeId");
  return clipHostText(typeof typeId === "string" && typeId !== "" ? typeId : component.constructor.name);
}

/**
 * Builds the parameters of `log` from one record.
 *
 * @param record - The record the app's logger wrote.
 * @returns The level, scope, message and time, and the first `Error` among the extras; each string
 * clipped by {@link clipHostText}.
 */
export function logParamsOf(record: LogRecord): LogParams {
  const params: LogParams = {
    level: record.level,
    scope: clipHostTextOrNull(record.scope),
    message: clipHostText(record.message),
    timeMs: record.timeMs,
  };
  const error = record.data.find((value): value is Error => value instanceof Error);
  if (error === undefined) {
    return params;
  }
  const logged: LoggedError = { message: messageOf(error), code: codeOf(error), stack: stackOf(error) };
  return { ...params, error: logged };
}

/**
 * Builds the parameters of `hostError` from one `app.onError` report.
 *
 * @param report - The report.
 * @returns The thrown error's code and message, and where it was caught; each string clipped by
 * {@link clipHostText}.
 */
export function hostErrorParamsOf(report: ErrorReport): HostErrorParams {
  const data: AppErrorData = {
    source: clipHostText(report.source),
    phase: report.phase,
    phaseName: report.phase === null ? null : phaseName(report.phase),
    entity: report.entity?.uid ?? null,
    entityName: clipHostTextOrNull(report.entity?.name ?? null),
    component: report.component === null ? null : componentName(report.component),
    stack: stackOf(report.error),
  };
  return { code: codeOf(report.error), message: messageOf(report.error), data: { ...data } };
}

/**
 * Builds the parameters of `hotReloaded` from one report.
 *
 * @param report - What `app.hotReload` did.
 * @returns The report, with its errors made JSON; each string clipped by {@link clipHostText} and
 * each list cut to `HOST_LIST_MAX_LENGTH` items.
 */
export function hotReloadedParamsOf(report: HotReloadReport): HotReloadedParams {
  return {
    report: {
      kind: report.kind,
      typeIds: clipHostList(report.typeIds).map((typeId) => clipHostText(typeId)),
      instances: report.instances,
      durationMs: report.durationMs,
      errors: clipHostList(report.errors).map((error) => ({
        message: messageOf(error),
        code: codeOf(error),
        stack: stackOf(error),
      })),
    },
  };
}

/** Where {@link relayAppReports} sends each report. */
export interface AppReportSink {
  /** Called with each log line. */
  readonly log: (params: LogParams) => void;
  /** Called with each `app.onError` report. */
  readonly error: (params: HostErrorParams) => void;
  /** Called with each hot reload. */
  readonly hotReloaded: (report: HotReloadReport) => void;
}

/**
 * Follows an app's log lines, error reports and hot reloads.
 *
 * @param app - The app.
 * @param sink - Where each one goes.
 * @returns A function that stops following.
 */
export function relayAppReports(app: App, sink: AppReportSink): () => void {
  const cleanups = [
    app.log.addSink({
      write: (record): void => {
        sink.log(logParamsOf(record));
      },
    }),
    app.onError.connect((report) => {
      sink.error(hostErrorParamsOf(report));
    }),
    app.hotReload.onApplied.connect((report) => {
      sink.hotReloaded(report);
    }),
  ];
  return (): void => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
