import { afterEach, describe, expect, it } from "vitest";
import { UI_CLASS_NAMES, UI_CSS_VARIABLES, UI_STYLE_ELEMENT_ID } from "../../src/dom/styles.js";
import { UI_LAYER_Z_STEP } from "../../src/settings.js";
import { FakeElement, FakeResizeObserver, resizeFakeCanvas } from "../support/fake-dom.js";
import { createTestHost } from "../support/host.js";
import type { UiLayout } from "../../src/dom/scaling.js";
import type { FakeDocument } from "../support/fake-dom.js";

/**
 * The overlay host over the fake DOM (`docs/architecture/13-ui.md` §1). Chromium proves the real
 * elements land in the right place; this suite proves the arithmetic, the layer stack, the
 * variables, and the headless no-ops.
 */

afterEach(() => {
  FakeResizeObserver.instances.length = 0;
});

/**
 * Appends a fresh fake child to a layer element, through the one cast the fake DOM costs.
 *
 * @param element - The layer's element, typed as the real DOM types it stands in for.
 * @param document - The fake document to create the child in.
 */
function appendFake(element: HTMLDivElement | null, document: FakeDocument): void {
  (element as unknown as FakeElement | null)?.append(new FakeElement("div", document));
}

describe("the root", () => {
  it("is a click-through div mounted next to the canvas", () => {
    const { host, dom } = createTestHost();
    const root = host.root;
    expect(root).not.toBeNull();
    expect(root?.className).toBe(UI_CLASS_NAMES.root);
    expect(dom.wrapper.children.map((child: FakeElement): string => child.tagName)).toEqual(["CANVAS", "DIV"]);
    expect(host.isActive).toBe(true);
  });

  it("falls back to the document body when the canvas has no parent", () => {
    const { host, dom } = createTestHost();
    host.dispose();
    dom.canvas.remove();
    const second = createTestHost();
    second.dom.canvas.remove();
    const third = createTestHost();
    third.dom.canvas.remove();
    expect(second.host.root).not.toBeNull();
    expect(third.host.root).not.toBeNull();
  });

  it("injects the stylesheet once per document", () => {
    const { dom } = createTestHost();
    const styles = dom.document.head.children.filter((child: FakeElement): boolean => child.id === UI_STYLE_ELEMENT_ID);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain(`.${UI_CLASS_NAMES.root}`);
  });

  it("exposes the four safe-area insets as CSS variables", () => {
    const { host } = createTestHost();
    const style = host.root?.style;
    expect(style?.getPropertyValue(UI_CSS_VARIABLES.safeTop)).toBe("env(safe-area-inset-top, 0px)");
    expect(style?.getPropertyValue(UI_CSS_VARIABLES.safeRight)).toBe("env(safe-area-inset-right, 0px)");
    expect(style?.getPropertyValue(UI_CSS_VARIABLES.safeBottom)).toBe("env(safe-area-inset-bottom, 0px)");
    expect(style?.getPropertyValue(UI_CSS_VARIABLES.safeLeft)).toBe("env(safe-area-inset-left, 0px)");
  });

  it("hides and shows the whole overlay", () => {
    const { host } = createTestHost();
    expect(host.root?.style.getPropertyValue("display")).toBe("block");
    host.visible = false;
    expect(host.visible).toBe(false);
    expect(host.root?.style.getPropertyValue("display")).toBe("none");
    host.visible = false;
    host.visible = true;
    expect(host.root?.style.getPropertyValue("display")).toBe("block");
  });

  it("starts hidden when the settings say so", () => {
    const { host } = createTestHost({ settings: { visible: false } });
    expect(host.root?.style.getPropertyValue("display")).toBe("none");
  });
});

describe("layers", () => {
  it("creates the declared layers up front, back to front", () => {
    const { host } = createTestHost({ settings: { layers: ["hud", "menu"] } });
    expect(host.layers.map((layer) => layer.name)).toEqual(["hud", "menu"]);
    expect(host.layer("hud").zIndex).toBe(UI_LAYER_Z_STEP);
    expect(host.layer("menu").zIndex).toBe(UI_LAYER_Z_STEP * 2);
    expect(host.root?.children).toHaveLength(2);
  });

  it("creates an unknown layer on first use and keeps returning the same one", () => {
    const { host } = createTestHost({ settings: { layers: [] } });
    const first = host.layer("hud");
    expect(host.layer("hud")).toBe(first);
    expect(first.element?.dataset["ignifxLayer"]).toBe("hud");
  });

  it("orders the layer list by z-index, whatever order the layers were created in", () => {
    const { host } = createTestHost({ settings: { layers: [] } });
    host.layer("late", { zIndex: 5 });
    host.layer("early", { zIndex: 1 });
    expect(host.layers.map((layer) => layer.name)).toEqual(["early", "late"]);
    expect(host.layer("early").element?.style.getPropertyValue("z-index")).toBe("1");
  });

  it("re-sorts when an existing layer's z-index is given on a later call", () => {
    const { host } = createTestHost({ settings: { layers: ["a", "b"] } });
    host.layer("a", { zIndex: 999 });
    expect(host.layers.map((layer) => layer.name)).toEqual(["b", "a"]);
  });

  it("hides a single layer without unmounting anything", () => {
    const { host, dom } = createTestHost({ settings: { layers: ["hud"] } });
    const hud = host.layer("hud");
    appendFake(hud.element, dom.document);
    hud.visible = false;
    expect(hud.element?.style.getPropertyValue("display")).toBe("none");
    expect(hud.element?.children).toHaveLength(1);
    hud.visible = false;
    hud.visible = true;
    expect(hud.element?.style.getPropertyValue("display")).toBe("block");
  });

  it("clears a layer's children", () => {
    const { host, dom } = createTestHost({ settings: { layers: ["hud"] } });
    const hud = host.layer("hud");
    appendFake(hud.element, dom.document);
    hud.clear();
    expect(hud.element?.children).toHaveLength(0);
  });

  it("starts a layer hidden when asked", () => {
    const { host } = createTestHost({ settings: { layers: [] } });
    expect(host.layer("menu", { visible: false }).visible).toBe(false);
  });
});

describe("layout", () => {
  it('writes the canvas size onto the root in "css" mode', () => {
    const { host } = createTestHost({ cssWidth: 800, cssHeight: 600 });
    expect(host.root?.style.getPropertyValue("width")).toBe("800px");
    expect(host.root?.style.getPropertyValue("transform")).toBe("translate(0px, 0px) scale(1)");
    expect(host.root?.style.getPropertyValue(UI_CSS_VARIABLES.scale)).toBe("1");
  });

  it('letterboxes in "fit" mode and reports the layout', () => {
    const { host } = createTestHost({
      cssWidth: 1000,
      cssHeight: 600,
      settings: { scaling: "fit", referenceResolution: [400, 300] },
    });
    expect(host.layout).toEqual({ mode: "fit", width: 400, height: 300, scale: 2, offsetX: 100, offsetY: 0 });
    expect(host.root?.style.getPropertyValue("transform")).toBe("translate(100px, 0px) scale(2)");
  });

  it("recomputes when the mode or the reference resolution changes", () => {
    const seen: UiLayout[] = [];
    const { host } = createTestHost({ cssWidth: 800, cssHeight: 600 });
    host.onLayoutChanged.connect((layout: UiLayout): void => {
      seen.push(layout);
    });
    host.scaling = "fit";
    host.referenceResolution = [400, 300];
    expect(seen.map((layout) => layout.mode)).toEqual(["fit", "fit"]);
    expect(host.layout.scale).toBe(2);
    expect(host.referenceResolution).toEqual([400, 300]);
  });

  it("writes nothing and emits nothing when a recomputation changes no number", () => {
    const seen: UiLayout[] = [];
    const { host } = createTestHost();
    host.onLayoutChanged.connect((layout: UiLayout): void => {
      seen.push(layout);
    });
    host.refresh();
    host.scaling = "css";
    expect(seen).toEqual([]);
  });

  it("follows a canvas resize through the ResizeObserver", () => {
    const seen: UiLayout[] = [];
    const { host, dom } = createTestHost({ cssWidth: 800, cssHeight: 600 });
    host.onLayoutChanged.connect((layout: UiLayout): void => {
      seen.push(layout);
    });
    resizeFakeCanvas(dom, 400, 300);
    expect(seen).toHaveLength(1);
    expect(host.layout.width).toBe(400);
  });

  it("follows a device-pixel-ratio change through the window resize event", () => {
    const { host, dom } = createTestHost({
      cssWidth: 400,
      cssHeight: 300,
      settings: { scaling: "dpi" },
      resizeObserver: false,
    });
    expect(host.layout.width).toBe(400);
    resizeFakeCanvas(dom, 400, 300, 2);
    expect(host.layout.width).toBe(800);
    expect(host.layout.scale).toBe(0.5);
  });

  it("stops observing once disposed", () => {
    const { host, dom } = createTestHost();
    host.dispose();
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    expect(dom.wrapper.children).toHaveLength(1);
    host.dispose();
  });
});

describe("pointer tracking", () => {
  it("reports a pointer held on an interactive child, and releases it on pointerup", () => {
    const { host, dom, pointerWrites } = createTestHost({ settings: { layers: ["hud"] } });
    const button = new FakeElement("button", dom.document);
    (host.layer("hud").element as unknown as FakeElement | null)?.append(button);
    expect(host.pointerOverUi).toBe(false);
    button.dispatch("pointerdown", { pointerId: 1 });
    expect(host.pointerOverUi).toBe(true);
    dom.window.dispatch("pointerup");
    expect(host.pointerOverUi).toBe(false);
    dom.window.dispatch("pointerup");
    expect(host.pointerOverUi).toBe(false);
    // `app.input.uiHasPointer` is written on each transition, once, and never on a spurious release.
    expect(pointerWrites).toEqual([true, false]);
  });

  it("writes the input pointer flag once for overlapping pointers", () => {
    const { host, dom, pointerWrites } = createTestHost({ settings: { layers: ["hud"] } });
    const button = new FakeElement("button", dom.document);
    (host.layer("hud").element as unknown as FakeElement | null)?.append(button);
    button.dispatch("pointerdown", { pointerId: 1 });
    button.dispatch("pointerdown", { pointerId: 2 });
    dom.window.dispatch("pointerup");
    expect(host.pointerOverUi).toBe(true);
    dom.window.dispatch("pointercancel");
    expect(host.pointerOverUi).toBe(false);
    expect(pointerWrites).toEqual([true, false]);
  });
});

describe("focus routing", () => {
  it("writes the focus flag the input service reads", () => {
    const { dom, focusWrites, host } = createTestHost();
    const field = new FakeElement("input", dom.document);
    dom.document.dispatch("focusin", { target: field });
    expect(focusWrites).toEqual([true]);
    expect(host.keyboardHasFocus).toBe(true);
  });

  it("releases the keyboard when the host is disposed", () => {
    const { dom, focusWrites, host } = createTestHost();
    dom.document.dispatch("focusin", { target: new FakeElement("input", dom.document) });
    host.dispose();
    expect(focusWrites).toEqual([true, false]);
    expect(host.keyboardHasFocus).toBe(false);
  });
});

describe("headless", () => {
  it("has no root, inert layers, and no-op mutations", () => {
    const { host, log } = createTestHost({ headless: true, settings: { layers: ["hud"] } });
    expect(host.root).toBeNull();
    expect(host.isActive).toBe(false);
    expect(host.layer("hud").element).toBeNull();
    expect(host.layers.map((layer) => layer.name)).toEqual(["hud"]);
    host.visible = false;
    host.scaling = "fit";
    host.referenceResolution = [640, 360];
    host.refresh();
    host.layer("hud").visible = false;
    host.layer("hud").clear();
    expect(host.keyboardHasFocus).toBe(false);
    expect(host.pointerOverUi).toBe(false);
    expect(log.toArray().some((record) => record.message.includes("No DOM canvas"))).toBe(true);
    host.dispose();
  });

  it("keeps every conversion finite with no canvas to measure", () => {
    const { host } = createTestHost({ headless: true });
    expect(Number.isFinite(host.pixelMapping.scaleX)).toBe(true);
    expect(host.layout.width).toBeGreaterThan(0);
  });
});
