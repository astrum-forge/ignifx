import { button, element, setText, textInput } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { DEVTOOLS_LOG_LEVELS } from "../log-sink.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";
import type { LogLevel, LogRecord, LogThreshold } from "@ignifx/core";

/**
 * Group errors, reload reports, and log records rather than sorting them across incompatible clocks.
 * The extension attaches a log sink at registration; games may supply a shared sink.
 */

/** How many lines the panel renders. More than a screenful; the sink keeps the rest. */
const MAX_LINES = 200;

/**
 * Formats one log record as a single line.
 *
 * @param record - The record.
 * @returns The line.
 */
function formatRecord(record: LogRecord): string {
  const scope = record.scope === null ? "" : ` ${record.scope}`;
  return `[${record.level}]${scope} ${record.message}`;
}

/**
 * Builds the Console panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createConsolePanel(): DevtoolsPanel {
  const lines: HTMLElement[] = [];
  const records: LogRecord[] = [];
  let level: LogThreshold = "debug";
  let search = "";
  let list: HTMLElement | null = null;
  let host: DevtoolsPanelHost | null = null;

  /**
   * Returns the pooled line at an index, creating it the first time.
   *
   * @param at - The pool slot.
   * @returns The element.
   */
  function lineAt(at: number): HTMLElement {
    const existing = lines[at];
    if (existing !== undefined) {
      return existing;
    }
    const owner = host;
    const parent = list;
    if (owner === null || parent === null) {
      throw new TypeError("The console panel was refreshed before it was mounted.");
    }
    const node = element(owner.document, "div", DEVTOOLS_CLASS_NAMES.line);
    parent.append(node);
    lines.push(node);
    return node;
  }

  /**
   * Reports whether a line passes the search box.
   *
   * @param text - The line.
   * @returns `true` when it matches.
   */
  function matches(text: string): boolean {
    return search === "" || text.toLowerCase().includes(search.toLowerCase());
  }

  return {
    name: "console",
    title: "Console",
    perFrame: false,

    mount(root: HTMLElement, panelHost: DevtoolsPanelHost): void {
      host = panelHost;
      const bar = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      const select = element(panelHost.document, "select", DEVTOOLS_CLASS_NAMES.input);
      for (let index = 0; index < DEVTOOLS_LOG_LEVELS.length; index += 1) {
        const value = DEVTOOLS_LOG_LEVELS[index] ?? "debug";
        const option = element(panelHost.document, "option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.value = level;
      select.addEventListener("change", (): void => {
        level = DEVTOOLS_LOG_LEVELS.find((candidate: LogLevel): boolean => candidate === select.value) ?? "debug";
      });
      bar.append(
        select,
        textInput(panelHost.document, "search", (value: string): void => {
          search = value;
        }),
        button(panelHost.document, "clear", (): void => {
          panelHost.logSink?.clear();
        }),
      );
      const body = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.panel);
      root.append(bar, body);
      list = body;
    },

    update(panelHost: DevtoolsPanelHost): void {
      if (list === null) {
        return;
      }
      host = panelHost;
      let used = 0;
      for (let index = panelHost.errors.length - 1; index >= 0 && used < MAX_LINES; index -= 1) {
        const entry = panelHost.errors[index];
        if (entry === undefined) {
          continue;
        }
        const text = `[error] ${entry.report.source} · ${entry.message}`;
        if (!matches(text)) {
          continue;
        }
        setText(lineAt(used), text);
        used += 1;
      }
      for (let index = panelHost.hotReloads.length - 1; index >= 0 && used < MAX_LINES; index -= 1) {
        const entry = panelHost.hotReloads[index];
        if (entry === undefined) {
          continue;
        }
        const text = `[${entry.failed ? "error" : "info"}] hot-reload ${entry.label} ${entry.detail}`;
        if (!matches(text)) {
          continue;
        }
        setText(lineAt(used), text);
        used += 1;
      }
      const sink = panelHost.logSink;
      if (sink === null) {
        if (used < MAX_LINES) {
          setText(lineAt(used), "No log sink: pass createDevtoolsLogSink() to createApp and devtools().");
          used += 1;
        }
      } else {
        sink.query(level, search, records, MAX_LINES - used);
        for (let index = 0; index < records.length && used < MAX_LINES; index += 1) {
          const record = records[index];
          if (record !== undefined) {
            setText(lineAt(used), formatRecord(record));
            used += 1;
          }
        }
      }
      for (let index = 0; index < lines.length; index += 1) {
        lines[index]?.style.setProperty("display", index < used ? "block" : "none");
      }
    },

    dispose(): void {
      lines.length = 0;
      records.length = 0;
      list = null;
      host = null;
    },
  };
}
