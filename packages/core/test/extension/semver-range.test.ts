import { describe, expect, it } from "vitest";
import { satisfiesRange } from "../../src/extension/semver-range.js";

/** The in-house range matcher behind `Extension.engine` (`docs/architecture/04-extensions.md` §1). */
describe("satisfiesRange", () => {
  it("matches an exact version, with or without the equals sign", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
  });

  it("matches the four inequality comparators", () => {
    expect(satisfiesRange("1.2.3", ">=1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.2", ">=1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.3", "<=1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "<=1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.4", ">1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.2", "<1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.3", "<1.2.3")).toBe(false);
  });

  it("follows npm's caret rules, including the 0.x special cases", () => {
    expect(satisfiesRange("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfiesRange("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
    expect(satisfiesRange("0.0.2", "^0.0.3")).toBe(false);
  });

  it("requires every comparator in a set and any set in a range", () => {
    expect(satisfiesRange("0.5.0", ">=0.4.0 <1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.0", ">=0.4.0 <1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", ">=0.4.0 <1.0.0 || ^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^0.4.0 || ^1.0.0")).toBe(false);
  });

  it("treats an empty range as unconstrained and an unparseable one as no match", () => {
    expect(satisfiesRange("0.0.0", "")).toBe(true);
    expect(satisfiesRange("0.0.0", "   ")).toBe(true);
    expect(satisfiesRange("0.0.0", "~0.0.1")).toBe(false);
    expect(satisfiesRange("0.0.0", ">=1.x")).toBe(false);
    expect(satisfiesRange("0.0.0", ">=1.0.0-rc.1")).toBe(false);
    expect(satisfiesRange("not-a-version", ">=0.0.0")).toBe(false);
  });
});
