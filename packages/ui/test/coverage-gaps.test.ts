import { Camera, defineExtension } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { asDomCanvas, resolveDomTarget } from "../src/dom/dom-target.js";
import { ui } from "../src/extension.js";
import { WorldText } from "../src/text/world-text.js";
import { createUiApp, fixtureFiles } from "./support/app.js";
import { createFakeDom } from "./support/fake-dom.js";
import type { UiAppHarness } from "./support/app.js";
import type { App, Extension, ExtensionContext, FontAsset } from "@ignifx/core";

/**
 * The paths the feature suites do not reach on their own: the DOM-target guards, the extension's
 * start-up and failure branches, and `WorldText`'s billboard and teardown arithmetic.
 */

let harness: UiAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("resolveDomTarget", () => {
  it("answers null on a platform with no HTMLCanvasElement at all", () => {
    expect(asDomCanvas({})).toBeNull();
    expect(resolveDomTarget(null)).toBeNull();
  });

  it("answers null for a surface that is not a canvas, and for a detached one", () => {
    const dom = createFakeDom();
    // A stand-in constructor, so `surface instanceof HTMLCanvasElement` can be made to answer both
    // ways inside one Node process.
    class StubCanvas {
      /** Nothing: only the identity of the constructor matters. */
      readonly stub = true;
    }
    const previous: unknown = Reflect.get(globalThis, "HTMLCanvasElement");
    Reflect.set(globalThis, "HTMLCanvasElement", StubCanvas);
    try {
      expect(asDomCanvas({})).toBeNull();
      const canvas = new StubCanvas();
      Reflect.set(canvas, "ownerDocument", { defaultView: null });
      expect(resolveDomTarget(canvas)).toBeNull();
      Reflect.set(canvas, "ownerDocument", dom.document);
      expect(resolveDomTarget(canvas)?.window).toBe(dom.window);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, "HTMLCanvasElement");
      } else {
        Reflect.set(globalThis, "HTMLCanvasElement", previous);
      }
    }
  });
});

describe("the extension's start-up", () => {
  it("starts and stops a headless app without touching a device", async () => {
    const h = await createUiApp();
    harness = h;
    await h.app.start();
    expect(h.app.isRunning).toBe(true);
    h.app.stop();
  });

  it("reports a translation document that cannot be loaded rather than throwing", async () => {
    const errors: unknown[] = [];
    const h = await createUiApp({ options: { strings: "ui/missing.i18n.json" } });
    harness = h;
    h.app.onError.connect((report) => {
      errors.push(report.error);
    });
    await h.settle();
    await h.settle();
    expect(h.app.i18n.availableLocales).toEqual([]);
  });

  it("writes the focus flag onto whatever registered an input service", async () => {
    const captured: { uiHasFocus: boolean } = { uiHasFocus: false };
    const fakeInput: Extension = defineExtension<undefined>(() => ({
      name: "test/input",
      version: "0.0.0",
      engine: ">=0.0.0 <1.0.0",
      requires: ["@ignifx/core"],
      register(ctx: ExtensionContext): void {
        ctx.defineAppProperty("input", (): unknown => captured);
      },
    }))();
    const { createApp, createManualClock } = await import("@ignifx/core");
    const app: App = await createApp({
      headless: true,
      clock: createManualClock(),
      extensions: [fakeInput, ui()],
    });
    // The host is inert headlessly, so the setter is never called — but it was built against the
    // real service rather than the no-op, which is the branch under test.
    expect(app.ui.keyboardHasFocus).toBe(false);
    expect(captured.uiHasFocus).toBe(false);
    app.dispose();
  });
});

describe("WorldText", () => {
  it("copies the camera's rotation when billboarding and its own otherwise", async () => {
    const h = await createUiApp({ files: fixtureFiles() });
    harness = h;
    const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
    const eye = h.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.transform.localEulerAngles = { x: 0, y: 90, z: 0 };
    eye.addComponent(Camera);

    const entity = h.app.world.createEntity("sign");
    const sign = entity.addComponent(WorldText);
    sign.font = font;
    sign.text = "Danger";
    sign.offset = { x: 0, y: 2, z: 0 };
    sign.pixelsPerUnit = 50;
    h.step();
    const renderable = sign.lite.renderable;
    expect(renderable?.position.y).toBeCloseTo(2, 5);
    expect(renderable?.scaling.x).toBeCloseTo(1 / 50, 5);
    const own = renderable?.rotationQuaternion.y ?? 0;

    sign.billboard = true;
    h.step();
    expect(renderable?.rotationQuaternion.y).not.toBe(own);

    sign.pixelsPerUnit = 0;
    h.step();
    expect(renderable?.scaling.x).toBe(1);
  });

  it("silences the renderable when the text is cleared and rebuilds it when it comes back", async () => {
    const h = await createUiApp({ files: fixtureFiles() });
    harness = h;
    const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
    const sign = h.app.world.createEntity("sign").addComponent(WorldText);
    sign.font = font;
    sign.text = "Danger";
    h.step();
    const first = sign.lite.renderable;
    expect(first).not.toBeNull();

    sign.text = "";
    h.step();
    expect(sign.lite.renderable).toBeNull();

    sign.text = "Back";
    h.step();
    expect(sign.lite.renderable).not.toBeNull();
    expect(sign.lite.renderable).not.toBe(first);
  });

  it("dims a disabled sign to nothing without destroying it", async () => {
    const h = await createUiApp({ files: fixtureFiles() });
    harness = h;
    const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
    const entity = h.app.world.createEntity("sign");
    const sign = entity.addComponent(WorldText);
    sign.font = font;
    sign.text = "Danger";
    sign.alwaysOnTop = true;
    h.step();
    expect(sign.lite.renderable?.ignoreDepth).toBe(true);
    sign.enabled = false;
    h.step();
    expect(sign.lite.renderable?.opacity).toBe(0);
  });
});
