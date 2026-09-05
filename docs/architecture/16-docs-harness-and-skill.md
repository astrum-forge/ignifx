# 16 · Documentation Harness and the Agent Skill

**Status:** Design standard (pre-1.0) · **Governs:** `skills/`, `docs/`, `AGENTS.md`, `CLAUDE.md`, per-package `skills/` · **Related:** `CONSTITUTION.md` Article V, `docs/standards/coding-standards.md` §Documentation

ignifx is agent-first: an AI coding agent must be able to learn the engine from files in the repository or the installed package, without guessing. This document defines those files and the CI harness that keeps them true.

---

## 1. Layout

```
AGENTS.md                              tool-agnostic repo instructions (< 200 lines): commands, conventions, where the docs are
CLAUDE.md                              "@AGENTS.md" + Claude-specific notes only
.claude/skills/ignifx  →  ../../skills/ignifx          (symlink so Claude Code discovers the skill in-repo)
skills/ignifx/
  SKILL.md                             the entry skill (≤ 500 lines): what ignifx is, install, first app, core concepts, recipe index, gotchas, pointers
  references/
    concepts/*.md                      lifecycle, scene-graph, scripting, assets, serialization, extensions (curated, API-level, short)
    api/<package>.md                   GENERATED from .d.ts (TypeDoc markdown), one file per package, public API only, no @deprecated members
    recipes/*.md                       task-oriented, runnable examples ("spawn a prefab", "third-person camera", "tilemap collision")
    formats/*.md                       scene, prefab, material, atlas, tilemap, input, animator — with links to generated JSON Schemas
    gotchas.md                         known traps (mesh removal disposes, unlock audio, WebGPU only, Lite escape hatches are unstable)
  scripts/
    check-webgpu.mjs                   prints WebGPU availability for the current environment
    new-script.mjs                     scaffolds a Script class with schema and typeId
packages/<name>/skills/<name>/SKILL.md subsystem skills (input, physics, physics-2d, audio, 2d, 3d, ui, electron, devtools) following one template, like Phaser's
docs/architecture/*.md                 design standards (human-first; agents read them for "why")
docs/migrations/                       post-1.0 migration guides; NEVER linked from SKILL.md except one pointer line
website/public/llms.txt                index of skill references and formats for agents browsing the site
```

- The umbrella `ignifx` npm package includes `skills/` so `npx skills add astrumforge/ignifx` (Vercel's community CLI) and manual copy into `.claude/skills/` both work; `AGENTS.md` documents both.
- Every skill's frontmatter follows the open Agent Skills spec: `name` (lowercase, hyphens, equals the directory name), `description` (third person, trigger keywords, ≤ 1024 chars), `metadata.ignifx-version`.

## 2. SKILL.md template (entry skill)

1. Frontmatter.
2. **What this is / when to use** (5 lines).
3. **Environment**: engine version, Babylon Lite pinned version, Node/pnpm versions, WebGPU requirement, how to run and test (`pnpm dev`, `pnpm test`, `pnpm typecheck`).
4. **Mental model** (one diagram, ten lines): App → World → Scene → Entity → Component/Script; phases.
5. **First app** (complete, compiling, 30 lines).
6. **Core APIs** in tables: `createApp`, `Entity`, `Transform`, `Script` callbacks with timing, schema kinds, `Assets`, `Signal`.
7. **Recipes index** with one-line descriptions linking to `references/recipes/*.md`.
8. **File formats index** → `references/formats/*.md`.
9. **Gotchas** (top 10; full list in `references/gotchas.md`).
10. **Deprecated (current window only)**: at most one line per symbol: "`X` is deprecated; use `Y`." Nothing else about the past. Empty before 1.0.
11. **Where to look next**: `references/api/*.md`, `docs/architecture/`.

Subsystem skills follow the same order with the subsystem's components, service API, recipes, and gotchas.

## 3. Generation

- `pnpm docs:api` runs TypeDoc (markdown plugin) per package into `skills/ignifx/references/api/<package>.md`, filtered to `@public`/`@beta` members, excluding `@internal` and `@deprecated`. Output is committed; CI regenerates and fails on diff ("docs drift").
- `pnpm docs:schemas` emits `ignifx.schemas.json` (all component schemas + file formats) and the `references/formats/*.md` tables from the same source of truth.
- `pnpm docs:recipes` extracts every recipe from `examples/recipes/<name>/` (real, compiled TypeScript files with a leading doc comment) into `references/recipes/<name>.md`, so recipe text can never disagree with code that compiles.

## 4. Verification (CI job `docs-harness`)

| Check             | Tool                                                                                                                       | Fails when                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regeneration diff | `docs:api`, `docs:schemas`, `docs:recipes`                                                                                 | committed output differs from regenerated output                                                                                                                                                                                                                        |
| Examples compile  | every fenced `ts` block in `skills/**/*.md` is extracted to a temp project referencing the built packages and type-checked | any block fails; blocks may opt out with `ts ignore-check` (rare, justified)                                                                                                                                                                                            |
| Examples run      | blocks tagged `ts run` execute under the headless app in Vitest                                                            | throws                                                                                                                                                                                                                                                                  |
| API report gate   | API Extractor `.api.md` per package                                                                                        | report changed without a changeset of matching level; report changed and no file under `skills/` changed in the PR (override label `docs-not-needed` requires a justification in the PR body)                                                                           |
| Skill lint        | custom script                                                                                                              | SKILL.md > 500 lines; frontmatter invalid; broken relative links; references nested more than one level; mentions of `@deprecated` symbols outside the "Deprecated" section; links into `docs/migrations/` other than the pointer line; stale `metadata.ignifx-version` |
| Freshness         | custom script                                                                                                              | any `references/api/*.md` older than the package's last public change                                                                                                                                                                                                   |

## 5. Authoring rules

- Examples show exact import paths (`import { Script } from "@ignifx/core"`), never pseudo-code.
- One recipe = one task, ≤ 80 lines, runnable in a template.
- Prefer tables for API surfaces and numbered lists for orderings.
- No time-sensitive phrasing ("recently", "new"); versions are stated explicitly.
- Anti-patterns are listed as "do not" with the replacement, so agents do not have to infer.
- Documentation of a feature lands in the same pull request as the feature (`CONSTITUTION.md` §5.2).

## 6. Versioning of the skill

The skill documents the current release. At release time the version pipeline stamps `metadata.ignifx-version` and the environment section. Older skill versions remain available via git tags and the website's versioned docs; they are never mixed into the current skill.
