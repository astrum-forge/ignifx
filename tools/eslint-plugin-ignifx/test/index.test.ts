import { describe, expect, it } from "vitest";
import plugin, { rules } from "../src/index.ts";

/** The rule names coding standards §6 lists in the ESLint table. */
const EXPECTED_RULES = [
  "error-code-format",
  "no-async-lifecycle",
  "no-console",
  "no-entity-find-in-src",
  "no-lite-outside-adapter",
  "no-module-side-effects",
  "schema-field-shadowing",
  "signal-connect-owner",
];

describe("eslint-plugin-ignifx", () => {
  it("exposes exactly the eight rules of coding standards §6", () => {
    expect(Object.keys(rules).toSorted()).toEqual(EXPECTED_RULES);
  });

  it("names itself so flat config can resolve the `ignifx/` prefix", () => {
    expect(plugin.meta.name).toBe("eslint-plugin-ignifx");
  });

  it("enables every rule as an error in the recommended config", () => {
    const configured = plugin.configs.recommended.rules ?? {};
    expect(Object.keys(configured).toSorted()).toEqual(EXPECTED_RULES.map((name) => `ignifx/${name}`));
    expect(Object.values(configured).every((severity) => severity === "error")).toBe(true);
  });

  it("documents every rule and declares an options schema", () => {
    for (const [name, rule] of Object.entries(rules)) {
      const docs = rule.meta.docs;
      expect(docs?.description, name).toMatch(/\S/u);
      expect(docs?.url, name).toContain(name);
      expect(rule.meta.schema, name).toBeInstanceOf(Array);
      expect(Object.keys(rule.meta.messages).length, name).toBeGreaterThan(0);
    }
  });
});
