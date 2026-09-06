import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The barrel is a contract: `skills/ignifx/references/api/devtools.md` and
 * `api/devtools.api.md` are generated from it, so a name that silently disappears takes a
 * documentation page with it (coding standards §4).
 */
describe("@ignifx/devtools barrel", () => {
  it("exports the extension factory and the service", () => {
    expect(typeof barrel.devtools).toBe("function");
    expect(typeof barrel.DevtoolsService).toBe("function");
  });

  it("exports the nine panel names in the order 15 §4 lists them", () => {
    expect(barrel.DEVTOOLS_PANEL_NAMES).toEqual([
      "stats",
      "scene",
      "inspector",
      "assets",
      "input",
      "audio",
      "physics",
      "console",
      "timeline",
    ]);
  });

  it("owns IGX-1550 upward and leaves 1501-1549 to core", () => {
    const codes = Object.values(barrel.DevtoolsErrorCode);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^IGX-15\d\d$/u);
      expect(Number(code.slice(4))).toBeGreaterThanOrEqual(1550);
      expect(barrel.DEVTOOLS_ERROR_MESSAGES[code]).toBeTypeOf("string");
    }
  });

  it("exports the settings section, its defaults, and its schema", () => {
    expect(barrel.DEVTOOLS_SETTINGS_SECTION).toBe("devtools");
    expect(barrel.defaultDevtoolsSettings().toggleKey).toBe("Backquote");
    expect(Object.keys(barrel.devtoolsSettingsSchema())).toContain("panels");
  });

  it("samples after every renderer, 2D and UI system", () => {
    // core render sync is 900, @ignifx/ui is 1100, and 04-extensions.md gives extensions
    // [1001, 9999]: 9000 is behind all of them and still inside the range.
    expect(barrel.DEVTOOLS_SAMPLE_ORDER).toBe(9000);
    expect(barrel.DEVTOOLS_SAMPLE_ORDER).toBeLessThanOrEqual(9999);
  });
});
