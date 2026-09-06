import { describe, expect, it, vi } from "vitest";
import { createHotReloadBridge, describeHotReloadReport, describeThrown } from "../src/hot-reload.js";
import { createDevtoolsApp } from "./support/app.js";
import type { App, HotReloadKind, HotReloadReport } from "@ignifx/core";

/**
 * The devtools **consumer** of script hot reload. `@ignifx/core` owns `app.hotReload`
 * (`packages/core/src/hot-reload/contract.ts`); these tests prove devtools reads the frozen shapes
 * and degrades to nothing on a core that has no host.
 */

/**
 * Builds a report of the shape the contract declares.
 *
 * @param overrides - What to change about it.
 * @returns The report.
 */
function report(overrides: Partial<HotReloadReport> = {}): HotReloadReport {
  return { kind: "patch", typeIds: [], instances: 0, durationMs: 0, errors: [], ...overrides };
}

/**
 * Replaces `app.hotReload` with a fake host.
 *
 * @param app - The app.
 * @param host - The host object.
 */
function installHost(app: App, host: unknown): void {
  Reflect.defineProperty(app, "hotReload", { value: host, configurable: true });
}

describe("describeThrown", () => {
  it("describes every shape a throw can take", () => {
    expect(describeThrown(new Error("boom"))).toBe("boom");
    expect(describeThrown("plain")).toBe("plain");
    expect(describeThrown(42)).toBe("42");
    expect(describeThrown(true)).toBe("true");
    expect(describeThrown(1n)).toBe("1");
    expect(describeThrown(undefined)).toBe("unknown error");
    expect(describeThrown(null)).toBe("unknown error");
    expect(describeThrown({ a: 1 })).toBe('{"a":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(describeThrown(cyclic)).toBe("unknown error");
  });
});

describe("describeHotReloadReport", () => {
  it("labels a report with its kind and the type ids it names", () => {
    expect(describeHotReloadReport(report()).label).toBe("patch");
    expect(describeHotReloadReport(report({ typeIds: ["game/Mover", "game/Gun"] })).label).toBe(
      "patch game/Mover, game/Gun",
    );
    const kinds: HotReloadKind[] = ["patch", "recreate", "scene"];
    for (const kind of kinds) {
      expect(describeHotReloadReport(report({ kind })).label).toContain(kind);
    }
  });

  it("folds the counts, the duration and the failures into one detail line", () => {
    expect(describeHotReloadReport(report({ instances: 1 })).detail).toBe("1 instance");
    expect(describeHotReloadReport(report({ instances: 3, durationMs: 1.5 })).detail).toBe("3 instances · 1.50 ms");

    const failed = describeHotReloadReport(report({ errors: [new Error("no schema")] }));
    expect(failed.failed).toBe(true);
    expect(failed.detail).toBe("0 instances · no schema");
  });
});

describe("createHotReloadBridge", () => {
  it("reads the host core installed on every app", async () => {
    const h = await createDevtoolsApp();
    const bridge = createHotReloadBridge(h.app);

    expect(bridge.isAvailable).toBe(true);
    expect(bridge.reloadScenes).toBe(false);
    h.dispose();
  });

  it("degrades to nothing on a core whose App has no hotReload", async () => {
    const h = await createDevtoolsApp();
    installHost(h.app, undefined);
    const bridge = createHotReloadBridge(h.app);

    expect(bridge.isAvailable).toBe(false);
    expect(bridge.reloadScenes).toBe(false);
    expect(bridge.onApplied(() => {})).toBeNull();
    h.dispose();
  });

  it("reports whether core is already re-instantiating scenes", async () => {
    const h = await createDevtoolsApp();
    installHost(h.app, { reloadScenes: true });

    expect(createHotReloadBridge(h.app).reloadScenes).toBe(true);
    h.dispose();
  });

  it("forwards applied reports and hands back a working unsubscribe", async () => {
    const h = await createDevtoolsApp();
    const seen: string[] = [];
    const stop = createHotReloadBridge(h.app).onApplied((view) => {
      seen.push(`${view.label}|${view.detail}`);
    });

    h.app.hotReload.apply([]);
    expect(seen).toEqual(["patch|0 instances"]);

    stop?.();
    h.app.hotReload.apply([]);
    expect(seen).toHaveLength(1);
    h.dispose();
  });

  it("tolerates a signal whose connect returns nothing to unsubscribe with", async () => {
    const h = await createDevtoolsApp();
    installHost(h.app, { onApplied: { connect: (): void => {} } });

    expect(createHotReloadBridge(h.app).onApplied(() => {})).toBeNull();
    h.dispose();
  });

  it("calls the real signal through Reflect rather than a captured method", async () => {
    const h = await createDevtoolsApp();
    const connect = vi.fn((): (() => void) => (): void => {});
    installHost(h.app, { onApplied: { connect } });
    createHotReloadBridge(h.app).onApplied(() => {});

    expect(connect).toHaveBeenCalledTimes(1);
    h.dispose();
  });
});
