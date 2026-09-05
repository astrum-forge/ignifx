---
"@ignifx/core": minor
---

Phase 2: the Babylon Lite render adapter

`@ignifx/core` grows the adapter layer the render components sit on (`docs/architecture/07-rendering.md`, ADR-0002 Validation). It is `@internal` throughout — nothing here is public API yet — and it is split in two: `src/lite/**` for the parts the null engine can run (cameras, lights, shadow settings, materials, CPU ray picking, screenshot sampling, feature opt-ins, engine option mapping) and `src/lite/gpu/**` for the parts that need a WebGPU device (meshes, textures, environments, glTF, post-processing, the GPU picker, frame capture, device-loss recovery, shadow generators, material warm-up, GPU timing).

Spikes S2.1–S2.3 are retired with pixel proofs in Chromium: a `FreeCamera` parented under an entity node moves the rendered image with the node, the orthographic toggle and the y-flipping viewport mapping behave as the numeric tests predict, a PCF directional generator darkens the ground where a caster blocks the light, and a forced device loss recovers to a byte-identical frame. S2.2 measured frames-to-visible for a mesh added after `registerScene` — three extra frames for a cold material family, zero to two for a warmed one — which is what ADR-0014 proposes a default warm-up policy for. S2.4's "instancing shares GPU buffers" is proved structurally: clones hold the identical `_gpu` wrapper and bump its reference count.

Two error codes are added: `IGX-0703` (shadows requested from a light kind Lite cannot shadow) and `IGX-0704` (a rendering feature toggled after the scene was registered — Lite accepts a late opt-in silently, so ignifx has to refuse it itself).
