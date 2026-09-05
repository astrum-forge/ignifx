# ADR-0002 · Adapter boundary around Babylon Lite

**Status:** Accepted · **Date:** 2026-09-05

## Context
Lite publishes a minor version every few days and declares that backward compatibility is not a goal; its docs and `index.d.ts` already disagree in places (`setSubtreeVisible` export name, `createGpuPicker` arity). ignifx must present a stable API to games and agents (`CONSTITUTION.md` §3.4, Article IV).

## Options considered
1. **Use Lite types everywhere** — least code. Cons: every Lite change becomes an ignifx breaking change; agents learn two APIs.
2. **Adapter directory per package (`src/lite/**`) with escape hatches** — Lite imports confined; ignifx types are the public surface; `.lite` accessors exist for power users, marked unstable.
3. **Full abstraction with a renderer interface** — could swap renderers. Cons: heavy, hypothetical; contradicts the WebGPU-only decision.

## Decision
Option 2. Only `src/lite/**` may import `@babylonjs/lite` (lint-enforced). Public ignifx APIs use ignifx types; Lite objects are reachable only through named `.lite` escape hatches with no stability guarantee. Lite is pinned exactly; upgrades are dedicated pull requests that run the adapter compatibility suite and visual tests.

## Consequences
- Some duplication (ignifx math types structurally compatible with Lite's).
- Upgrades are deliberate and testable; breaking Lite changes surface in one directory.
- The adapter is also where Lite gaps are worked around (collision body identities, animation ticking).
