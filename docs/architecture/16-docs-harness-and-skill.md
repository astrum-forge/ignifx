# 16 · Documentation Harness and the Agent Skill

**Status:** Implemented; describes the code on `main` · **Governs:** `skills/`, `docs/`, `AGENTS.md`, `CLAUDE.md`, per-package `skills/` · **Related:** `CONSTITUTION.md` §5, `docs/standards/coding-standards.md` §9

ignifx is agent-first: an AI coding agent must be able to learn the engine from files in the repository or the installed package, without guessing. This document defines those files and the CI harness that keeps them true.

**Source map**

- `scripts/docs-harness.ts` — `pnpm docs:harness`: runs the seven checks of §4 and prints one line each.
- `scripts/lib/check-skill-lint.ts`, `scripts/lib/skill-template.ts` — the lint and the ten-section template (§2, §5); `scripts/lib/frontmatter.ts`, `scripts/lib/markdown.ts` — what they parse with.
- `scripts/lib/check-examples.ts`, `scripts/lib/check-examples-run.ts`, `scripts/lib/skill-examples.ts` — example blocks, compiled and run.
- `scripts/lib/check-regeneration.ts` — `regeneration-diff` and `migrations-guard`; `scripts/lib/check-pull-request.ts` — `api-report-gate` and `freshness`.
- `scripts/lib/skill-files.ts` — how skills are found: `skills/<name>/SKILL.md` and each package's `ignifx.skill` manifest entry.
- Generators: `packages/<name>/typedoc*.json` (`pnpm docs:api`), `scripts/docs-schemas.ts`, `scripts/docs-recipes.ts` with `scripts/lib/recipe.ts` (§3); `scripts/sync-skill-versions.ts` with `scripts/lib/skill-version.ts` (§6).
- Where it runs: step `docs-harness` in `scripts/check.ts` (`pnpm check`) and the CI job `docs-harness` in `.github/workflows/ci.yml`.

Invariants to keep:

- Generated pages are written only by their generator and committed; a hand edit fails `regeneration-diff` (§3, §4).
- Every `SKILL.md` has exactly the ten `##` sections of §2, in order. The lint's messages cite §2 and §5 of this document by number.
- Every fenced `ts` block in a hand-written skill page compiles against the built packages unless it is tagged `ts ignore-check` (§4).
- `metadata.ignifx-version` in every skill equals `@ignifx/core`'s version (§4, §6).
- `docs/migrations/` holds only `README.md` while the version is `0.x` (§4).

---

## 1. Layout

```
AGENTS.md                              tool-agnostic repo instructions: commands, conventions, where the docs are
CLAUDE.md                              "@AGENTS.md" + Claude-specific notes only
.claude/skills/ignifx  →  ../../skills/ignifx          (symlink so Claude Code discovers the skill in-repo)
skills/ignifx/
  SKILL.md                             the entry skill (≤ 500 lines): what ignifx is, install, first app, core concepts, recipe index, gotchas, pointers
  references/
    concepts/*.md                      assets, baked-lighting, extensions, lifecycle, platform-and-storage, rendering, scene-graph, scripting (curated, API-level, short)
    api/<entry>.md                     GENERATED from the sources by TypeDoc, one file per package entry point (electron adds electron-main.md and electron-preload.md)
    recipes/*.md                       GENERATED from examples/recipes/<name>/; README.md is the hand-written index
    formats/*.md                       GENERATED field tables (ignifx.*.md, components.md, ignifx.schemas.json) beside hand-written prose pages (scene.md, material.md, inputactions.md, wgsl.md, README.md)
    gotchas.md                         known traps (mesh removal disposes, unlock audio, WebGPU only, Lite escape hatches are unstable)
  scripts/
    check-webgpu.mjs                   prints WebGPU availability for the current environment
    new-script.mjs                     scaffolds a Script class with schema and typeId
packages/<name>/skills/<name>/SKILL.md subsystem skills (2d, 3d, audio, devtools, editor-host, electron, input, particles, particles-2d, physics, physics-2d, terrain, ui) following one template
docs/architecture/*.md                 the design of each engine area, for whoever changes the engine
docs/migrations/                       post-1.0 migration guides; NEVER linked from SKILL.md except one pointer line
```

- The umbrella `ignifx` npm package includes `skills/` so `npx skills add astrum-forge/ignifx` (Vercel's community CLI) and manual copy into `.claude/skills/` both work; `AGENTS.md` documents both.
- Every skill's frontmatter follows the open Agent Skills spec: `name` (lowercase, hyphens, equals the directory name), `description` (third person, trigger keywords, ≤ 1024 chars), `license`, `metadata.ignifx-version`.
- What code enforces and what is convention. Enforced by `skill-lint`: the 500-line cap on every `SKILL.md` (the lint counts the text split on newlines, so a file of 499 lines with a final newline is at the limit), the frontmatter rules, and the ten sections of §2. Enforced by `docs:recipes`: 80 code lines a recipe. Convention only, checked by nothing: the length of `AGENTS.md`, and the per-section lengths §2 suggests. The cap counts lines, not bytes.

## 2. SKILL.md template (entry skill)

Frontmatter, then exactly these ten `##` sections, spelled and ordered as written here — the `skill-lint` check compares heading for heading:

1. **What this is / when to use**, kept short.
2. **Environment**: engine version, Babylon Lite pinned version, Node/pnpm versions, WebGPU requirement, how to run and test (`pnpm dev`, `pnpm test`, `pnpm typecheck`). The line that begins `- Engine: ignifx` carries the version, is rewritten at release (§6) and must keep that shape.
3. **Mental model** (one diagram): App → World → Scene → Entity → Component/Script; phases.
4. **First app** (complete and compiling).
5. **Core APIs** in tables: `createApp`, `Entity`, `Transform`, `Script` callbacks with timing, schema kinds, `Assets`, `Signal`.
6. **Recipes**: one-line descriptions linking to `references/recipes/*.md`.
7. **File formats** → `references/formats/*.md`.
8. **Gotchas**, optionally as `Gotchas (top N)` (full list in `references/gotchas.md`).
9. **Deprecated (current window)**: from 1.0 on, at most one line per symbol, "`X` is deprecated; use `Y`.", and nothing else about the past. Before 1.0 there is no deprecation window, so the section is one line beginning "None".
10. **Where to look next**: `references/api/*.md`, `docs/architecture/`, and the single `docs/migrations/` pointer line.

Subsystem skills use the same ten sections, with the subsystem's components, service API, recipes, and gotchas; they add no `##` section of their own — extra material goes under a `###` heading inside the section it belongs to.

## 3. Generation

- `pnpm docs:api` runs TypeDoc with the markdown plugin in every package (`turbo run docs:api`), once per entry point, into `skills/ignifx/references/api/<entry>.md` (subpath entries get their own page: `electron-main.md`, `electron-preload.md`). Each `packages/<name>/typedoc*.json` excludes `@internal`, private and protected members; nothing filters `@deprecated`, and no public symbol carries it before 1.0. Output is committed; CI regenerates and fails on diff ("docs drift").
- `pnpm docs:schemas` emits `ignifx.schemas.json` (all component schemas + file formats) and the generated `references/formats/*.md` tables from the schemas the built packages export, leaving the hand-written pages in that directory alone.
- `pnpm docs:recipes` extracts every recipe from `examples/recipes/<name>/` (real, compiled TypeScript files with a leading doc comment) into `references/recipes/<name>.md`, so recipe text can never disagree with code that compiles. It writes only those pages, and fails when a recipe has no row in the hand-written `references/recipes/README.md`.
- `llms.txt` is not generated here: the public site lives in `astrum-forge/ignifx-website`, which owns it (ADR-0027).

## 4. Verification (CI job `docs-harness`)

`pnpm docs:harness` runs seven named checks, prints one line for each, and exits 1 if any failed. It runs in the CI job `docs-harness` and as a step of `pnpm check`. The two pull-request checks need `--base <ref>`, which only CI passes; locally they report themselves skipped. `--no-regenerate` skips `regeneration-diff`.

- **`skill-lint`** fails on any of:
  - a `SKILL.md` over 500 lines;
  - frontmatter `name` not lowercase-with-hyphens or not the directory's name; `description` missing, over 1024 characters or starting with a first- or second-person pronoun; `license` missing; `metadata.ignifx-version` not `@ignifx/core`'s version;
  - `##` sections that are not exactly §2's ten, in order (`Gotchas` may carry a ` (top N)` suffix);
  - a "Deprecated (current window)" section that is not one `None …` line before 1.0, or not one `` `X` is deprecated; use `Y`. `` line per symbol after it;
  - a relative Markdown link, in any file of a skill, that does not resolve to a file;
  - `references/` nested more than one directory deep;
  - `@deprecated` mentioned outside a "Deprecated" section;
  - `docs/migrations` named anywhere but once, in a `SKILL.md`'s "Where to look next";
  - the words `recently`, `new in`, `now supports` or `currently` outside code blocks, unless the line carries `<!-- lint-allow: time-phrase -->` because the wording describes runtime behaviour;
  - an example block importing anything other than `ignifx`, `@ignifx/*`, `vite` (or `vite/*`), `virtual:ignifx/*` and `node:*`, unless the block is tagged `ts ignore-check`.

  The `@deprecated`, `docs/migrations` and time-phrase rules skip the generated `references/api/` pages.

- **`examples-compile`**: every fenced block whose info string starts with `ts`, in every hand-written skill file (the generated `references/api/` pages are skipped), is extracted to a throw-away project that references the built packages and type-checked. A block opts out with `ts ignore-check` (rare, justified).
- **`examples-run`**: blocks tagged `ts run` are executed, one `node` process per block, in a throw-away project whose `node_modules/` links `ignifx` and `@ignifx/*` at `packages/<dir>`. It fails when a block exits non-zero or outlives 30 s, naming the Markdown file and the line of the opening fence. A block that needs a DOM, a GPU, or an asset file is never tagged `run`; `scripts/README.md` documents the mechanism.
- **`regeneration-diff`**: runs `docs:api`, `docs:schemas` and `docs:recipes` and fails when any file under `skills/ignifx/references/api`, `references/formats`, `references/recipes` (every `.md` but `README.md`, and every `.json`) or `packages/*/api` differs from what was there before. The CI job follows it with `git diff --exit-code` over the same paths, which catches a generated file that is stale in the commit itself.
- **`migrations-guard`**: while `@ignifx/core` is `0.x`, fails when `docs/migrations/` holds anything but `README.md` (`CONSTITUTION.md` §4.2). The directory not existing passes.
- **`api-report-gate`** (pull requests): when a `packages/*/api/*.api.md` changed against the base, fails unless the diff also holds a `.changeset/*.md` file and a file under `skills/`. It checks that a changeset exists, not its level. The skill half is waived by `--allow-docs-not-needed`, which CI passes when the pull request carries the `docs-not-needed` label; putting the justification in the pull-request body is a convention.
- **`freshness`** (pull requests): fails when an entry point's `api/<entry>.api.md` changed and its own `references/api/<entry>.md` did not. A `src/` change that leaves the public surface identical is not stale: the reference regenerates to the same bytes.

**Agent evaluation** is a practice that has been used on the skill, not a check. A fresh agent was given only the skill and a scaffolded template and asked to build a recipe ("spawn a prefab on click") without reading engine source; every place it had to guess or fall back to source became a documentation fix. Nothing automates it and no gate requires it.

## 5. Authoring rules

- Examples show exact import paths (`import { Script } from "@ignifx/core"`), never pseudo-code. An example imports only `ignifx`, `@ignifx/*`, `vite`, `virtual:ignifx/*` and `node:*` (§4).
- One recipe = one task, ≤ 80 lines, runnable in a template.
- Prefer tables for API surfaces and numbered lists for orderings.
- No time-sensitive phrasing ("recently", "new in", "now supports", "currently"); versions are stated explicitly.
- Anti-patterns are listed as "do not" with the replacement, so agents do not have to infer.
- Documentation of a feature lands in the same pull request as the feature (`CONSTITUTION.md` §5.2).

## 6. Versioning of the skill

The skill documents the current release. At release time `pnpm version-packages` runs `scripts/sync-skill-versions.ts`, which rewrites `metadata.ignifx-version` and the Environment section's `- Engine: ignifx` line in every `SKILL.md`. Older skill versions remain available through git tags and in each published `ignifx` package, which carries the skill of its own version; they are never mixed into the current skill.
