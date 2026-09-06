import { describe, expect, it } from "vitest";
import { isEditableElement, UI_FOCUS_ATTRIBUTE, UiFocusWatcher } from "../../src/dom/focus.js";
import { createFakeDom, FakeElement } from "../support/fake-dom.js";
import type { FakeDocument } from "../support/fake-dom.js";

/**
 * Focus routing (`docs/architecture/13-ui.md` §1, `08-input.md` §5). The browser suite proves the
 * end-to-end criterion — typing in a field does not fire actions — and this suite proves the
 * policy underneath it.
 */

/**
 * Builds a detached element of one tag.
 *
 * @param tag - The tag name.
 * @param document - The document to create in.
 * @returns The element.
 */
function element(tag: string, document: FakeDocument): FakeElement {
  return new FakeElement(tag, document);
}

describe("isEditableElement", () => {
  const dom = createFakeDom();

  it("claims the keyboard for a bare input, a textarea, and a select", () => {
    expect(isEditableElement(element("input", dom.document))).toBe(true);
    expect(isEditableElement(element("textarea", dom.document))).toBe(true);
    expect(isEditableElement(element("select", dom.document))).toBe(true);
  });

  it("leaves the keyboard alone for the button-like and slider-like input types", () => {
    for (const type of ["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"]) {
      const field = element("input", dom.document);
      field.type = type;
      expect(isEditableElement(field), type).toBe(false);
    }
  });

  it("claims the keyboard for a text-like input type", () => {
    for (const type of ["text", "search", "email", "password", "number", "url"]) {
      const field = element("input", dom.document);
      field.type = type;
      expect(isEditableElement(field), type).toBe(true);
    }
  });

  it("claims the keyboard for a contenteditable element of any tag", () => {
    const editor = element("div", dom.document);
    editor.isContentEditable = true;
    expect(isEditableElement(editor)).toBe(true);
  });

  it("leaves the keyboard alone for a button, a div, and nothing at all", () => {
    expect(isEditableElement(element("button", dom.document))).toBe(false);
    expect(isEditableElement(element("div", dom.document))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement("not an element")).toBe(false);
  });

  it("lets the data attribute override the guess in both directions", () => {
    const forced = element("div", dom.document);
    forced.setAttribute(UI_FOCUS_ATTRIBUTE, "capture");
    expect(isEditableElement(forced)).toBe(true);

    const excused = element("input", dom.document);
    excused.setAttribute(UI_FOCUS_ATTRIBUTE, "ignore");
    expect(isEditableElement(excused)).toBe(false);
  });

  it("ignores an element that cannot answer getAttribute", () => {
    expect(isEditableElement({ tagName: "INPUT" })).toBe(true);
  });
});

describe("UiFocusWatcher", () => {
  it("reports true when a field takes focus and false when it loses it", async () => {
    const dom = createFakeDom();
    const seen: boolean[] = [];
    const watcher = new UiFocusWatcher({
      document: dom.document as unknown as Document,
      onChanged: (value: boolean): void => {
        seen.push(value);
      },
    });
    watcher.attach();
    expect(seen).toEqual([]);

    const field = new FakeElement("input", dom.document);
    dom.document.activeElement = field;
    dom.document.dispatch("focusin", { target: field });
    expect(watcher.hasFocus).toBe(true);
    expect(seen).toEqual([true]);

    dom.document.activeElement = null;
    dom.document.dispatch("focusout", { target: field });
    await Promise.resolve();
    expect(watcher.hasFocus).toBe(false);
    expect(seen).toEqual([true, false]);
    watcher.detach();
  });

  it("stays quiet when focus moves between two fields", () => {
    const dom = createFakeDom();
    const seen: boolean[] = [];
    const watcher = new UiFocusWatcher({
      document: dom.document as unknown as Document,
      onChanged: (value: boolean): void => {
        seen.push(value);
      },
    });
    watcher.attach();
    const first = new FakeElement("input", dom.document);
    const second = new FakeElement("textarea", dom.document);
    dom.document.dispatch("focusin", { target: first });
    dom.document.dispatch("focusin", { target: second });
    expect(seen).toEqual([true]);
    watcher.detach();
  });

  it("releases the keyboard on detach and unsubscribes", () => {
    const dom = createFakeDom();
    const seen: boolean[] = [];
    const watcher = new UiFocusWatcher({
      document: dom.document as unknown as Document,
      onChanged: (value: boolean): void => {
        seen.push(value);
      },
    });
    watcher.attach();
    dom.document.dispatch("focusin", { target: new FakeElement("input", dom.document) });
    watcher.detach();
    expect(seen).toEqual([true, false]);
    expect(dom.document.listeners.get("focusin")?.size ?? 0).toBe(0);
    watcher.detach();
    expect(seen).toEqual([true, false]);
  });

  it("reads the element that is already focused when it attaches", () => {
    const dom = createFakeDom();
    dom.document.activeElement = new FakeElement("input", dom.document);
    const seen: boolean[] = [];
    const watcher = new UiFocusWatcher({
      document: dom.document as unknown as Document,
      onChanged: (value: boolean): void => {
        seen.push(value);
      },
    });
    watcher.attach();
    expect(seen).toEqual([true]);
    watcher.detach();
  });

  it("does nothing when a queued focusout resolves after detach", async () => {
    const dom = createFakeDom();
    const seen: boolean[] = [];
    const watcher = new UiFocusWatcher({
      document: dom.document as unknown as Document,
      onChanged: (value: boolean): void => {
        seen.push(value);
      },
    });
    watcher.attach();
    dom.document.dispatch("focusin", { target: new FakeElement("input", dom.document) });
    dom.document.dispatch("focusout", {});
    watcher.detach();
    await Promise.resolve();
    expect(seen).toEqual([true, false]);
  });
});
