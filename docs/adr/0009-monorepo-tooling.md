# ADR-0009 · Monorepo tooling

**Status:** Accepted · **Date:** 2026-09-05 · **Revisit:** quarterly with the toolchain table in the coding standards

## Context
A multi-package TypeScript monorepo with published libraries, templates, examples, benchmarks, a website, and a docs harness, started in September 2026 (see the toolchain research summarized in `docs/standards/coding-standards.md` §1).

## Decision
- **pnpm 11 workspaces** with `catalog:` for shared versions; **Turborepo 2** for task orchestration and caching.
- **tsdown** for library builds (ESM only, `isolatedDeclarations` dts); **Vite 8** for apps, templates, website.
- **Vitest 5** (node + browser/Playwright projects), **Playwright** for visual tests.
- **Oxlint + tsgolint** primary lint; **ESLint 10 + typescript-eslint** (TS6 alias) only for gap and custom rules; **oxfmt** formatting.
- **Changesets** with fixed versioning; **npm Trusted Publishing** (OIDC); **Renovate** for updates; **lefthook** hooks; **commitlint**.
- **API Extractor** reports and **TypeDoc markdown** feeding the Agent Skill.
- **Astro Starlight** is the candidate for a versioned docs site (VitePress 2 is still alpha); the public site stays a plain Vite SPA per the project brief.

## Consequences
- Fast CI (native TS, Rolldown) and reproducible installs.
- Tool churn is expected; the standards table is the single place versions are recorded.
