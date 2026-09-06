import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { UiErrorCode } from "../../src/errors.js";
import {
  I18N_FORMAT,
  I18N_FORMAT_VERSION,
  LocaleAsset,
  localeFileSchema,
  localeJsonSchema,
  parseLocaleFile,
} from "../../src/i18n/locale-file.js";
import { readFixture } from "../support/app.js";

/**
 * The `ignifx.i18n` document (`docs/architecture/06-serialization-and-scene-format.md` §6).
 */

/**
 * Builds a minimal valid document.
 *
 * @param overrides - Fields to replace.
 * @returns The document.
 */
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: I18N_FORMAT,
    formatVersion: I18N_FORMAT_VERSION,
    defaultLocale: "en",
    locales: { en: { ok: "OK" } },
    ...overrides,
  };
}

describe("parseLocaleFile", () => {
  it("reads the checked-in fixture's two locales", () => {
    const parsed = parseLocaleFile(JSON.parse(readFixture("strings.i18n.json")), "ui/strings.i18n.json");
    expect(Object.keys(parsed.locales)).toEqual(["en", "fr"]);
    expect(parsed.defaultLocale).toBe("en");
    expect(parsed.locales["en"]?.["hud.score"]).toBe("Score: {score}");
  });

  it("drops an entry whose value is not a string", () => {
    const parsed = parseLocaleFile(document({ locales: { en: { ok: "OK", bad: 7 } } }), "x");
    expect(parsed.locales["en"]).toEqual({ ok: "OK" });
  });

  it("falls back to the first declared locale when defaultLocale names an unknown one", () => {
    const parsed = parseLocaleFile(document({ defaultLocale: "de", locales: { fr: {}, en: {} } }), "x");
    expect(parsed.defaultLocale).toBe("en");
  });

  it("treats a locale whose table is not an object as empty", () => {
    const parsed = parseLocaleFile(document({ locales: { en: 7 } }), "x");
    expect(parsed.locales["en"]).toEqual({});
  });

  it("rejects a document with the wrong format or version", () => {
    for (const bad of [null, 7, [], document({ format: "other" }), document({ formatVersion: 2 })]) {
      let code: string | null = null;
      try {
        parseLocaleFile(bad, "ui/bad.i18n.json");
      } catch (error: unknown) {
        code = isIgnifxError(error) ? error.code : null;
      }
      expect(code).toBe(UiErrorCode.invalidLocaleFile);
    }
  });

  it("rejects a document that declares no locales", () => {
    let code: string | null = null;
    try {
      parseLocaleFile(document({ locales: {} }), "ui/empty.i18n.json");
    } catch (error: unknown) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe(UiErrorCode.invalidLocaleFile);
  });
});

describe("LocaleAsset", () => {
  it("reports the locales it carries, sorted", () => {
    const asset = new LocaleAsset("x", parseLocaleFile(document({ locales: { fr: {}, en: {} } }), "x"));
    expect(asset.availableLocales).toEqual(["en", "fr"]);
    expect(LocaleAsset.assetType).toBe("i18n");
  });
});

describe("the tooling schema", () => {
  it("pins the format discriminator and the version", () => {
    const schema = localeFileSchema();
    expect(schema["format"]?.createDefault()).toBe(I18N_FORMAT);
    expect(schema["formatVersion"]?.createDefault()).toBe(I18N_FORMAT_VERSION);
  });

  it("produces a JSON Schema object", () => {
    const json = localeJsonSchema();
    expect(json["type"]).toBe("object");
    expect(Object.keys(json["properties"] ?? {})).toContain("locales");
  });
});
