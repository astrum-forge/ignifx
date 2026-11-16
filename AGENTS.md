# AGENTS.md — working in the ignifx repository

ignifx is a TypeScript, WebGPU-only game engine on Babylon Lite for browsers and Electron, by Astrum Forge Studios. This repository holds the 17 published packages (`packages/*`: `@ignifx/*` and the `ignifx` umbrella), four playable templates with desktop variants (`templates/*`), example apps and the compiled sources of the skill's recipes (`examples/*`), `benchmarks/`, `tests/` (visual goldens, template tests, fixtures), `tools/` (the ESLint plugin), `scripts/`, `docs/` and the agent skill (`skills/`). The public site is a separate repository, `astrum-forge/ignifx-website`.

This file is the entry point for AI agents and new contributors. Keep it short; detail lives in the linked documents.

## Read what the task needs

Always: this file and `CONSTITUTION.md` (the rules; cite its numbered clauses, and §10.1 for precedence when documents conflict). Then only what the change touches:

- Code style, tests, pull requests: the matching section of `docs/standards/coding-standards.md` (§5 language, §9 writing, §10 testing, §11 pull requests, §15 finishing).
- An engine area: `docs/architecture/00-overview.md` §2 for the layering, then that area's document. Each architecture document opens with a source map of the files that implement it; start there.
- A design decision: the ADR index in `docs/README.md` says which ADRs bind and what each decides.
- Open work: `docs/plan/engineering-plan.md` (1.0 gates, open items by area, decisions waiting for the owner).
- Using the engine: `skills/ignifx/SKILL.md` (`.claude/skills/ignifx` in Claude Code) and the subsystem skill at `packages/<name>/skills/<name>/SKILL.md`.
- Setup, every command, generated files, adding a package, releases: `CONTRIBUTING.md`.

## Commands

Use Node 24 (CI) or 26; not 25, which dependency-cruiser refuses. Run the narrowest check that proves the change, and `pnpm check` once at the end.

| Step                            | Command                                                                                             | Cost          |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------- |
| Build what changed              | `pnpm build` (Turborepo; cached packages are skipped)                                               | ~1 s warm     |
| One package's unit tests        | `pnpm vitest run --project node packages/<name>` (or one file path)                                 | 1–3 s         |
| All unit tests                  | `pnpm test` (no coverage)                                                                           | ~7 s          |
| GPU code                        | `pnpm vitest run --project browser <file>.browser.test.ts`                                          | 5–30 s a file |
| Some gate steps                 | `pnpm check --only lint,typecheck`                                                                  |               |
| The whole gate                  | `pnpm check`: build, format, lint, typecheck, unit tests with coverage, API report, docs harness    | ~20 s warm    |
| Rendering or frame time changed | `pnpm test:visual`, `pnpm test:frame-budget`, `pnpm test:gpu-budget` (`--grep <name>`; never in CI) | minutes       |

`pnpm check` prints one line per step. A failed step prints its log tail and the path of its full log (`node_modules/.cache/ignifx-check/<step>.log`); read that file rather than re-running with more output.

## Rules

- Only `src/lite/**` may import `@babylonjs/lite`; expose Lite objects only through documented `.lite` escape hatches.
- No import-time side effects, no decorators, no enums or namespaces, no `any`, no `async` lifecycle callbacks.
- A public API change ships with TSDoc, regenerated `api/*.api.md`, updated `skills/**`, tests and a changeset (`.changeset/README.md`), in the same pull request.
- Never write under `docs/migrations/` while the version is `0.x`. Never hand-edit generated files (`CONTRIBUTING.md` lists them).
- Verify any Babylon Lite claim against the pinned version's `index.d.ts`, not against memory or Lite's prose docs; they disagree in places.
- Never publish by hand. Releases go through `release.yml`; each package's `prepublishOnly` refuses anything but `pnpm publish`, because `npm publish` ships `workspace:` and `catalog:` dependencies nobody can install.
- Run `pnpm check` before opening a pull request and paste the result. A human approves every merge.
- Documents describe the current state: no phase numbers, task ids or change history. Open work goes in `docs/plan/engineering-plan.md`, the reasons for a decision in an ADR.
- Comments, API docs and release notes follow coding standards §9.

## Lessons

- A package with tests needs `packages/<name>/test/tsconfig.json` (copy `packages/core/test/tsconfig.json`), or the type-aware linter types Node built-ins as `error`.
- The pre-commit hook formats staged files and fails on lint errors in them. It never fixes lint, and it skips generator-written files. A passing commit prints nothing. Commit scopes are a fixed list (`commitlint.config.ts`).
- The `node` Vitest project shares modules between test files: dispose what a test creates, put a file that calls `vi.mock` in `node-isolated`, and a wall-clock or heap assertion in `perf` (`vitest.config.ts`).
- API Extractor's `api-report` fails on warnings; run it, not only `api-report:update`, before calling a package green.
- `pnpm docs:harness` regenerates every generated page in place; use `--no-regenerate` while another agent is editing a package.
- Parallel agents: give each a disjoint set of files, and let one of them run `pnpm install` and edit root files; concurrent installs race on the lockfile.
- An asset load awaited before `app.start()` settles as soon as it finishes; after `start()` it settles in `PreUpdate`, so a headless test must `app.step()`.
- Systems keep running while the app is paused, with a non-zero `dt`; an animating system checks `time.paused` itself.
- The engine speaks backing-store pixels (`canvas.width`, `canvas.height`) everywhere: `Camera.worldToScreen`, `pickAsync`, `<Pointer>/position`. DOM code converts (× `canvas.width / canvas.clientWidth`). Lite's picker takes CSS pixels, and `src/lite/gpu/picker.ts` converts for it.
- Skill examples are compiled by the harness; run yours once in Node before shipping it (the `ts run` tag makes the harness do it).
- The scaffolder is the `create-ignifx` executable of `@ignifx/cli`: `npx --package=@ignifx/cli create-ignifx <dir>`. There is no `create-ignifx` package, and `npx @ignifx/cli <dir>` cannot pick between the package's two executables.
