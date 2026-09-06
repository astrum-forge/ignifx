# AGENTS.md — working in the ignifx repository

ignifx is a TypeScript, WebGPU-only game engine on Babylon Lite for browsers and Electron, by Astrum Forge Studios. This file is the tool-agnostic entry point for AI agents and new contributors; keep it under 200 lines and put detail in the linked documents.

## Read first, in this order

1. `CONSTITUTION.md` — the rules (numbered clauses; cite them).
2. `docs/standards/coding-standards.md` — toolchain, tsconfig, lint, naming, testing, PR rules.
3. `docs/architecture/00-overview.md` then the doc for the area you touch.
4. `docs/plan/engineering-plan.md` — what is being built now and what is out of scope.
5. `skills/ignifx/SKILL.md` — how to _use_ the engine (also available to Claude Code via `.claude/skills/ignifx`).

Precedence when documents conflict: constitution → standards → architecture → ADRs → plan → skill → code comments (`CONSTITUTION.md` §10.1).

## Status

Phases 0–11 of `docs/plan/engineering-plan.md` were delivered on `main` between 2026-09-05 and 2026-09-06; Phase 12 (templates polish, examples gallery, website content, benchmarks) is next. No packages are published. Every `@ignifx/*` package is real: `core` (kernel, rendering, assets, scene format, tweens, platform, storage, hot reload), `vite-plugin` (manifest, sidecars, validation, HMR, `virtual:ignifx/*` with shipped `client` types), `input`, `physics` (Havok), `audio`, `2d`, `physics-2d` (Rapier), `3d`, `ui`, `electron`, `devtools`, `cli` (`create-ignifx`, with `--desktop`), and the `ignifx` umbrella that re-exports all of them. `templates/*` are the four playable templates with desktop variants and visual goldens; `examples/hello-cube` and `examples/gltf-viewer` are real apps; `examples/recipes/*` are the compiled sources behind the skill's recipe pages.

## Commands

Use Node 24 (`.nvmrc`); dependency-cruiser refuses to run on Node 25. `pnpm install` · `pnpm dev` · `pnpm check` (build, then format, lint, typecheck, unit tests, API report, docs harness) · `pnpm test` · `pnpm test:browser` · `pnpm build` · `pnpm pack-check` · `pnpm deps` · `pnpm docs:api` · `pnpm docs:schemas` · `pnpm docs:recipes` · `pnpm docs:llms` · `pnpm docs:harness` · `pnpm changeset`. See `CONTRIBUTING.md`.

## Using the skill

The entry skill is `skills/ignifx/SKILL.md`; subsystem skills sit at `packages/<name>/skills/<name>/SKILL.md`. In this repository Claude Code discovers it through the `.claude/skills/ignifx` symlink. In another project, copy `skills/ignifx/` into `.claude/skills/`, or — once the umbrella is published, which ships `skills/` — run `npx skills add astrum-forge/ignifx`.

## Non-negotiable rules for agents

- Only `src/lite/**` may import `@babylonjs/lite`; expose Lite objects only through documented `.lite` escape hatches.
- No import-time side effects, no decorators, no enums/namespaces, no `any`, no `async` lifecycle callbacks.
- Public API changes ship with TSDoc, regenerated `api/*.api.md`, updated `skills/**`, tests, and a changeset — in the same pull request.
- Never write under `docs/migrations/` while the version is `0.x`; never hand-edit generated files.
- Verify any Babylon Lite claim against the pinned version's `index.d.ts`, not against memory or Lite's prose docs (they disagree in places).
- Run `pnpm check` before opening a pull request and paste the result. Humans approve merges.

## Repository lessons every agent should know

- A package with tests needs `packages/<name>/test/tsconfig.json` (copy `packages/core/test/tsconfig.json`), or the type-aware linter types Node built-ins as `error`.
- The pre-commit hook formats and reports lint; it never auto-fixes, and it skips generator-written template documents. Run `pnpm lint` after committing anyway.
- Never pipe `git commit` through `head`: the hook prints every staged path and an early exit aborts the commit. Commitlint scopes are a fixed list (see `CONTRIBUTING.md`).
- API Extractor's non-local `api-report` fails on warnings; run it, not only `api-report:update`, before claiming a package is green. `pnpm docs:harness` regenerates every generated page in place — use `--no-regenerate` while another agent is editing a package.
- Asset loads awaited before `app.start()` settle as soon as they finish; after `start()` they settle in `PreUpdate`, so a headless test must `app.step()`. Systems keep running while the app is paused with a non-zero `dt`; an animating system checks `time.paused` itself.
- The engine speaks backing-store pixels everywhere (`canvas.width`/`height`): `Camera.worldToScreen`, `pickAsync`, `<Pointer>/position`. DOM code converts.
- Skill examples are compiled by the harness; run yours once in Node before shipping them (the `ts run` tag makes the harness do it).

## Layout

`packages/*` (published `@ignifx/*`), `templates/*`, `examples/*`, `benchmarks/`, `website/` (public site, separate deploy), `docs/`, `skills/`, `tests/visual/`.
