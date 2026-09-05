# ADR-0001 · Babylon Lite as the renderer; WebGPU only

**Status:** Accepted · **Date:** 2026-09-05 · **Deciders:** David Arayan (Astrum Forge Studios)

## Context

ignifx must be a modern, web-first engine for indie 2D/3D games that runs in browsers and Electron. Babylon Lite (`@babylonjs/lite`, 1.27.0) is a WebGPU-exclusive, tree-shakable renderer from the Babylon.js team with pixel parity to Babylon.js, a data-oriented API, and headless support. WebGPU is enabled by default in Chrome/Edge, Safari 26, and Firefox on Windows and Apple Silicon; Electron needs a flag. `CONSTITUTION.md` §1.1 fixes the choice; this ADR records why.

## Options considered

1. **Babylon Lite (WebGPU only)** — smallest bundles, fastest path, active first-party development, headless null engine, physics/audio/text/sprites included. Cons: young API with frequent breaking changes; no WebGL fallback; missing GUI, some shadow types, area lights.
2. **Babylon.js 9 (WebGPU + WebGL2)** — mature and complete. Cons: 19× larger bundles, OOP-heavy API at odds with tree-shaking, slower.
3. **Three.js + WebGPURenderer** — huge ecosystem. Cons: no scene format, physics, audio, or sprites built in; TSL is a moving target; more integration work.
4. **Own renderer on raw WebGPU** — full control. Cons: years of work; out of scope for an indie-focused engine.

## Decision

Build on Babylon Lite and target WebGPU exclusively. There is no WebGL fallback and no plan to add one. Browsers without WebGPU get a static "unsupported" page from templates.

## Consequences

- Bundle size and performance follow Lite's discipline; ignifx inherits its zero-side-effect rules.
- Lite's churn is contained by ADR-0002 (adapter boundary) and an exact version pin.
- Feature gaps (GUI, point-light shadows, particles maturity) are handled by ignifx extensions or upstream contributions; the plan tracks an "upstream" workstream.
- Firefox on Linux/Android and older devices are unsupported until WebGPU ships there.
