import { createLogger, createMemorySink } from "@ignifx/core";
import { UiHost } from "../../src/dom/host.js";
import { defaultUiSettings } from "../../src/settings.js";
import { createFakeDom } from "./fake-dom.js";
import type { FakeDom, FakeDomOptions } from "./fake-dom.js";
import type { UiDomTarget } from "../../src/dom/dom-target.js";
import type { UiSettings } from "../../src/settings.js";
import type { MemorySink } from "@ignifx/core";

/**
 * Builds a `UiHost` over the fake DOM, for the node suites.
 *
 * The single `as unknown as UiDomTarget` here is the whole cost of writing `src/dom/**` against the
 * real DOM types: it happens once, in a test helper, rather than at every call site.
 */

/** What {@link createTestHost} returns. */
export interface TestHost {
  /** The host under test. */
  readonly host: UiHost;
  /** The fake DOM it was built over. */
  readonly dom: FakeDom;
  /** Everything the host logged. */
  readonly log: MemorySink;
  /** Every value written to the input focus flag, in order. */
  readonly focusWrites: boolean[];
  /** Every value written to the input pointer flag, in order. */
  readonly pointerWrites: boolean[];
}

/** What {@link createTestHost} accepts. */
export interface TestHostOptions extends FakeDomOptions {
  /** Overrides for the resolved `ui` settings section. */
  readonly settings?: Partial<UiSettings>;
  /** Build the host with no DOM at all, as a headless app does. */
  readonly headless?: boolean;
}

/**
 * Builds a host over a fresh fake DOM.
 *
 * @param options - The canvas sizes, the settings overrides, and whether to go headless.
 * @returns The host, the DOM, the log, and the focus writes.
 */
export function createTestHost(options: TestHostOptions = {}): TestHost {
  const dom = createFakeDom(options);
  const log = createMemorySink();
  const focusWrites: boolean[] = [];
  const pointerWrites: boolean[] = [];
  const settings: UiSettings = { ...defaultUiSettings(), ...options.settings };
  const host = new UiHost({
    resolveTarget: (): UiDomTarget | null => (options.headless === true ? null : (dom as unknown as UiDomTarget)),
    settings,
    log: createLogger({ sink: log, level: "debug" }),
    setInputFocus: (value: boolean): void => {
      focusWrites.push(value);
    },
    setInputPointer: (value: boolean): void => {
      pointerWrites.push(value);
    },
  });
  host.mount();
  return { host, dom, log, focusWrites, pointerWrites };
}
