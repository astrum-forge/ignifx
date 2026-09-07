import { describe, expect, it } from "vitest";
import { acceptedVersions, rewriteSkillVersion } from "../lib/skill-version.ts";

/** A skill header shaped like the real ones. */
function header(version: string): string {
  return [
    "---",
    "name: ignifx",
    "license: Apache-2.0",
    "metadata:",
    `  ignifx-version: "${version}"`,
    "---",
    "",
    "# ignifx",
    "",
  ].join("\n");
}

describe("acceptedVersions", () => {
  it("accepts the unreleased placeholder only while core is 0.0.0", () => {
    expect(acceptedVersions("0.0.0")).toEqual(["0.0.0", "0.0.0-unreleased"]);
    expect(acceptedVersions("0.1.0")).toEqual(["0.1.0"]);
  });
});

describe("rewriteSkillVersion", () => {
  it("writes the released version over the placeholder", () => {
    const result = rewriteSkillVersion(header("0.0.0-unreleased"), "0.1.0");
    expect(result.changed).toBe(true);
    expect(result.previous).toBe("0.0.0-unreleased");
    expect(result.text).toContain('  ignifx-version: "0.1.0"');
  });

  it("leaves the placeholder alone before anything is released", () => {
    const result = rewriteSkillVersion(header("0.0.0-unreleased"), "0.0.0");
    expect(result.changed).toBe(false);
    expect(result.text).toContain('"0.0.0-unreleased"');
  });

  it("is a no-op when the version already matches", () => {
    const result = rewriteSkillVersion(header("0.1.0"), "0.1.0");
    expect(result.changed).toBe(false);
  });

  it("preserves the file's own indentation and quotes the value", () => {
    const source = ["---", "metadata:", "    ignifx-version: 0.0.9", "---", ""].join("\n");
    expect(rewriteSkillVersion(source, "0.1.0").text).toContain('    ignifx-version: "0.1.0"');
  });

  it("reports a missing key rather than inventing a line", () => {
    const result = rewriteSkillVersion("---\nname: ignifx\n---\n", "0.1.0");
    expect(result.previous).toBeNull();
    expect(result.changed).toBe(false);
  });

  it("never rewrites a mention of the key in prose", () => {
    const source = `${header("0.0.0-unreleased")}\nSet ignifx-version: "9.9.9" in your own skill.\n`;
    const result = rewriteSkillVersion(source, "0.1.0");
    expect(result.text).toContain('Set ignifx-version: "9.9.9" in your own skill.');
    expect(result.text).toContain('  ignifx-version: "0.1.0"');
  });
});
