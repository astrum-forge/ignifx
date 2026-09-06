import { describe, expect, it } from "vitest";
import { DEVTOOLS_CLASS_NAMES, DEVTOOLS_STYLE_ELEMENT_ID } from "../src/dom/styles.js";
import { DEVTOOLS_UI_LAYER } from "../src/overlay/overlay.js";
import { isEditableTarget } from "../src/overlay/toggle-key.js";
import { createOverlayHarness } from "./support/app.js";
import type { FakeElement } from "./support/fake-dom.js";

/**
 * The overlay's lifecycle: what opening builds, what closing takes away, and the one thing that
 * stays behind because core has no way to remove it.
 */

/**
 * Finds the overlay root inside a fake document.
 *
 * @param body - The document body.
 * @returns The root, or `null`.
 */
function rootIn(body: FakeElement): FakeElement | null {
  return body.byClass(DEVTOOLS_CLASS_NAMES.root)[0] ?? null;
}

describe("the devtools overlay", () => {
  it("registers no system and touches no DOM until it is opened", async () => {
    const h = await createOverlayHarness();

    expect(h.systems).toHaveLength(0);
    expect(rootIn(h.dom.document.body)).toBeNull();
    expect(h.dom.document.getElementById(DEVTOOLS_STYLE_ELEMENT_ID)).toBeNull();
    // The world's structural signals are the ones devtools would have to hold; a closed overlay
    // holds none of them. (`app.onError` already carries core's own default handler.)
    expect(h.app.world.onEntityCreated.connectionCount).toBe(0);
    h.dispose();
  });

  it("installs the sampler, the stylesheet, the root and the subscriptions on open", async () => {
    const h = await createOverlayHarness();
    const errorsBefore = h.app.onError.connectionCount;
    const entitiesBefore = h.app.world.onEntityCreated.connectionCount;

    h.service.open();

    expect(h.service.isOpen).toBe(true);
    expect(h.systems).toHaveLength(1);
    expect(h.systems[0]?.name).toBe("devtools-sample");
    expect(h.dom.document.getElementById(DEVTOOLS_STYLE_ELEMENT_ID)).not.toBeNull();
    expect(rootIn(h.dom.document.body)).not.toBeNull();
    expect(h.app.onError.connectionCount).toBe(errorsBefore + 1);
    expect(h.app.world.onEntityCreated.connectionCount).toBe(entitiesBefore + 1);
    h.dispose();
  });

  it("takes the DOM and every subscription away again on close, and re-opening is idempotent", async () => {
    const h = await createOverlayHarness();
    h.service.open();
    h.service.open();
    expect(h.systems).toHaveLength(1);

    const errorsWhileOpen = h.app.onError.connectionCount;
    h.service.close();

    expect(h.service.isOpen).toBe(false);
    expect(rootIn(h.dom.document.body)).toBeNull();
    expect(h.app.onError.connectionCount).toBe(errorsWhileOpen - 1);
    expect(h.app.world.onEntityCreated.connectionCount).toBe(0);
    // Core's scheduler has `registerSystem` and no `unregisterSystem`, so the sampler stays
    // registered for the app's life and returns on its first line instead.
    expect(h.systems).toHaveLength(1);

    h.service.open();
    expect(h.systems).toHaveLength(1);
    expect(rootIn(h.dom.document.body)).not.toBeNull();
    h.dispose();
  });

  it("leaves the sampler inert while the overlay is closed", async () => {
    const h = await createOverlayHarness();
    h.service.open();
    h.step(1);
    h.service.close();
    const before = h.dom.document.body.descendants().length;
    h.step(1);

    expect(h.dom.document.body.descendants()).toHaveLength(before);
    h.dispose();
  });

  it("emits onOpened and onClosed exactly once per transition", async () => {
    const h = await createOverlayHarness();
    let opened = 0;
    let closed = 0;
    h.service.onOpened.connect(() => {
      opened += 1;
    });
    h.service.onClosed.connect(() => {
      closed += 1;
    });

    h.service.toggle();
    h.service.toggle();
    h.service.toggle();

    expect([opened, closed]).toEqual([2, 1]);
    h.dispose();
  });

  it("builds its own root as the canvas's sibling when @ignifx/ui is absent", async () => {
    const h = await createOverlayHarness();
    h.service.open();

    const root = rootIn(h.dom.document.body);
    expect(root?.parentElement).toBe(h.dom.wrapper);
    expect(h.dom.wrapper.children.indexOf(root as FakeElement)).toBe(h.dom.wrapper.children.indexOf(h.dom.canvas) + 1);
    h.dispose();
  });

  it("falls back to the document body when the canvas has no parent", async () => {
    const h = await createOverlayHarness({ wrapped: false });
    h.service.open();

    expect(rootIn(h.dom.document.body)?.parentElement).toBe(h.dom.document.body);
    h.dispose();
  });

  it("mounts into an app.ui devtools layer when @ignifx/ui is registered", async () => {
    const h = await createOverlayHarness();
    const layerElement = h.dom.document.createElement("div");
    h.dom.document.body.append(layerElement);
    const asked: { name: string; zIndex: number | undefined }[] = [];
    Reflect.defineProperty(h.app, "ui", {
      value: {
        isActive: true,
        layer(name: string, options?: { zIndex?: number }) {
          asked.push({ name, zIndex: options?.zIndex });
          return { element: layerElement };
        },
      },
    });

    h.service.open();

    expect(asked[0]?.name).toBe(DEVTOOLS_UI_LAYER);
    expect(asked[0]?.zIndex).toBeGreaterThan(0);
    expect(rootIn(h.dom.document.body)?.parentElement).toBe(layerElement);
    h.dispose();
  });

  it("shows one tab per panel and switches the visible one", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["stats", "console"] } });
    h.service.open();
    const root = rootIn(h.dom.document.body);
    const tabs = root?.byClass(DEVTOOLS_CLASS_NAMES.tab) ?? [];

    expect(tabs.map((tab: FakeElement): string => tab.textContent)).toEqual(["Stats", "Console"]);
    expect(tabs[0]?.className).toContain(DEVTOOLS_CLASS_NAMES.tabActive);

    tabs[1]?.dispatch("click");
    expect(tabs[1]?.className).toContain(DEVTOOLS_CLASS_NAMES.tabActive);
    expect(tabs[0]?.className).not.toContain(DEVTOOLS_CLASS_NAMES.tabActive);
    h.dispose();
  });

  it("hides and shows a panel's tab, keeping the state across a close and re-open", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["stats", "console"] } });
    h.service.open();
    h.service.panel("stats").hide();

    const tabs = rootIn(h.dom.document.body)?.byClass(DEVTOOLS_CLASS_NAMES.tab) ?? [];
    expect(tabs[0]?.style.getPropertyValue("display")).toBe("none");
    expect(tabs[1]?.className).toContain(DEVTOOLS_CLASS_NAMES.tabActive);

    h.service.close();
    h.service.open();
    const after = rootIn(h.dom.document.body)?.byClass(DEVTOOLS_CLASS_NAMES.tab) ?? [];
    expect(after[0]?.style.getPropertyValue("display")).toBe("none");

    h.service.panel("stats").show();
    expect(after[0]?.style.getPropertyValue("display")).toBe("inline-block");
    expect(after[0]?.className).toContain(DEVTOOLS_CLASS_NAMES.tabActive);
    h.dispose();
  });

  it("refuses an unknown panel name with IGX-1552", async () => {
    const h = await createOverlayHarness();

    expect(() => h.service.panel("scene-graph")).toThrowError(/IGX-1552/u);
    h.dispose();
  });

  it("drops unknown and duplicate names from the panels setting", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["console", "nope", "console", "stats"] } });

    expect(h.service.panels.map((panel) => panel.name)).toEqual(["console", "stats"]);
    h.dispose();
  });

  it("docks to the edge the settings name", async () => {
    const h = await createOverlayHarness({ settings: { position: "bottom", opacity: 0.5 } });
    h.service.open();
    const style = rootIn(h.dom.document.body)?.style;

    expect(style?.getPropertyValue("top")).toBe("auto");
    expect(style?.getPropertyValue("height")).toBe("40%");
    expect(style?.getPropertyValue("opacity")).toBe("0.5");
    h.dispose();
  });

  it("toggles on the configured key and ignores keystrokes typed into a field", async () => {
    const h = await createOverlayHarness({ settings: { toggleKey: "F1" } });
    h.service.start();

    h.dom.document.dispatch("keydown", { code: "Backquote" });
    expect(h.service.isOpen).toBe(false);

    h.dom.document.dispatch("keydown", { code: "F1" });
    expect(h.service.isOpen).toBe(true);

    h.dom.document.dispatch("keydown", { code: "F1", repeat: true });
    expect(h.service.isOpen).toBe(true);

    const field = h.dom.document.createElement("input");
    h.dom.document.dispatch("keydown", { code: "F1", target: field });
    expect(h.service.isOpen).toBe(true);

    h.dom.document.dispatch("keydown", { code: "F1" });
    expect(h.service.isOpen).toBe(false);
    h.dispose();
  });

  it("opens on start when the settings ask it to, and drops the key on dispose", async () => {
    const h = await createOverlayHarness({ settings: { openOnStart: true } });
    h.service.start();

    expect(h.service.isOpen).toBe(true);
    h.service.dispose();
    h.dom.document.dispatch("keydown", { code: "Backquote" });
    expect(h.service.isOpen).toBe(false);
    h.dispose();
  });

  it("installs no toggle key at all on a headless app", async () => {
    const h = await createOverlayHarness({ headless: true, settings: { openOnStart: true } });
    h.service.start();

    expect(h.service.isOpen).toBe(false);
    expect(h.dom.document.listeners.get("keydown")).toBeUndefined();
    h.dispose();
  });

  it("knows which event targets own their keystrokes", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
});
