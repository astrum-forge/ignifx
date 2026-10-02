# AGENTS.md — working in the ignifx repository

ignifx is a TypeScript, WebGPU-only game engine on Babylon Lite for browsers and Electron, by Astrum Forge Studios. This file is the tool-agnostic entry point for AI agents and new contributors; keep it under 200 lines and put detail in the linked documents.

## Read what the task needs

Always: this file and `CONSTITUTION.md` (the rules; numbered clauses — cite them). Then only what the change touches:

- Code style, tests, PR rules: the matching section of `docs/standards/coding-standards.md` (§5 language, §10 testing, §11 PRs, §15 finishing).
- An engine area: `docs/architecture/00-overview.md` §2 for the layering, then that area's doc.
- New planned work: the matching plan in `docs/plan/` (`engineering-plan.md` is the delivered 0.x plan — read its scope list, not all of it).
- Usage examples, skill pages, templates: `skills/ignifx/SKILL.md` (also `.claude/skills/ignifx` in Claude Code) and the subsystem skill.

Precedence when documents conflict: constitution → standards → architecture → ADRs → plan → skill → code comments (`CONSTITUTION.md` §10.1).

## Status

Phases 0–12 of the engineering plan and the local half of "Hardening and 1.0" are on `main`, as are custom shaders, `InstancedMeshRenderer`, `SpriteBatch` and the `particles`, `particles-2d` and `terrain` packages (plan `docs/plan/2026-09-terrain-particles-shaders.md`, ADRs 0024–0026). Versions are in each `package.json`; `release.yml` publishes from the "Version Packages" pull request (no provenance while the repository is private — ADR-0009). The scaffolder is `npx @ignifx/cli@latest`; there is no `create-ignifx` package, only the bin of that name. `templates/*` are four playable templates with desktop variants, visual goldens and frame budgets; `examples/*` are real apps and the compiled sources of the skill's recipes; `website/` is the public site (Cloudflare Pages).

## Commands

Use Node 24 (`.nvmrc`); dependency-cruiser refuses to run on Node 25. `CONTRIBUTING.md` lists every command.

The fast loop — run the narrowest check that proves the change, and `pnpm check` once at the end:

| Step                                               | Command                                                                                                        | Cost          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- |
| Build what changed                                 | `pnpm build` (Turborepo; cached packages are skipped)                                                          | ~1 s warm     |
| One package's unit tests                           | `pnpm vitest run --project node packages/<name>` (or one file path)                                            | 1–3 s         |
| All unit tests                                     | `pnpm test` (no coverage)                                                                                      | ~7 s          |
| GPU code                                           | `pnpm vitest run --project browser <file>.browser.test.ts`                                                     | 5–30 s a file |
| Some gate steps                                    | `pnpm check --only lint,typecheck`                                                                             |               |
| The whole gate                                     | `pnpm check` — build, format, lint, typecheck, unit tests with coverage, API report, docs harness, in parallel | ~20 s warm    |
| Only if the change affects rendering or frame time | `pnpm test:visual` / `pnpm test:frame-budget` (`--grep <name>` for one scene; not in CI)                       | minutes       |

`pnpm check` prints one line per step; a failed step prints its log tail and the path of its full log (`node_modules/.cache/ignifx-check/<step>.log`) — read that file rather than re-running with more output. `--full` adds `pack-check`, `perf` and `browser`. Other commands: `pnpm test:coverage` · `pnpm test:perf` (timing, heap and bundle-size budgets; run alone) · `pnpm test:browser` · `pnpm test:frame-budget` · `pnpm pack-check` · `pnpm deps` · `pnpm docs:api` · `pnpm docs:schemas` · `pnpm docs:recipes` · `pnpm docs:llms` · `pnpm docs:harness` · `pnpm changeset` · `pnpm release:verify`. A release runs `pnpm version-packages` — the Changesets version step plus the skill-version and schema regeneration it knows nothing about.

## Using the skill

The entry skill is `skills/ignifx/SKILL.md`; subsystem skills sit at `packages/<name>/skills/<name>/SKILL.md`. In this repository Claude Code discovers it through the `.claude/skills/ignifx` symlink. In another project, copy `skills/ignifx/` into `.claude/skills/`, or — once the umbrella is published, which ships `skills/` — run `npx skills add astrum-forge/ignifx`.

## Non-negotiable rules for agents

- Only `src/lite/**` may import `@babylonjs/lite`; expose Lite objects only through documented `.lite` escape hatches.
- No import-time side effects, no decorators, no enums/namespaces, no `any`, no `async` lifecycle callbacks.
- Public API changes ship with TSDoc, regenerated `api/*.api.md`, updated `skills/**`, tests, and a changeset — in the same pull request.
- Never write under `docs/migrations/` while the version is `0.x`; never hand-edit generated files.
- Verify any Babylon Lite claim against the pinned version's `index.d.ts`, not against memory or Lite's prose docs (they disagree in places).
- Run `pnpm check` before opening a pull request and paste the result. Humans approve merges.
- Follow coding standards §9 for short comments, API docs, and release notes; use `.changeset/README.md` when writing a changeset.

## Repository lessons every agent should know

- A package with tests needs `packages/<name>/test/tsconfig.json` (copy `packages/core/test/tsconfig.json`), or the type-aware linter types Node built-ins as `error`.
- The pre-commit hook formats staged files and fails on lint errors in them; it never auto-fixes, and it skips generator-written template documents. A passing commit prints nothing. Commitlint scopes are a fixed list (`commitlint.config.ts`).
- The `node` Vitest project shares modules between test files: dispose what a test creates, put a file that calls `vi.mock` in `node-isolated` and a wall-clock or heap assertion in `perf` (`vitest.config.ts`).
- API Extractor's non-local `api-report` fails on warnings; run it, not only `api-report:update`, before claiming a package is green. `pnpm docs:harness` regenerates every generated page in place — use `--no-regenerate` while another agent is editing a package.
- Parallel agents: give each a disjoint set of files, and let one of them (or the coordinator) run `pnpm install` and edit root files; concurrent installs race on the lockfile.
- Asset loads awaited before `app.start()` settle as soon as they finish; after `start()` they settle in `PreUpdate`, so a headless test must `app.step()`. Systems keep running while the app is paused with a non-zero `dt`; an animating system checks `time.paused` itself.
- The engine speaks backing-store pixels everywhere (`canvas.width`/`height`): `Camera.worldToScreen`, `pickAsync`, `<Pointer>/position`. DOM code converts.
- Skill examples are compiled by the harness; run yours once in Node before shipping them (the `ts run` tag makes the harness do it).

## Layout

`packages/*` (published `@ignifx/*`), `templates/*`, `examples/*`, `benchmarks/`, `website/` (public site, separate deploy), `docs/`, `skills/`, `tests/visual/`.
