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
- The adapter is also where Lite gaps are worked around (animation ticking, the offscreen render path, mesh teardown).

## Validation

The Lite behaviour the adapter in `packages/core/src/lite/**` is built around. `src/lite/gpu/**` needs a device and is covered by the browser tests; the rest runs on the null engine in the Node tests (`packages/core/test/lite/**`). Each entry was re-read on 2026-11-15 against the pinned Babylon Lite version (`pnpm-workspace.yaml` catalog), in its `index.d.ts` or `lib/` sources, unless it is marked as carried over. No test was re-run for this list.

Test runner

- Browser tests need Playwright's full Chromium (`channel: "chromium"`). The default headless shell loses the WebGPU device after two or three presented frames, with raw WebGPU as well as through Lite. `vitest.config.ts` pins the channel and records the reason. (carried over; not re-checked against the pinned version)

Cameras

- A camera is parentable, and its view matrix is the inverse of its world matrix, cached per `worldMatrixVersion`, so a camera under an entity node follows it with no bookkeeping.
- The projection is reverse-depth: clip depth 1 is the near plane, 0 the far plane.
- `resolveCameraViewport` flips y: the normalized viewport measures it from the bottom, the pixel viewport from the top.
- `enableOrthographicCamera` replaces the bounds object on every call, so the adapter keeps the first one and mutates `halfHeight`.
- The adapter's `screenToRay` unprojects through the inverse view-projection into a caller-owned ray. The pinned version also exports `createPickingRay`, which the adapter does not use.
- Lite's engine and surface options have no `powerPreference`.

Materials and meshes added after `registerScene`

- A scene keys its renderables by a material's build group, and there are four families in the process (PBR, Standard and Shader each share one builder; a node material has its own), not one per material.
- Lite has no compile, precompile or warm-up API. A mesh whose family was not built at registration takes extra frames to appear (three on SwiftShader when measured), which is why ADR-0014 warms families before `registerScene`.
- A hidden mesh still builds its pipelines: `visible` is read when a renderable is drawn, not when it is built. (carried over; not re-checked against the pinned version)

Feature opt-ins, lights and shadows

- Feature opt-ins install a hook or resolver and need no device. Device-loss recovery is the exception: its first registration reads `engine._device.features`.
- A late opt-in neither throws nor takes effect; pipelines already compiled keep their behaviour. ignifx therefore refuses one itself with `IGX-0704`. (carried over; pinned by `render-features.browser.test.ts`, not re-run)
- Only `registerSceneWithShadowSupport` adds the task named `"shadow"`, and nothing public adds it later, so `rendering.features.shadows` is a start-time decision.
- The shadow task finds its work through `light.shadowGenerator`; Lite never adds to `scene.shadowGenerators`. The adapter assigns the former and leaves the array alone.
- Lite has a shadow generator for a directional light (ESM, PCF, CSM) and a spot light (PCF) only; `IGX-0703` reports the rest.
- A light's `direction` is local: the lights buffer and the shadow fit both rotate it by the light's world matrix. ignifx writes world-space values, so a Lite light is never parented; `src/lite/light.ts` poses each one in world space every frame its entity moved.
- A hemispheric light spells its colours `diffuseColor` and `specularColor`; the other kinds use `diffuse` and `specular`.
- Light include and exclude lists are sets of `Mesh.id` strings.

Device loss

- A texture is rebuilt after a loss only if it was created after recovery was enabled, so recovery is enabled before any resource is created. An untextured scene recovers either way. (carried over; pinned by `device-loss.browser.test.ts`, not re-run)
- Forcing a loss with no recovery strategy registered throws.
- Recovery rebuilds ESM and CSM shadow generators only (see ADR-0018).

Instancing and teardown

- `cloneTransformNode` on a mesh gives the clone the same `_gpu` wrapper and bumps its reference count, so every renderer of one asset shares one set of buffers.
- Removing a mesh from its last scene disposes it, and a disposed mesh cannot be added again. The release is deferred to a later GPU drain point, so a test that asserts on a released resource waits for it.
- The adapter frees a template's buffers by adding it to a scene and removing it (`disposeMeshTemplate`). The pinned version also exports `disposeMeshGpu`, which the adapter does not use.
- `removeFromScene` on a mesh removes its children too, so removing a model's root removes the subtree.
- `loadGltf` cannot run on the null engine: it fails with a `TypeError`, not an ignifx error, so the asset layer gates on headlessness itself. (carried over; pinned by `gltf.test.ts`, not re-run)
- A material is plain data plus its build-group function, so it loads completely on the null engine.

Frame graph and post-processing

- The scene's own render task is not reachable: `getFrameGraph` exposes only `build`, `execute` and `dispose`. Post-process tasks are appended with `addTask`, which already runs after the render pass.
- There is no way to remove a frame-graph task. A task is neutralised by clearing `Task.executionEnabled`.
- The swapchain texture cannot be sampled: the canvas context is configured without a `usage`, so it is a render attachment only. Post-processing therefore renders the scene to an offscreen target, which makes `rendering.features.postProcessing` a start-time decision; `IGX-0710` reports a stack attached without it.
- `createImageProcessingTask` always writes to the swapchain, so it can only be the last effect in a chain.
- A render target sized by a surface re-reads the canvas size when the frame graph is rebuilt, so a chain needs no resize handling; a target must be written by an earlier task than the one that reads it.
- Lite's shadow task throws a bare `Error` when a caster's material family is not in the scene yet, so caster lists are rebuilt only in a frame that owes no `rebuildSceneRenderables`. (carried over; not re-checked against the pinned version)
- `captureScreenshot` is served only from inside a rendered frame, so it never settles on the null engine; ignifx rejects with `IGX-0707` instead.
- `Texture2D` has no `dispose`; textures are reference-counted with `acquireTexture` and `releaseTexture`.
- `enableMaterialTracking` is asynchronous, so change tracking is opt-in and the default path is an explicit `markMaterialDirty`.
- A light field written as a plain property (a colour, a range) does not bump Lite's light version; `markLightTransformDirty` re-sets an observable vector to its current value to do so.
