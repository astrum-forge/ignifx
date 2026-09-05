import { describe, expect, it } from "vitest";

// The barrel is imported dynamically: a static `import * as` of a module with no exports is a
// lint error, and awaiting the import is the sharper assertion anyway — it proves the module
// evaluates without throwing and without doing anything (`CONSTITUTION.md` §3.5).
describe("@ignifx/audio barrel", () => {
  it("imports without executing anything and exports nothing yet", async () => {
    const barrel = await import("../src/index.js");
    expect(Object.keys(barrel)).toEqual([]);
  });
});
