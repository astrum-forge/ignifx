# AGENTS.md — working in the ignifx repository

ignifx is a TypeScript, WebGPU-only game engine on Babylon Lite for browsers and Electron, by Astrum Forge Studios. This file is the tool-agnostic entry point for AI agents and new contributors; keep it under 200 lines and put detail in the linked documents.

## Read first, in this order
1. `CONSTITUTION.md` — the rules (numbered clauses; cite them).
2. `docs/standards/coding-standards.md` — toolchain, tsconfig, lint, naming, testing, PR rules.
3. `docs/architecture/00-overview.md` then the doc for the area you touch.
4. `docs/plan/engineering-plan.md` — what is being built now and what is out of scope.
5. `skills/ignifx/SKILL.md` — how to *use* the engine (also available to Claude Code via `.claude/skills/ignifx`).

Precedence when documents conflict: constitution → standards → architecture → ADRs → plan → skill → code comments (`CONSTITUTION.md` §10.1).

## Status
Planning phase (2026-09). No packages are published yet; Phase 0 of the plan sets up the workspace. Until then there are no build commands; do not invent them.

## Commands (available from Phase 0)
`pnpm install` · `pnpm dev` · `pnpm check` (format, lint, typecheck, unit tests, API report, docs harness) · `pnpm test` · `pnpm test:browser` · `pnpm build` · `pnpm docs:api` · `pnpm changeset`

## Non-negotiable rules for agents
- Only `src/lite/**` may import `@babylonjs/lite`; expose Lite objects only through documented `.lite` escape hatches.
- No import-time side effects, no decorators, no enums/namespaces, no `any`, no `async` lifecycle callbacks.
- Public API changes ship with TSDoc, regenerated `api/*.api.md`, updated `skills/**`, tests, and a changeset — in the same pull request.
- Never write under `docs/migrations/` while the version is `0.x`; never hand-edit generated files.
- Verify any Babylon Lite claim against the pinned version's `index.d.ts`, not against memory or Lite's prose docs (they disagree in places).
- Run `pnpm check` before opening a pull request and paste the result. Humans approve merges.

## Layout
`packages/*` (published `@ignifx/*`), `templates/*`, `examples/*`, `benchmarks/`, `website/` (public site, separate deploy), `docs/`, `skills/`, `tests/visual/`.
