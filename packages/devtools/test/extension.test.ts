import { describe, expect, it } from "vitest";
import { devtools } from "../src/extension.js";
import { createDevtoolsLogSink } from "../src/log-sink.js";
import { DevtoolsService } from "../src/service.js";
import { createDevtoolsApp } from "./support/app.js";
import type { App, LogRecord } from "@ignifx/core";

/**
 * What `devtools()` contributes, and what a headless app gets: the extension-level half of the
 * package, driven through a real `createApp` rather than through the fake DOM.
 */

/**
 * Reads `app.devtools` without the augmentation, so a test can assert on its absence too.
 *
 * @param app - The app.
 * @returns The service, or `undefined`.
 */
function serviceOf(app: App): unknown {
  return Reflect.get(app, "devtools");
}

describe("devtools()", () => {
  it("defines app.devtools and registers the service under its class", async () => {
    const h = await createDevtoolsApp();

    expect(serviceOf(h.app)).toBeInstanceOf(DevtoolsService);
    expect(h.app.services.get(DevtoolsService)).toBe(serviceOf(h.app));
    h.dispose();
  });

  it("registers the devtools settings section with its documented defaults", async () => {
    const h = await createDevtoolsApp();
    const settings = h.app.settings.section<{ toggleKey: string; openOnStart: boolean; opacity: number }>("devtools");

    expect(settings.toggleKey).toBe("Backquote");
    expect(settings.openOnStart).toBe(false);
    expect(settings.opacity).toBeCloseTo(0.92, 5);
    h.dispose();
  });

  it("lets the project settings section drive the toggle key and the extension options override it", async () => {
    const fromSettings = await createDevtoolsApp({ settings: { devtools: { toggleKey: "F1" } } });
    expect(fromSettings.app.settings.section<{ toggleKey: string }>("devtools").toggleKey).toBe("F1");
    fromSettings.dispose();

    const overridden = await createDevtoolsApp({
      settings: { devtools: { toggleKey: "F1" } },
      options: { toggleKey: "F2", panels: ["stats"] },
    });
    expect(overridden.app.devtools.panels.map((panel) => panel.name)).toEqual(["stats"]);
    overridden.dispose();
  });

  it("registers its IGX-155x codes on the app", async () => {
    const h = await createDevtoolsApp();
    // A code the extension registered formats through the app's registry rather than as a bare code.
    expect(() => h.app.devtools.panel("nope")).toThrowError(/IGX-1552/u);
    h.dispose();
  });

  it("refuses to define app.devtools twice, whichever extension got there first", async () => {
    const { createApp, defineExtension } = await import("@ignifx/core");

    // Two `devtools()` calls are stopped one layer earlier, by core's unique-name rule.
    await expect(
      createApp({ headless: true, logLevel: "silent", extensions: [devtools(), devtools()] }),
    ).rejects.toThrow(/IGX-0406/u);

    // IGX-1550 is the check that survives a differently-named extension claiming the property.
    const squatter = defineExtension(() => ({
      name: "squatter",
      version: "0.0.0",
      register(ctx) {
        ctx.defineAppProperty("devtools", () => null);
      },
    }))();
    await expect(createApp({ headless: true, logLevel: "silent", extensions: [squatter, devtools()] })).rejects.toThrow(
      /IGX-1550/u,
    );
  });

  it("adds its Console sink to app.log itself, so log lines arrive without game-side wiring", async () => {
    const sink = createDevtoolsLogSink({ limit: 10 });
    const harness = await createDevtoolsApp({ options: { logSink: sink } });
    harness.app.log.info("from the root");
    harness.app.log.child("assets").warn("from a child");
    // The harness logs at `debug`, so start-up lines share the buffer; the two lines just written
    // must both be there, in order.
    const messages: string[] = [];
    for (let index = 0; index < sink.length; index += 1) {
      messages.push(sink.at(index)?.message ?? "");
    }
    const root = messages.indexOf("from the root");
    const child = messages.indexOf("from a child");
    expect(root).toBeGreaterThanOrEqual(0);
    expect(child).toBeGreaterThan(root);
    // The app's own sink still receives everything: the devtools sink is added, not substituted.
    expect(harness.log.toArray().map((record) => record.message)).toContain("from the root");
    harness.dispose();
  });

  it("registers no system at all until the overlay is opened", async () => {
    const h = await createDevtoolsApp();
    const before = h.app.diagnostics.frame.frame;
    h.step();

    // A headless open cannot mount, so no system is ever registered: the frame counter is the only
    // thing that moved.
    expect(h.app.diagnostics.frame.frame).toBe(before + 1);
    expect(h.app.devtools.isOpen).toBe(false);
    h.dispose();
  });

  it("makes open() a no-op with one debug line on a headless app", async () => {
    const h = await createDevtoolsApp();
    h.app.devtools.open();

    expect(h.app.devtools.isOpen).toBe(false);
    const lines = h.log.toArray().filter((entry: LogRecord): boolean => entry.scope === "devtools");
    expect(lines.some((entry: LogRecord): boolean => entry.message.includes("no DOM"))).toBe(true);
    h.dispose();
  });

  it("keeps every non-DOM member working headlessly", async () => {
    const h = await createDevtoolsApp();
    const entity = h.app.world.createEntity("Player");
    const seen: (string | null)[] = [];
    h.app.devtools.onSelectionChanged.connect((value) => {
      seen.push(value?.name ?? null);
    });

    h.app.devtools.select(entity);
    h.app.devtools.select(entity);
    h.app.devtools.select(null);
    h.app.devtools.panel("console").hide();

    expect(seen).toEqual(["Player", null]);
    expect(h.app.devtools.panel("console").visible).toBe(false);
    expect(h.app.devtools.panel("stats").title).toBe("Stats");
    h.dispose();
  });

  it("clears a selection that was destroyed rather than handing out a dead entity", async () => {
    const h = await createDevtoolsApp();
    const entity = h.app.world.createEntity("Doomed");
    h.app.devtools.select(entity);
    entity.destroyImmediate();
    h.app.devtools.select(entity);

    expect(h.app.devtools.selected).toBeNull();
    h.dispose();
  });

  it("declares the five optional peers it duck-types", () => {
    const extension = devtools();

    expect(extension.name).toBe("@ignifx/devtools");
    expect(extension.requires).toEqual(["@ignifx/core"]);
    expect(extension.optional).toEqual([
      "@ignifx/ui",
      "@ignifx/input",
      "@ignifx/audio",
      "@ignifx/physics",
      "@ignifx/physics-2d",
    ]);
  });

  it("survives app disposal and a second close", async () => {
    const h = await createDevtoolsApp();
    const service = h.app.devtools;
    h.dispose();
    service.close();
    service.dispose();

    expect(service.isOpen).toBe(false);
  });
});
