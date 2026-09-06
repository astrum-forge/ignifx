/**
 * Fixture helpers for the documentation-harness tests: throw-away skill trees the checks can be
 * pointed at, the way `docs-harness.ts --skills-dir <dir>` points at one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HarnessContext } from "../../lib/check-result.ts";
import type { SkillRoot } from "../../lib/skill-files.ts";

/** The repository this test run lives in (this file sits at `scripts/test/support/`). */
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The `##` sections a valid `SKILL.md` carries, in order. */
export const TEMPLATE_SECTIONS = [
  "What this is / when to use",
  "Environment",
  "Mental model",
  "First app",
  "Core APIs",
  "Recipes",
  "File formats",
  "Gotchas",
  "Deprecated (current window)",
  "Where to look next",
];

/** What {@link writeSkill} may override in the fixture. */
export interface SkillOptions {
  /** Section headings to emit, in order; defaults to {@link TEMPLATE_SECTIONS}. */
  readonly sections?: readonly string[];
  /** Body appended under each section, keyed by section heading. */
  readonly bodies?: Readonly<Record<string, string>>;
  /** Replaces the whole "Deprecated (current window)" body. */
  readonly deprecated?: string;
}

/** A fixture tree plus the arguments a check needs to inspect it. */
export interface SkillFixture {
  /** Absolute path to the throw-away directory holding `<name>/SKILL.md`. */
  readonly directory: string;
  /** The skill the checks are given. */
  readonly root: SkillRoot;
  /** A context whose `skillsDirectory` is the fixture. */
  readonly context: HarnessContext;
  /** Deletes the fixture. */
  readonly cleanup: () => void;
}

/**
 * Writes a complete, valid `SKILL.md` unless the options say otherwise.
 *
 * @param name - Skill name, which is also the directory name.
 * @param options - Overrides for the sections and their bodies.
 * @param releaseVersion - Version the context reports for `@ignifx/core`.
 * @returns The fixture.
 */
export function writeSkill(name: string, options: SkillOptions = {}, releaseVersion = "0.0.0"): SkillFixture {
  const directory = mkdtempSync(path.join(tmpdir(), "ignifx-skill-fixture-"));
  const skillDirectory = path.join(directory, name);
  mkdirSync(skillDirectory, { recursive: true });
  const sections = options.sections ?? TEMPLATE_SECTIONS;
  const body = sections
    .map((section) => {
      if (section.startsWith("Deprecated")) {
        return `## ${section}\n\n${options.deprecated ?? "None (pre-1.0: no deprecation window)."}\n`;
      }
      const extra = options.bodies?.[section] ?? "Prose about this section.";
      return `## ${section}\n\n${extra}\n`;
    })
    .join("\n");
  const source =
    "---\n" +
    `name: ${name}\n` +
    `description: Does something for an ignifx game. Use when the user mentions ${name}.\n` +
    "license: Apache-2.0\n" +
    "metadata:\n" +
    `  ignifx-version: "${releaseVersion === "0.0.0" ? "0.0.0-unreleased" : releaseVersion}"\n` +
    "---\n\n" +
    `# ${name}\n\n${body}`;
  const skillFile = path.join(skillDirectory, "SKILL.md");
  writeFileSync(skillFile, source, "utf8");
  const root: SkillRoot = { directory: skillDirectory, skillFile, name, label: `${name}/SKILL.md` };
  return {
    directory,
    root,
    context: {
      repositoryRoot: REPOSITORY_ROOT,
      skillsDirectory: directory,
      releaseVersion,
      base: null,
      allowDocsNotNeeded: false,
    },
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Adds a page under the fixture skill's `references/`.
 *
 * @param fixture - The fixture to add to.
 * @param relativePath - Path under the skill directory, for example `references/concepts/x.md`.
 * @param contents - File contents.
 */
export function writePage(fixture: SkillFixture, relativePath: string, contents: string): void {
  const file = path.join(fixture.root.directory, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}
