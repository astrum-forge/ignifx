---
"@ignifx/core": minor
"ignifx": minor
---

Phase 2: the render components, the GPU assets, and the rendering settings

`@ignifx/core` grows the public rendering surface `docs/architecture/07-rendering.md` describes, on top of the Phase 2 adapter.

Components: `Camera` (perspective and orthographic, priority-based selection, `screenToRay`/`worldToScreen`), `Light` (directional, point, spot, hemispheric, with the shadow declaration ADR-0002 validated), `MeshRenderer` (a `MeshAsset` plus materials, layers, casting, picking), `Model` (a loaded `ModelAsset` instantiated under the entity, with a node map and `attachToNode`), `Environment` (image-based lighting, skybox, fog, clear colour, tone mapping) and `PostProcessStack` (bloom, SMAA, image processing, recorded as one frame-graph chain).

Assets: `MeshAsset` with the primitive factories, `ModelAsset`, `TextureAsset`, `MaterialAsset` (PBR and Standard, plus the `ignifx.material` file format), `EnvironmentAsset` (plus the `ignifx.environment` description) and `FontAsset`, each behind a GPU loader the core extension registers. `Assets.register` publishes an in-code asset at a `memory:` address so an `asset()` field can hold one without a file, and an `asset()` field now decodes to a **loaded `AssetHandle`** rather than to an address record.

Services and settings: `app.renderer` (screenshots, GPU picking, resolution scale, frame and task timings, the default material), `world.mainCamera`, `world.raycastRender`, the `rendering` settings section (`msaaSamples`, `alphaMode`, `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`, `useFloatingOrigin`, `requiredLimits`, `clearColor`, `brdfLut`, and the `features` opt-ins), the `PreRender` render-sync system, ADR-0014's boot warm-up, and device-loss recovery fanned out to `app.events`.

Five error codes are added: `IGX-0705` (two enabled `Environment` components), `IGX-0706` (no enabled camera), `IGX-0707` (a screenshot was asked for with no render loop running), `IGX-0708` (a material file names a family this build cannot construct) and `IGX-0709` (a file is not the ignifx description format it claims).
