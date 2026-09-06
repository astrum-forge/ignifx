import { describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import { buildManifest } from "../src/manifest.js";
import {
  ASSET_CHANGED_EVENT,
  MANIFEST_MODULE_ID,
  manifestModuleSource,
  normalizeScriptsPattern,
  RESOLVED_MANIFEST_MODULE_ID,
  RESOLVED_SCRIPTS_MODULE_ID,
  resolveVirtualModuleId,
  SCRIPTS_HOT_RELOAD_EXPORT,
  SCRIPTS_MODULE_ID,
  scriptsModuleSource,
} from "../src/virtual-modules.js";

describe("module ids", () => {
  it("resolves the manifest specifier to a plugin-owned id", () => {
    expect(resolveVirtualModuleId(MANIFEST_MODULE_ID)).toBe(RESOLVED_MANIFEST_MODULE_ID);
    expect(RESOLVED_MANIFEST_MODULE_ID.startsWith("\0")).toBe(true);
  });

  it("resolves the scripts specifier to a plugin-owned id", () => {
    expect(resolveVirtualModuleId(SCRIPTS_MODULE_ID)).toBe(RESOLVED_SCRIPTS_MODULE_ID);
  });

  it("leaves every other specifier to other plugins", () => {
    expect(resolveVirtualModuleId("virtual:something-else")).toBeNull();
    expect(resolveVirtualModuleId("./main.ts")).toBeNull();
  });
});

describe("ASSET_CHANGED_EVENT", () => {
  it("is the event name 05-assets-and-loading.md §7 documents", () => {
    expect(ASSET_CHANGED_EVENT).toBe("ignifx:asset-changed");
  });
});

describe("manifestModuleSource", () => {
  it("exports the manifest as a named export", () => {
    const source = manifestModuleSource(buildManifest([], "assets", () => ""));
    expect(source).toContain("export const manifest = {");
    expect(source).toContain('"format": "ignifx.manifest"');
    expect(source).not.toContain("export default");
  });
});

describe("normalizeScriptsPattern", () => {
  it("makes a bare pattern root-absolute", () => {
    expect(normalizeScriptsPattern("src/scripts/*.ts")).toBe("/src/scripts/*.ts");
  });

  it("strips a leading ./", () => {
    expect(normalizeScriptsPattern("./src/*.ts")).toBe("/src/*.ts");
  });

  it("leaves an already-absolute pattern alone", () => {
    expect(normalizeScriptsPattern("/src/*.ts")).toBe("/src/*.ts");
  });

  it("rejects an empty pattern with IGX-0555", () => {
    expect(() => normalizeScriptsPattern("")).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidOption }),
    );
  });

  it("rejects a pattern that escapes the root with IGX-0555", () => {
    expect(() => normalizeScriptsPattern("../outside/*.ts")).toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidOption }),
    );
  });
});

describe("scriptsModuleSource", () => {
  const source = scriptsModuleSource("/src/scripts/*.ts");

  it("globs the pattern eagerly so Vite sees each script in its HMR graph", () => {
    expect(source).toContain('import.meta.glob("/src/scripts/*.ts", { eager: true })');
  });

  it("keeps only exported classes that declare a typeId", () => {
    expect(source).toContain('typeof exported.typeId === "string"');
  });

  it("sorts the module keys so registration order is stable across machines", () => {
    expect(source).toContain("Object.keys(modules).sort()");
  });

  it("exports the registry as `scripts`", () => {
    expect(source).toContain("export const scripts = registry;");
  });

  it("emits no HMR client by default, so a build carries none of it", () => {
    expect(source).toContain("export function acceptHotReload()");
    expect(source).not.toContain("import.meta.hot");
    expect(source).not.toContain("hotReload.apply");
  });

  it("evaluates to the classes that declare a typeId", () => {
    // The generated body is exercised directly with a stand-in for `import.meta.glob`, which proves
    // the filtering and ordering rather than only the text of the module.
    const mover = Object.assign(function Mover(): void {}, { typeId: "mygame/Mover" });
    const spinner = Object.assign(function Spinner(): void {}, { typeId: "mygame/Spinner" });
    const modules = {
      "/src/scripts/b.ts": { Mover: mover },
      "/src/scripts/a.ts": { Spinner: spinner, helper: (): void => undefined },
    };
    const registry: { typeId: string }[] = [];
    for (const key of Object.keys(modules).toSorted()) {
      const module = modules[key as keyof typeof modules];
      for (const name of Object.keys(module)) {
        const exported = (module as Record<string, unknown>)[name];
        if (typeof exported === "function" && typeof (exported as { typeId?: unknown }).typeId === "string") {
          registry.push(exported as unknown as { typeId: string });
        }
      }
    }
    expect(registry.map((entry) => entry.typeId)).toEqual(["mygame/Spinner", "mygame/Mover"]);
  });
});

describe("scriptsModuleSource with the HMR client", () => {
  const source = scriptsModuleSource("/src/scripts/*.ts", { hot: true });

  it("self-accepts so Vite hands it the replacement registry", () => {
    expect(source).toContain("const hot = import.meta.hot;");
    expect(source).toContain("hot.accept((next) => {");
  });

  it("keeps the subscribed apps in import.meta.hot.data, which survives the swap", () => {
    expect(source).toContain("hot.data.ignifxHotReload ??= { apps: new Set() }");
    expect(source).toContain(`export function ${SCRIPTS_HOT_RELOAD_EXPORT}(app) {`);
    expect(source).toContain("state.apps.add(app);");
    expect(source).toContain("state.apps.delete(app);");
  });

  it("diffs the two registries by typeId and hands the new one to app.hotReload.apply", () => {
    expect(source).toContain("const before = new Set(scripts.map((type) => type.typeId));");
    expect(source).toContain("if (!before.delete(type.typeId)) {");
    expect(source).toContain("const removed = [...before];");
    expect(source).toContain("const report = app.hotReload.apply([{ types: next.scripts }]);");
    expect(source).toContain('console.info("[ignifx] script hot reload", {');
  });

  it("still exports the registry the game registers at startup", () => {
    expect(source).toContain("export const scripts = registry;");
  });
});

/**
 * The added and removed `typeId`s between two registries, exactly as the generated handler derives
 * them.
 *
 * @param before - The registry the module held before the update.
 * @param after - The registry the replacement module exports.
 * @returns What was added and what disappeared.
 */
function diff(
  before: readonly string[],
  after: readonly string[],
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  const remaining = new Set(before);
  const added: string[] = [];
  for (const typeId of after) {
    if (!remaining.delete(typeId)) {
      added.push(typeId);
    }
  }
  return { added, removed: [...remaining] };
}

describe("the HMR client's diff, as the generated body computes it", () => {
  it("reports a new file's class as added", () => {
    expect(diff(["mygame/Mover"], ["mygame/Mover", "mygame/Spinner"])).toEqual({
      added: ["mygame/Spinner"],
      removed: [],
    });
  });

  it("reports a deleted class as removed", () => {
    expect(diff(["mygame/Mover", "mygame/Spinner"], ["mygame/Mover"])).toEqual({
      added: [],
      removed: ["mygame/Spinner"],
    });
  });

  it("reports nothing when only the class bodies changed", () => {
    expect(diff(["mygame/Mover"], ["mygame/Mover"])).toEqual({ added: [], removed: [] });
  });
});
