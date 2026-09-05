import { describe, expect, it } from "vitest";

// The barrels are imported dynamically: a static `import * as` of a module with no exports is a
// lint error, and awaiting the import is the sharper assertion anyway — it proves each entry
// evaluates without throwing and without doing anything (`CONSTITUTION.md` §3.5).
describe("@ignifx/electron barrels", () => {
  it("imports the renderer entry without executing anything and exports nothing yet", async () => {
    const barrel = await import("../src/index.js");
    expect(Object.keys(barrel)).toEqual([]);
  });

  it("imports the main entry without executing anything and exports nothing yet", async () => {
    const main = await import("../src/main.js");
    expect(Object.keys(main)).toEqual([]);
  });

  it("imports the preload entry without executing anything and exports nothing yet", async () => {
    const preload = await import("../src/preload.js");
    expect(Object.keys(preload)).toEqual([]);
  });
});
