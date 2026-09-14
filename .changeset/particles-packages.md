---
"@ignifx/particles": minor
"@ignifx/particles-2d": minor
"ignifx": minor
---

- Add `@ignifx/particles`: `ParticleSystem` plays `.particles.json` definitions as stateless GPU particles. The vertex shader evaluates each particle from its spawn record and the current time, so the CPU writes only the particles emitted each frame. `play`, `stop`, `pause`, `resume`, `emit(n)`, `simulate(seconds)`, `aliveCount` and `onStopped` control it.
- Add nine presets through `particleDefinition("fire" | "smoke" | "sparks" | "explosion" | "dust" | "sparkle" | "rain" | "snow" | "leaves", overrides?)`.
- Add `app.particles` with `maxParticles`, `qualityScale` and `gravity` (taken from the physics settings when `@ignifx/physics` is registered), plus alive, emitted, upload and draw-call counters in `app.diagnostics`.
- Particles pause exactly with the app, follow `timeScale`, and reproduce for a given `seed`. Collisions, sub-emitters and per-particle sorting are not available: they are not functions of time alone.
- Add `@ignifx/particles-2d`: `ParticleSystem2D` plays the same definitions into a 2D sorting layer through `app.twoD.createSpriteBatch`, sharing the particle budget with the 3D systems.
- The `ignifx` umbrella re-exports both packages.
