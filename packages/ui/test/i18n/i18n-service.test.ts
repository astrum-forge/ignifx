import { createLogger, createMemorySink, isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { UiErrorCode } from "../../src/errors.js";
import { I18nService } from "../../src/i18n/i18n-service.js";
import { I18N_FORMAT, I18N_FORMAT_VERSION, LocaleAsset, parseLocaleFile } from "../../src/i18n/locale-file.js";
import { readFixture } from "../support/app.js";
import type { MemorySink } from "@ignifx/core";

/**
 * The localization service (`docs/architecture/13-ui.md` §3).
 */

/**
 * Builds a service with a memory sink to read the log from.
 *
 * @param locale - The starting locale.
 * @returns The service and its sink.
 */
function createService(locale = "en"): { service: I18nService; sink: MemorySink } {
  const sink = createMemorySink();
  return { service: new I18nService({ log: createLogger({ sink, level: "debug" }), locale }), sink };
}

/**
 * Builds an asset out of a literal document.
 *
 * @param locales - The message tables.
 * @param defaultLocale - The document's default.
 * @returns The asset.
 */
function asset(locales: Record<string, Record<string, string>>, defaultLocale = "en"): LocaleAsset {
  const parsed = parseLocaleFile(
    { format: I18N_FORMAT, formatVersion: I18N_FORMAT_VERSION, defaultLocale, locales },
    "test.i18n.json",
  );
  return new LocaleAsset("test.i18n.json", parsed);
}

/** The checked-in fixture, as an asset. */
function fixtureAsset(): LocaleAsset {
  return new LocaleAsset(
    "ui/strings.i18n.json",
    parseLocaleFile(JSON.parse(readFixture("strings.i18n.json")), "ui/strings.i18n.json"),
  );
}

describe("loading", () => {
  it("takes a loaded asset directly", async () => {
    const { service } = createService();
    await service.load(fixtureAsset());
    expect(service.availableLocales).toEqual(["en", "fr"]);
    expect(service.t("menu.pause")).toBe("Paused");
  });

  it("takes an asset handle and waits for it", async () => {
    const { service } = createService();
    const value = fixtureAsset();
    await service.load({ promise: Promise.resolve(value) } as unknown as never);
    expect(service.t("menu.quit")).toBe("Quit");
  });

  it("merges a second document, with the later load winning on a repeated key", async () => {
    const { service } = createService();
    await service.load(asset({ en: { a: "one", b: "two" } }));
    await service.load(asset({ en: { b: "TWO" }, de: { a: "eins" } }));
    expect(service.t("a")).toBe("one");
    expect(service.t("b")).toBe("TWO");
    expect(service.availableLocales).toEqual(["de", "en"]);
  });

  it("moves to the document's default locale when the starting one is not declared", async () => {
    const { service } = createService("es");
    const seen: string[] = [];
    service.onLocaleChanged.connect((locale: string): void => {
      seen.push(locale);
    });
    await service.load(asset({ en: { a: "x" }, fr: { a: "y" } }, "fr"));
    expect(service.locale).toBe("fr");
    expect(seen).toEqual(["fr"]);
  });

  it("keeps the starting locale when the document declares it", async () => {
    const { service } = createService("en");
    await service.load(asset({ en: { a: "x" }, fr: { a: "y" } }, "fr"));
    expect(service.locale).toBe("en");
    expect(service.fallbackLocale).toBe("fr");
  });
});

describe("lookup", () => {
  it("falls back to the fallback locale for a key the active one lacks", async () => {
    const { service } = createService();
    await service.load(fixtureAsset());
    service.locale = "fr";
    expect(service.t("hud.score", { score: 3 })).toBe("Score : 3");
    // `sign.danger` exists only in `en`, which is the document's default locale.
    expect(service.t("sign.danger")).toBe("Danger");
  });

  it("returns the key itself for a missing message and logs it once", async () => {
    const { service, sink } = createService();
    await service.load(fixtureAsset());
    expect(service.t("nope")).toBe("nope");
    expect(service.t("nope")).toBe("nope");
    expect(sink.toArray().filter((record) => record.message.includes("No translation for nope"))).toHaveLength(1);
    expect(service.has("nope")).toBe(false);
    expect(service.has("menu.pause")).toBe(true);
  });

  it("renders plurals in the active locale's own rules", async () => {
    const { service } = createService();
    await service.load(fixtureAsset());
    expect(service.t("hud.lives", { count: 0 })).toBe("No lives left");
    expect(service.t("hud.lives", { count: 1 })).toBe("1 life");
    expect(service.t("hud.lives", { count: 5 })).toBe("5 lives");
    service.locale = "fr";
    expect(service.t("hud.lives", { count: 0 })).toBe("Aucune vie");
    expect(service.t("hud.lives", { count: 1 })).toBe("1 vie");
    expect(service.t("hud.lives", { count: 5 })).toBe("5 vies");
  });

  it("warns once about a message it cannot parse and shows the raw text", async () => {
    const { service, sink } = createService();
    await service.load(asset({ en: { broken: "{count, plural, one {x}}" } }));
    expect(service.t("broken", { count: 1 })).toBe("{count, plural, one {x}}");
    expect(service.t("broken", { count: 1 })).toBe("{count, plural, one {x}}");
    const warnings = sink.toArray().filter((record) => record.message.includes(UiErrorCode.invalidMessagePattern));
    expect(warnings).toHaveLength(1);
  });
});

describe("locale", () => {
  it("emits onLocaleChanged and rejects an undeclared locale", async () => {
    const { service } = createService();
    await service.load(fixtureAsset());
    const seen: string[] = [];
    service.onLocaleChanged.connect((locale: string): void => {
      seen.push(locale);
    });
    service.locale = "fr";
    service.locale = "fr";
    expect(seen).toEqual(["fr"]);

    let code: string | null = null;
    try {
      service.locale = "de";
    } catch (error: unknown) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe(UiErrorCode.unknownLocale);
    expect(service.locale).toBe("fr");
  });

  it("accepts any locale before a document has been loaded", () => {
    const { service } = createService();
    service.locale = "de";
    expect(service.locale).toBe("de");
  });

  it("takes an explicit fallback locale", async () => {
    const { service } = createService();
    await service.load(asset({ en: { a: "x" }, fr: {} }));
    service.fallbackLocale = "en";
    service.locale = "fr";
    expect(service.t("a")).toBe("x");
  });
});

describe("disposal", () => {
  it("drops every document and disconnects", async () => {
    const { service } = createService();
    await service.load(fixtureAsset());
    service.clear();
    expect(service.availableLocales).toEqual([]);
    expect(service.t("menu.pause")).toBe("menu.pause");
    service.dispose();
  });
});
