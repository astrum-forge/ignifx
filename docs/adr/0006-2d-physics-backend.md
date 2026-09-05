# ADR-0006 · 2D physics backend

**Status:** Accepted (to be confirmed by the Phase 6 spike) · **Date:** 2026-09-05

## Context

Lite ships Havok (3D). 2D games (platformers, top-down) need 2D bodies, one-way platforms, tile collision, and a kinematic character controller with slopes and step handling. `CONSTITUTION.md` §3.10 requires 2D to be first-class.

## Options considered

1. **Havok 3D constrained to a plane** — one physics engine. Cons: no linear-axis locks in Lite's API, drift correction hacks, no 2D-specific features (one-way platforms, edge chains), heavier.
2. **Rapier 2D (`@dimforge/rapier2d-compat` 0.20, Apache-2.0)** — deterministic across platforms, WASM, TypeScript bindings, built-in kinematic character controller (autostep, slopes, snap-to-ground), sensors, joints, active community.
3. **Box2D v3 WASM (`box2d3-wasm` 5.x, MIT)** — excellent solver. Cons: thinner TS bindings, no built-in character controller, single-maintainer port.
4. **Custom AABB/tile collision only** — tiny. Cons: no rigid bodies; users outgrow it quickly.

## Decision

Rapier 2D behind `@ignifx/physics-2d`, following the stepping model of `docs/architecture/09-physics.md` §1. The Phase 6 spike validates bundle size (inline-WASM `-compat` vs. Vite-served `.wasm`), determinism, and controller behaviour before the API is frozen.

## Consequences

- Two physics WASM modules exist in the ecosystem, but a given game loads only one.
- Both extensions expose the same component vocabulary (`Rigidbody`/`Rigidbody2D`, colliders, `CharacterController`/`CharacterController2D`), so the Agent Skill can document them side by side.
- If the spike fails, option 3 is the fallback with the same public API.
