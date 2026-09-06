import { createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { SCRIPTS_MODULE_ID } from "../src/virtual-modules.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES } from "./support/fixtures.js";

/**
 * The script registry as a real `vite dev` server transforms it
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5). The string assertions in
 * `virtual-modules.test.ts` prove what is generated; this proves Vite accepts it — that the glob
 * expands, that the module is wired into the HMR graph, and that the accept handler survives the
 * transform.
 */

afterAll(disposeFixtures);

describe("vite dev with the ignifx plugin", () => {
  it("transforms virtual:ignifx/scripts into a self-accepting HMR module", async () => {
    const root = await createFixtureTree({
      "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
      "src/main.ts":
        'import { acceptHotReload, scripts } from "virtual:ignifx/scripts";\nexport { acceptHotReload, scripts };\n',
      "src/scripts/mover.ts": 'export class Mover {\n  static typeId = "mygame/Mover";\n}\n',
      "assets/sprites/hero.png": PNG_BYTES,
    });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      server: { middlewareMode: true },
    });
    try {
      const result = await server.transformRequest(SCRIPTS_MODULE_ID);
      const code = result?.code ?? "";

      expect(code).toContain("createHotContext");
      expect(code).toContain("accept(");
      expect(code).toContain("app.hotReload.apply");
      // The eager glob became a real static import of the script file, which is what puts the
      // module in Vite's HMR graph.
      expect(code).toContain("/src/scripts/mover.ts");
    } finally {
      await server.close();
    }
  });
});
