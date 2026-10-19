import { describe, expect, it } from "vitest";
import {
  editorEntryModuleSource,
  editorPageHtml,
  normalizeExtensionsModule,
  playControlsModuleSource,
} from "../src/vite/modules.js";

/** The generated page and modules, as text (`docs/architecture/17-editor-host.md` §3). */

describe("generated sources", () => {
  it("writes the entry without the optional fields when they are absent", () => {
    const source = editorEntryModuleSource({
      editorOrigin: "http://localhost:5173",
      extensionsModule: null,
      bootScene: null,
      engineVersion: null,
      heartbeatIntervalMs: null,
    });

    expect(source).toContain('editorOrigin: "http://localhost:5173",');
    expect(source).toContain("bootScene: null,");
    expect(source).not.toContain("engineVersion");
    expect(source).not.toContain("heartbeatIntervalMs");
    expect(source).toContain("acceptHotReload(host.app);");
  });

  it("hands every asset-change event to the host, through a literal import.meta.hot call", () => {
    const source = editorEntryModuleSource({
      editorOrigin: "ignifx://app",
      extensionsModule: "/src/extensions.ts",
      bootScene: null,
      engineVersion: null,
      heartbeatIntervalMs: null,
    });

    expect(source).toContain(
      [
        "if (import.meta.hot) {",
        '  import.meta.hot.on("ignifx:asset-changed", (change) => {',
        "    void host.assetChanged(change);",
        "  });",
        "}",
      ].join("\n"),
    );
  });

  it("writes a production play-controls module with no editor code", () => {
    const source = playControlsModuleSource({
      editorOrigin: "ignifx://app",
      engineVersion: "1.2.3",
      heartbeatIntervalMs: null,
      hot: false,
    });

    expect(source).toBe("export function attachEditorPlayControls() {\n  return () => {};\n}\n");
  });

  it("references the entry module from the page", () => {
    expect(editorPageHtml()).toContain('<script type="module" src="/@id/virtual:ignifx/editor-host-entry">');
  });

  it("makes the extensions path root-absolute", () => {
    expect(normalizeExtensionsModule("src/extensions.ts")).toBe("/src/extensions.ts");
    expect(normalizeExtensionsModule("./src/game/extensions.ts")).toBe("/src/game/extensions.ts");
    expect(normalizeExtensionsModule("/src/extensions.ts")).toBe("/src/extensions.ts");
    expect(() => normalizeExtensionsModule("")).toThrow(expect.objectContaining({ code: "IGX-1803" }));
  });
});
