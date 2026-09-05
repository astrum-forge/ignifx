# ADR-0007 · TypeScript 7 as the compiler, TypeScript 6 aliased for API-dependent tools

**Status:** Accepted · **Date:** 2026-09-05 · **Revisit:** when TypeScript 7.1 ships its programmatic API

## Context

TypeScript 7.0.2 (2026-07-08) is the native Go compiler, 8–12× faster, but ships without the programmatic compiler API that typescript-eslint, TypeDoc, API Extractor, knip, and ts-morph depend on; that API is scheduled for 7.1. Microsoft publishes `@typescript/typescript6` (6.0.x, `tsc6` binary) for side-by-side use. The user asked for the latest TypeScript.

## Options considered

1. **TypeScript 6 everywhere** — everything works. Cons: not the latest; slow builds; must migrate later anyway.
2. **TypeScript 7 everywhere, drop tools that need the API** — fastest. Cons: no type-aware ESLint rules beyond Oxlint's coverage, no TypeDoc, no API Extractor (needed by the constitution's API-report gate).
3. **TypeScript 7 for `tsc`/editor/`tsdown`; `@typescript/typescript6` aliased as `typescript` for API-dependent tools** — Nx's documented recipe; tools resolve the alias transparently.

## Decision

Option 3. Catalog entries: `typescript: npm:@typescript/typescript6@^6.0.2` (the name tools resolve) and `typescript-native: npm:typescript@^7.0.2` (the compiler used by `tsc --build`, editors, and CI type-checks). `tsdown` emits declarations through `isolatedDeclarations` and needs neither. Oxlint + tsgolint provide type-aware linting on the native compiler; ESLint (TS6) covers only gap rules. When 7.1 lands with a stable API, the alias is removed in one pull request.

## Consequences

- Two TypeScript installs in `node_modules` during the transition; documented in `AGENTS.md`.
- Editor experience uses TS 7's language server (VS Code extension).
- API Extractor 7.59 bundles TypeScript 5.9.3 and analyses with that copy regardless of the alias; only TypeDoc, typescript-eslint, dependency-cruiser, and knip actually resolve `typescript` (validated 2026-09-05, see ADR-0009).
- `isolatedDeclarations` constrains public function signatures (explicit return types), which also improves API clarity.
