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

Phases 3 (Input), 4 (3D physics), 5 (Audio), 6 (2D toolkit, 2D physics, 2D templates), 7 (3D toolkit, core tweens, 3D templates), 8 (UI), 9 (platform, storage, Electron, desktop templates), and 10 (devtools, script hot reload) were delivered on 2026-09-06; Phase 11 (docs harness and skill completion) is next. No packages are published. `@ignifx/core` holds the Phase 1 kernel — `createApp`, the extension host, `Time` and the phase scheduler, `World`/`SceneInstance`/`Entity`/`Transform`, `Component`/`Script` with schemas and coroutines, `Signal`, layers, math, the `IGX-####` error space — plus the Phase 2 layer: `Camera`, `Light`, `MeshRenderer`, `Model`, `Environment`, `PostProcessStack` and the Babylon Lite render adapter, `app.renderer` and the `rendering` settings section, `app.assets` with reference-counted handles and the core loaders, the `ignifx.scene` file format with instances and overrides, and `app.events`. `@ignifx/vite-plugin` ships the build-time half: manifest, sidecars, JSON Schema validation, HMR. `@ignifx/input` holds the Phase 3 layer: `app.input` with its devices, action maps, bindings, composites and processors, control schemes, pointer lock and cursor, the `ignifx.inputactions` asset, runtime rebinding, `PlayerInput`, and the headless `simulate` API. The `ignifx` umbrella re-exports the core and input surfaces. `examples/hello-cube` and `examples/gltf-viewer` are real apps; `examples/recipes/*` are the compiled sources behind the skill's recipe pages. Every other `@ignifx/*` package is still an empty skeleton.

## Commands

Use Node 24 (`.nvmrc`); dependency-cruiser refuses to run on Node 25. `pnpm install` · `pnpm dev` · `pnpm check` (format, lint, typecheck, unit tests, API report, docs harness) · `pnpm test` · `pnpm test:browser` · `pnpm build` · `pnpm pack-check` · `pnpm deps` · `pnpm docs:api` · `pnpm docs:schemas` · `pnpm docs:recipes` · `pnpm docs:harness` · `pnpm changeset`. See `CONTRIBUTING.md`.

## Non-negotiable rules for agents

- Only `src/lite/**` may import `@babylonjs/lite`; expose Lite objects only through documented `.lite` escape hatches.
- No import-time side effects, no decorators, no enums/namespaces, no `any`, no `async` lifecycle callbacks.
- Public API changes ship with TSDoc, regenerated `api/*.api.md`, updated `skills/**`, tests, and a changeset — in the same pull request.
- Never write under `docs/migrations/` while the version is `0.x`; never hand-edit generated files.
- Verify any Babylon Lite claim against the pinned version's `index.d.ts`, not against memory or Lite's prose docs (they disagree in places).
- Run `pnpm check` before opening a pull request and paste the result. Humans approve merges.

## Layout

`packages/*` (published `@ignifx/*`), `templates/*`, `examples/*`, `benchmarks/`, `website/` (public site, separate deploy), `docs/`, `skills/`, `tests/visual/`.
