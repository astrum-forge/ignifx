# ADR-0014 · Material families are warmed up before the scene is registered

**Status:** Proposed · **Date:** 2026-09-05 · **Deciders:** David Arayan

## Context

Babylon Lite compiles a scene's shader permutations and records its frame graph inside `registerScene` (`lib/scene/scene-core.js`). A mesh added afterwards takes one of two very different paths through `processMaterialSwaps` (`lib/scene/scene-material-swap.js`):

- If a renderable group for the mesh's **material family** already exists on the scene — `group.r`, the group's `rebuildSingle` — the mesh is rebuilt synchronously inside the frame and draws on the next one.
- If it does not, the mesh is handed to `scene-runtime-mesh-build.js`, which dynamically imports a module, runs the group builder from scratch and, for PBR, recompiles every PBR pipeline in the scene (`rebuildScenePbrPipelines(scene, true)`).

"Material family" is coarser than it sounds, and that is the decisive fact: `createPbrMaterial` stamps every PBR material in the process with the **same** `_buildGroup` singleton, and so do the Standard and Shader factories (`lib/material/pbr/pbr-material.js`, `lib/material/standard/create-standard-material.js`, `lib/material/shader/shader-material.js`). Only node materials get a builder per material. So there are four families to worry about, not one per asset.

Spike S2.2 measured the difference on Chromium with the SwiftShader adapter, a 48×48 canvas, MSAA 1, three runs, subtracting the cost of one `captureScreenshot` round trip (ADR-0002, Validation):

| Case                                                        | Extra frames before the mesh is visible |
| ----------------------------------------------------------- | --------------------------------------- |
| PBR box, no PBR mesh existed at `registerScene`             | 3, 3, 3                                 |
| PBR box, PBR family warmed before `registerScene`           | 2, 1, 2                                 |
| PBR box, a PBR mesh was already being drawn                 | 0, 0, 0                                 |
| Standard box, no Standard mesh existed at `registerScene`   | 3, 3, 3                                 |
| Standard box, Standard family warmed before `registerScene` | 1, 1, 1                                 |

Three frames is a visible pop at 60 Hz — a spawned projectile or a picked-up item appearing 50 ms late — and it is a floor, not a ceiling: a bigger shader on a real driver takes longer, and the PBR path recompiles the _whole scene's_ pipelines while it does it.

Lite offers nothing to call instead. There is no compile, precompile, or warm-up entry point in `index.d.ts`, and no public way to await a runtime build either: the queue lives on the private `scene._runtimeBuilds`. `prepareShaderMaterialPipeline` exists but covers `ShaderMaterial` alone.

Constraints that shape the answer: `CONSTITUTION.md` §3.5 (no import-time side effects — a warm-up is something an app does, not something a module does on load), §6.4 and coding standards §7 (frame budgets; a warm-up must not cost anything per frame afterwards), and ADR-0002 (this workaround belongs in `src/lite/**` and nowhere else).

## Options considered

1. **Do nothing; document the pop.** Pros: no code. Cons: every spawn-heavy game hits it, the failure is intermittent and looks like a bug in ignifx, and the PBR path makes it worse the more materials the scene has.
2. **Add every asset's material to the scene before `registerScene`, permanently.** Pros: trivially correct. Cons: a scene that preloads fifty materials pays for fifty renderables it never draws, and the boot group is not the whole game anyway.
3. **Hidden probe meshes, one per material, added before `registerScene`.** A probe is a degenerate triangle with `visible = false`. `addToScene` puts it in its family's group, `registerScene` builds the group, and every later mesh of that family takes the synchronous path. Hiding is enough because `visible` is read when a renderable is drawn, not when it is built (`lib/scene/visibility.js`). Pros: measured to work; costs three vertices per material and nothing per frame. Cons: a Lite-shaped workaround that a future Lite release could make unnecessary.
4. **Wait for an upstream precompile API.** Pros: the right long-term shape. Cons: does not exist, and Phase 2 cannot block on it.

## Decision

Option 3, with the timing fixed by policy rather than left to the caller.

1. `app.start()` collects the materials of every asset in the **`boot` preload group**, calls `warmUpMaterials(engine, scene, materials)` — `packages/core/src/lite/gpu/warm-up.ts` — and only then calls `registerRenderScene`. That is the default, and no game has to ask for it.
2. `app.renderer.warmUp(materials)` exposes the same call for spawn-heavy games that load a material later and want to pay the cost at a moment of their choosing. Called after the scene is registered it still helps — it runs the cold path once, on a mesh nobody can see, instead of on the one the player is looking at.
3. Probes are **kept**, not discarded, for the life of the app. Removing the last mesh of a family does not remove its group from the scene, so discarding would probably be safe; keeping them makes the guarantee independent of Lite's internals for the price of one degenerate triangle per material. `discardMaterialWarmUp` exists for tests and for an app that wants the memory back.
4. One probe per **material**, not per family, even though the family is what Lite keys on. It costs almost nothing, it is exact about which feature permutations get compiled at registration, and it keeps ignifx from depending on a Lite implementation detail that is documented nowhere.

## Consequences

- Boot does a little more work: one tiny mesh per boot material, built and compiled inside `registerScene`, which is already the point where the app waits.
- Materials that appear later in a level still cost a cold family unless the game warms them, so the preload groups in `docs/architecture/05-assets-and-loading.md` become the place where that is decided, and `app.renderer.warmUp` is the escape hatch.
- ignifx now depends on a Lite behaviour that is not in its public contract — that a hidden mesh still forces a group build. The adapter compatibility suite pins it: `warm-up.browser.test.ts` measures frames-to-visible in both directions, so a Lite upgrade that changes the behaviour fails the suite rather than quietly regressing a game.
- Revisit when Lite gains a real precompile API, or when it starts keying renderable groups by something finer than the family; either one turns this into dead code, and the tests that pin it are the ones that will say so.
