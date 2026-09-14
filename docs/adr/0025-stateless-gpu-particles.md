# ADR-0025 · Particles are stateless: closed-form evaluation on the GPU from CPU-written spawn records

**Status:** Proposed · **Date:** 2026-09-08 · **Deciders:** Astrum Forge Studios

## Context

A particle system is the most-requested missing feature (`website/plan/07-wishlist.md` W-R22). Babylon Lite 1.27.0 has no compute API and exposes no `GPUDevice` (`index.d.ts`; `EngineContext` at 4676), its own node-particle runtime is a CPU structure-of-arrays stepped by JavaScript closures and advanced from Lite's own frame hook (`ParticleSystem` 8034, `registerNodeParticleSet` 9504; its documentation states "Simulation is CPU-only"), and the one upstream pull request heading toward compute (#583) had that half split out at review. What Lite does offer: custom WGSL materials with read-only storage buffers (`createStorageBuffer` 3211, `updateStorageBuffer` 13373, `setShaderStorageBuffer` 10929) and thin instances.

`CONSTITUTION.md` §2.1 requires reproducible simulation under a fixed timestep, §3.8 a headless mode, §2.4 frame and allocation budgets, and `01-lifecycle-and-time.md` §7 exact pause behaviour. The survey (plan §9.1) found that PlayCanvas's "GPU particles" are a ping-pong render-to-texture Euler simulation whose depth sort silently falls back to the CPU, and that Godot's parallel CPU and GPU implementations lost feature parity.

## Options considered

1. **Wrap Lite's node-particle runtime** — CPU-simulated, driven by Lite's clock (violates ADR-0003), tied to Babylon's block set; not GPU-powered.
2. **Ping-pong render-to-texture simulation** (PlayCanvas) — GPU state without compute, but stateful: no exact pause, no headless twin, no determinism guarantee, sorting impossible on the GPU.
3. **Stateless closed-form evaluation** — the CPU writes a spawn record per particle into a ring buffer; the vertex shader reconstructs position, size, colour, rotation and sprite frame from the record and the current time; dead particles collapse. Collisions, sub-emitters and per-particle sorting are impossible; trails are cheap.
4. **Wait for compute** — no date, and the API would change nothing about what a game declares.

## Decision

Option 3, with these rules:

- One **evaluator specification**, implemented once in TypeScript (the 2D renderer and the reference) and once in WGSL (the 3D renderer), with a conformance test across records and times.
- Per-particle randomness from the `pcg3d` integer hash (Jarzynski & Olano 2020), bit-identical in JavaScript and WGSL.
- Closed forms only: gravity and linear drag `p(t) = p₀ + (v₀ − g/k)(1 − e^{−kt})/k + (g/k)t`; orbit as a rotation; noise as a positional offset, never an integrated force; curves and gradients as 64-sample lookup rows read with `textureSampleLevel` in the vertex stage.
- The record is a 48-byte WGSL struct with `@align(16)` members; a test pins the TypeScript writer to the offsets `wgsl_reflect` computes.
- The system's clock advances by `dt` only while the app is not paused; pause and time scale are exact by construction.
- Default blend `premultiplied`; no per-particle depth sorting; `renderOrder` orders systems.
- `@ignifx/particles` imports nothing from Babylon Lite: it is built on core's public shader-material, storage-buffer, texture and instancing API, which is the proof that a third-party extension could do the same (`CONSTITUTION.md` §2.3, §8.1).
- `@ignifx/particles-2d` evaluates the same records on the CPU into a `SpriteBatch`.

## Consequences

- Ten thousand live particles cost the CPU one small buffer upload per frame; headless tests assert the records; determinism follows from the seed.
- Documented limits: no collisions, no sub-emitters, no per-particle sorting, no soft particles in v1 (needs a depth grab). Trails are a v1.1 module.
- If Lite ships compute, a compute evaluator can replace the vertex evaluator behind the same `.particles.json` and `ParticleSystem` API.
- Validation (spike S0.1, 2026-09-08, Apple M1 Metal, 64×64 target, GPU time as `onSubmittedWorkDone` wall time because `gpuFrameTimeMs` reads 0 on Metal): 10,000 instances ≈ 1.1 ms alive / 0.7 ms dead; 100,000 ≈ 2.6 / 2.4 ms; 1,000,000 ≈ 18.8 / 5.2 ms — dead instances are not free, hence the live-tail draw count and the 1,000 default capacity. A 1 KB `updateStorageBuffer` per frame costs about 0.1 ms CPU. Chromium's SwiftShader (CI) needs 150–185 ms per frame at 10,000 instances, so browser tests stay at or below 1,000. The conformance test results are appended when wave 1b lands.
