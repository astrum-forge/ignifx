import { afterEach, describe, expect, it } from "vitest";
import { checkSkillLint } from "../lib/check-skill-lint.ts";
import { TEMPLATE_SECTIONS, writePage, writeSkill } from "./support/skill-tree.ts";
import type { CheckResult } from "../lib/check-result.ts";
import type { SkillFixture } from "./support/skill-tree.ts";

const fixtures: SkillFixture[] = [];

/**
 * Builds a fixture skill and lints it.
 *
 * @param options - Overrides passed to `writeSkill`.
 * @param releaseVersion - Version the context reports for `@ignifx/core`.
 * @param pages - Extra `references/` pages, keyed by path under the skill directory.
 * @returns The lint result.
 */
function lint(
  options: Parameters<typeof writeSkill>[1] = {},
  releaseVersion = "0.0.0",
  pages: Record<string, string> = {},
): CheckResult {
  const fixture = writeSkill("demo", options, releaseVersion);
  fixtures.push(fixture);
  for (const [relativePath, contents] of Object.entries(pages)) {
    writePage(fixture, relativePath, contents);
  }
  return checkSkillLint(fixture.context, [fixture.root]);
}

/**
 * Joins a result's detail and notes so a test can search all of it at once.
 *
 * @param result - The lint result.
 * @returns One string.
 */
function text(result: CheckResult): string {
  return [result.detail, ...result.notes].join("\n");
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.cleanup();
  }
});

describe("skill-lint: section order", () => {
  it("accepts the template's sections in the template's order", () => {
    expect(lint().status).toBe("pass");
  });

  it("accepts `Gotchas (top N)`", () => {
    const sections = TEMPLATE_SECTIONS.map((section) => (section === "Gotchas" ? "Gotchas (top 12)" : section));
    expect(lint({ sections }).status).toBe("pass");
  });

  it("rejects a section the template does not have", () => {
    const sections = [...TEMPLATE_SECTIONS];
    sections.splice(6, 0, "Building and shipping");
    const result = lint({ sections });
    expect(result.status).toBe("fail");
    expect(text(result)).toContain('"## Building and shipping" is not a template section');
  });

  it("rejects a missing section", () => {
    const result = lint({ sections: TEMPLATE_SECTIONS.filter((section) => section !== "Recipes") });
    expect(result.status).toBe("fail");
    expect(text(result)).toContain('missing the template section "## Recipes"');
  });

  it("rejects the template's sections in the wrong order", () => {
    const sections = TEMPLATE_SECTIONS.filter((section) => section !== "File formats");
    sections.splice(sections.indexOf("Deprecated (current window)"), 0, "File formats");
    const result = lint({ sections });
    expect(result.status).toBe("fail");
    expect(text(result)).toContain("is out of order");
  });
});

describe("skill-lint: the Deprecated section", () => {
  it("accepts one `None` line before 1.0", () => {
    expect(lint({ deprecated: "None (pre-1.0: no deprecation window)." }).status).toBe("pass");
  });

  it("rejects prose about the past before 1.0", () => {
    const result = lint({ deprecated: "`oldThing` is deprecated; use `newThing`." });
    expect(result.status).toBe("fail");
    expect(text(result)).toContain('before 1.0 "## Deprecated (current window)" is one line');
  });

  it("accepts one line per symbol from 1.0 on", () => {
    const deprecated = "- `oldThing` is deprecated; use `newThing`.\n- `Other.go` is deprecated; use `Other.run`.";
    expect(lint({ deprecated }, "1.0.0").status).toBe("pass");
  });

  it("rejects free prose and repeated symbols from 1.0 on", () => {
    const result = lint({ deprecated: "We removed `oldThing` in 0.9 because it was slow." }, "1.0.0");
    expect(result.status).toBe("fail");
    expect(text(result)).toContain("takes one line per symbol");
    const twice = lint({ deprecated: "- `a` is deprecated; use `b`.\n- `a` is deprecated; use `c`." }, "1.0.0");
    expect(twice.status).toBe("fail");
    expect(text(twice)).toContain("is listed twice");
  });
});

describe("skill-lint: docs/migrations pointer", () => {
  it("accepts the one pointer line in a subsystem skill's `Where to look next`", () => {
    const bodies = { "Where to look next": "`docs/migrations/` exists only after 1.0." };
    expect(lint({ bodies }).status).toBe("pass");
  });

  it("rejects a second mention, and a mention in another section", () => {
    const twice = lint({
      bodies: { "Where to look next": "`docs/migrations/` after 1.0.\nAlso see `docs/migrations/`." },
    });
    expect(twice.status).toBe("fail");
    expect(text(twice)).toContain("exactly one pointer line is allowed");

    const elsewhere = lint({ bodies: { Environment: "Upgrades live in `docs/migrations/`." } });
    expect(elsewhere.status).toBe("fail");
    expect(text(elsewhere)).toContain("may only be named by the pointer line");
  });

  it("rejects a mention on a reference page", () => {
    const result = lint({}, "0.0.0", {
      "references/concepts/x.md": "# X\n\nSee `docs/migrations/` for the upgrade.\n",
    });
    expect(result.status).toBe("fail");
    expect(text(result)).toContain("may only be named by the pointer line");
  });
});

describe("skill-lint: time-sensitive phrasing", () => {
  it("rejects each phrase of the list", () => {
    for (const phrase of ["recently", "new in", "now supports", "currently"]) {
      const result = lint({ bodies: { Environment: `The engine ${phrase} does the thing.` } });
      expect(result.status, phrase).toBe("fail");
      expect(text(result)).toContain(`time-sensitive phrasing "${phrase}"`);
    }
  });

  it("accepts a line carrying the allow comment", () => {
    const bodies = { Environment: "The listener enabled most recently wins. <!-- lint-allow: time-phrase -->" };
    expect(lint({ bodies }).status).toBe("pass");
  });

  it("ignores phrasing inside a fenced block", () => {
    const bodies = { Environment: "```ts ignore-check\nconst currently = 1;\n```" };
    expect(lint({ bodies }).status).toBe("pass");
  });
});

describe("skill-lint: exact import paths", () => {
  it("accepts the documented specifiers", () => {
    const bodies = {
      "First app": [
        "```ts",
        'import { createApp } from "@ignifx/core";',
        'import { twoD } from "ignifx";',
        'import { defineConfig } from "vite";',
        'import manifest from "virtual:ignifx/manifest";',
        'import path from "node:path";',
        "```",
      ].join("\n"),
    };
    expect(lint({ bodies }).status).toBe("pass");
  });

  it("rejects a relative import and an unknown package", () => {
    const relative = lint({ bodies: { "First app": '```ts\nimport { Player } from "./player.ts";\n```' } });
    expect(relative.status).toBe("fail");
    expect(text(relative)).toContain('example imports "./player.ts"');

    const unknown = lint({ bodies: { "First app": '```ts\nimport { three } from "three";\n```' } });
    expect(unknown.status).toBe("fail");
    expect(text(unknown)).toContain('example imports "three"');
  });

  it("accepts a block that opted out with `ts ignore-check`", () => {
    const bodies = { "First app": '```ts ignore-check\nimport { Player } from "./player.ts";\n```' };
    expect(lint({ bodies }).status).toBe("pass");
  });
});
