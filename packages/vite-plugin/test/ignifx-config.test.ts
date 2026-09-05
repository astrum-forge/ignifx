import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import {
  defineConfig,
  findIgnifxConfigFile,
  IGNIFX_CONFIG_DEFINE_KEY,
  IGNIFX_CONFIG_FILE_NAMES,
  loadIgnifxConfig,
} from "../src/ignifx-config.js";
import { createFixtureTree, disposeFixtures } from "./support/fixtures.js";
import type { ConfigEnv } from "vite";

afterAll(disposeFixtures);

const BUILD: ConfigEnv = { command: "build", mode: "production" };

describe("defineConfig", () => {
  it("returns its argument unchanged", () => {
    const config = { layers: ["Default", "Player"] };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("IGNIFX_CONFIG_DEFINE_KEY", () => {
  it("is the key 04-extensions.md §5 documents", () => {
    expect(IGNIFX_CONFIG_DEFINE_KEY).toBe("import.meta.env.IGNIFX_CONFIG");
  });
});

describe("findIgnifxConfigFile", () => {
  it("finds ignifx.config.ts at the root", async () => {
    const root = await createFixtureTree({ "ignifx.config.ts": "export default {};" });
    expect(await findIgnifxConfigFile(root)).toBe(join(root, "ignifx.config.ts"));
  });

  it("prefers the first name in the documented order", async () => {
    const root = await createFixtureTree({
      "ignifx.config.ts": "export default {};",
      "ignifx.config.js": "export default {};",
    });
    expect(await findIgnifxConfigFile(root)).toBe(join(root, IGNIFX_CONFIG_FILE_NAMES[0]));
  });

  it("falls through to a later name", async () => {
    const root = await createFixtureTree({ "ignifx.config.mjs": "export default {};" });
    expect(await findIgnifxConfigFile(root)).toBe(join(root, "ignifx.config.mjs"));
  });

  it("returns null when the project has no config", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    expect(await findIgnifxConfigFile(root)).toBeNull();
  });

  it("ignores a directory that happens to be named like a config file", async () => {
    const root = await createFixtureTree({ "ignifx.config.ts/keep.txt": "x" });
    expect(await findIgnifxConfigFile(root)).toBeNull();
  });
});

describe("loadIgnifxConfig", () => {
  it("resolves to an empty config when there is no file", async () => {
    expect(await loadIgnifxConfig(null, "/nowhere", BUILD)).toEqual({ path: null, config: {}, dependencies: [] });
  });

  it("loads a TypeScript config through Vite's own loader", async () => {
    const root = await createFixtureTree({
      "ignifx.config.ts": [
        "interface Settings { readonly layers: readonly string[] }",
        "const settings: Settings = { layers: ['Default', 'Player'] };",
        "export default { ...settings, time: { fixedDeltaTime: 1 / 60 } };",
      ].join("\n"),
    });
    const resolved = await loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD);
    expect(resolved.config).toEqual({ layers: ["Default", "Player"], time: { fixedDeltaTime: 1 / 60 } });
    expect(resolved.path).toBe(join(root, "ignifx.config.ts"));
  });

  it("fails with IGX-0554 when the file does not exist", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    await expect(loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD)).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidProjectConfig }),
    );
  });

  it("fails with IGX-0554 when the default export is not an object", async () => {
    const root = await createFixtureTree({ "ignifx.config.ts": "export default 42;" });
    await expect(loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD)).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidProjectConfig }),
    );
  });

  it("accepts a config file that exports a function returning the settings", async () => {
    const root = await createFixtureTree({ "ignifx.config.ts": "export default () => ({ a: 1 });" });
    const resolved = await loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD);
    expect(resolved.config).toEqual({ a: 1 });
  });

  it("drops values JSON cannot carry, so define never emits a function", async () => {
    const root = await createFixtureTree({
      "ignifx.config.ts": "export default { layers: ['Default'], hook: () => 1 };",
    });
    const resolved = await loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD);
    expect(resolved.config).toEqual({ layers: ["Default"] });
  });

  it("fails with IGX-0554 when the default export is an array", async () => {
    const root = await createFixtureTree({ "ignifx.config.ts": "export default [1, 2];" });
    await expect(loadIgnifxConfig(join(root, "ignifx.config.ts"), root, BUILD)).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidProjectConfig }),
    );
  });
});
