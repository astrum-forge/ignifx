import { Camera, isIgnifxError } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { UI_ERROR_MESSAGES, UiErrorCode } from "../src/errors.js";
import { ui } from "../src/extension.js";
import { I18nService } from "../src/i18n/i18n-service.js";
import { I18N_ASSET_TYPE } from "../src/i18n/locale-file.js";
import { describeSchemas } from "../src/schemas.js";
import { UI_SETTINGS_SECTION } from "../src/settings.js";
import { HudText } from "../src/text/hud-text.js";
import { WorldText2D } from "../src/text/world-text-2d.js";
import { WorldText } from "../src/text/world-text.js";
import { UI_SYNC_ORDER } from "../src/world/ui-system.js";
import { WorldAnchor } from "../src/world/world-anchor.js";
import { createUiApp, fixtureFiles } from "./support/app.js";
import { createFakeDom, FakeElement } from "./support/fake-dom.js";
import type { LocaleAsset } from "../src/i18n/locale-file.js";
import type { UiSettings } from "../src/settings.js";
import type { UiAppHarness } from "./support/app.js";
import type { AssetHandle, FontAsset } from "@ignifx/core";

/**
 * The extension end to end on a headless app (`docs/architecture/13-ui.md`, `07-rendering.md` §6).
 * Everything registers, every DOM member is inert, and the text components still shape text —
 * Babylon Lite's shaper touches no device.
 */

let harness: UiAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a headless app with the fixtures mounted and a loaded font.
 *
 * @returns The harness and the font handle.
 */
async function withFont(): Promise<{ h: UiAppHarness; font: AssetHandle<FontAsset> }> {
  const h = await createUiApp({ files: fixtureFiles() });
  harness = h;
  const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
  return { h, font };
}

describe("registration", () => {
  it("gives the app ui, i18n, the settings section, and the four components", async () => {
    const h = await createUiApp();
    harness = h;
    expect(h.app.ui.isActive).toBe(false);
    expect(h.app.i18n).toBeInstanceOf(I18nService);
    expect(h.app.services.get(I18nService)).toBe(h.app.i18n);
    const settings = h.app.settings.section<UiSettings>(UI_SETTINGS_SECTION);
    expect(settings.scaling).toBe("css");
    expect(settings.layers).toEqual(["hud", "menu", "overlay"]);
    const entity = h.app.world.createEntity("e");
    expect(entity.addComponent(WorldAnchor)).toBeInstanceOf(WorldAnchor);
    expect(entity.addComponent(HudText)).toBeInstanceOf(HudText);
    expect(entity.addComponent(WorldText)).toBeInstanceOf(WorldText);
    expect(entity.addComponent(WorldText2D)).toBeInstanceOf(WorldText2D);
  });

  it("takes its options over the settings section", async () => {
    const h = await createUiApp({
      settings: { ui: { scaling: "dpi", layers: ["a"] } },
      options: { scaling: "fit", referenceResolution: [640, 360] },
    });
    harness = h;
    expect(h.app.ui.scaling).toBe("fit");
    expect(h.app.ui.referenceResolution).toEqual([640, 360]);
    expect(h.app.ui.layers.map((layer) => layer.name)).toEqual(["a"]);
  });

  it("registers the i18n asset type and loads the document its option names", async () => {
    const h = await createUiApp({ files: fixtureFiles(), options: { strings: "ui/strings.i18n.json" } });
    harness = h;
    const handle = await h.load<LocaleAsset>("ui/strings.i18n.json");
    expect(handle.type).toBe(I18N_ASSET_TYPE);
    await h.settle();
    expect(h.app.i18n.t("menu.pause")).toBe("Paused");
    expect(h.app.i18n.availableLocales).toEqual(["en", "fr"]);
  });

  it("refuses a second ui() on one app", async () => {
    const h = await createUiApp();
    harness = h;
    let code: string | null = null;
    try {
      // A second app would be a different app, so the failure is built on this one: `register`
      // only ever sees a context whose `app` already carries `ui`.
      void ui().register({ app: h.app } as never);
    } catch (error: unknown) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe(UiErrorCode.duplicateExtension);
  });

  it("declares every message its code table names", () => {
    for (const code of Object.values(UiErrorCode)) {
      expect(UI_ERROR_MESSAGES[code], code).toBeTypeOf("string");
    }
    expect(Object.keys(UI_ERROR_MESSAGES).every((code) => /^IGX-13\d\d$/u.test(code))).toBe(true);
  });

  it("runs its system after core's camera synchronisation", () => {
    expect(UI_SYNC_ORDER).toBeGreaterThan(900);
    expect(UI_SYNC_ORDER).toBeGreaterThanOrEqual(1001);
    expect(UI_SYNC_ORDER).toBeLessThanOrEqual(9999);
  });
});

describe("describeSchemas", () => {
  it("describes the four components and the file format, namespaced", () => {
    const schemas = describeSchemas();
    expect(Object.keys(schemas).toSorted()).toEqual([
      "ignifx/HudText",
      "ignifx/WorldAnchor",
      "ignifx/WorldText",
      "ignifx/WorldText2D",
      "ignifx/i18n-file",
    ]);
    for (const [key, schema] of Object.entries(schemas)) {
      expect(key, key).toContain("/");
      expect(Object.keys(schema.fields).length, key).toBeGreaterThan(0);
    }
    expect(schemas["ignifx/HudText"]?.fields["fontSize"]?.default).toBe(32);
    expect(schemas["ignifx/i18n-file"]?.format).toBe("ignifx.i18n");
  });
});

describe("text components, headless", () => {
  it("shapes a block once a font and a string are both present", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    h.step();
    expect(label.block).toBeNull();
    expect(label.metrics).toEqual({ width: 0, height: 0 });

    label.font = font;
    label.text = "Hello";
    h.step();
    expect(label.block).not.toBeNull();
    expect(label.metrics.width).toBeCloseTo(86.4, 5);
    expect(label.metrics.height).toBeCloseTo(38.4, 5);
  });

  it("re-shapes on a text change and keeps the same block", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "Hello";
    h.step();
    const first = label.block;
    label.text = "Hi";
    h.step();
    expect(label.block).toBe(first);
    expect(label.metrics.width).toBeCloseTo(34.56, 5);
  });

  it("rebuilds the block when a layout field changes", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "Hello";
    h.step();
    const first = label.block;
    label.fontSize = 16;
    h.step();
    expect(label.block).not.toBe(first);
    expect(label.metrics.height).toBeCloseTo(19.2, 5);
  });

  it("wraps at maxWidth", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "Hello world this is a long line that wraps";
    label.maxWidth = 120;
    h.step();
    expect(label.metrics.height).toBeGreaterThan(label.fontSize * label.lineHeight);
  });

  it("drops the block when the text is cleared", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "Hello";
    h.step();
    label.text = "";
    h.step();
    expect(label.block).toBeNull();
  });

  it("resolves an i18nKey through app.i18n and follows a locale switch", async () => {
    const { h, font } = await withFont();
    await h.app.i18n.load(await h.load<LocaleAsset>("ui/strings.i18n.json"));
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.i18nKey = "menu.pause";
    h.step();
    expect(label.resolveText(h.app.i18n)).toBe("Paused");
    h.app.i18n.locale = "fr";
    h.step();
    expect(label.resolveText(h.app.i18n)).toBe("En pause");
  });

  it("falls back to the key when there is no localization service", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.i18nKey = "menu.pause";
    expect(label.resolveText(null)).toBe("menu.pause");
  });

  it("builds a scene renderable for WorldText and silences it on destroy", async () => {
    const { h, font } = await withFont();
    const entity = h.app.world.createEntity("sign");
    const sign = entity.addComponent(WorldText);
    sign.font = font;
    sign.text = "Danger";
    h.step();
    expect(sign.lite.renderable).not.toBeNull();
    expect(sign.scene).toBe(h.app.lite.scene);
    const renderable = sign.lite.renderable;
    entity.destroy();
    h.step();
    expect(renderable?.opacity).toBe(0);
  });

  it("places a WorldText2D with no camera without throwing", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("damage").addComponent(WorldText2D);
    label.font = font;
    label.text = "-12";
    h.step();
    expect(label.lite.layer).not.toBeNull();
    expect(label.lite.layer?.visible).toBe(false);
  });

  it("keeps the text renderer absent on a headless app", async () => {
    const { h, font } = await withFont();
    const label = h.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "Hello";
    h.step();
    expect(h.app.ui.isActive).toBe(false);
  });

  it("projects with a camera present", async () => {
    const { h, font } = await withFont();
    const eye = h.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera);
    const label = h.app.world.createEntity("damage").addComponent(WorldText2D);
    label.font = font;
    label.text = "-12";
    h.step();
    expect(label.lite.layer).not.toBeNull();
  });
});

describe("WorldAnchor, headless", () => {
  it("positions an element the game supplied and hides it when the entity goes away", async () => {
    const h = await createUiApp();
    harness = h;
    const dom = createFakeDom();
    const tag = new FakeElement("div", dom.document);
    const entity = h.app.world.createEntity("boss");
    const anchor = entity.addComponent(WorldAnchor);
    anchor.element = tag as unknown as HTMLElement;
    anchor.clampToScreen = true;
    h.step();
    expect(tag.style.getPropertyValue("position")).toBe("absolute");
    expect(anchor.placement.visible).toBe(false);

    entity.destroy();
    h.step();
    expect(tag.style.getPropertyValue("display")).toBe("none");
  });

  it("does nothing at all for an anchor with no element", async () => {
    const h = await createUiApp();
    harness = h;
    const anchor = h.app.world.createEntity("boss").addComponent(WorldAnchor);
    h.step();
    expect(anchor.placement.visible).toBe(false);
    expect(anchor.element).toBeNull();
  });

  it("clamps and scales through the placement it computed", async () => {
    const h = await createUiApp();
    harness = h;
    const eye = h.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera);
    const dom = createFakeDom();
    const tag = new FakeElement("div", dom.document);
    const anchor = h.app.world.createEntity("boss").addComponent(WorldAnchor);
    anchor.element = tag as unknown as HTMLElement;
    anchor.clampToScreen = true;
    anchor.scaleWithDistance = true;
    h.step();
    expect(anchor.placement.visible).toBe(true);
    expect(tag.style.getPropertyValue("transform")).toContain("translate(");
  });
});

describe("disposal", () => {
  it("releases the host, the runtime, the strings handle, and the service", async () => {
    const h = await createUiApp({ files: fixtureFiles(), options: { strings: "ui/strings.i18n.json" } });
    await h.settle();
    h.app.dispose();
    harness = null;
    expect(h.app.isRunning).toBe(false);
  });
});
