# 04 · The examples platform and catalogue

The examples are the site's proof. This document specifies how they are built, embedded, sourced,
licensed and captured, and it lists every example to develop with an honest status against the engine
as it stands on 2026-09-07.

## 1. Lessons taken from threejs.org/examples

**Copied.**

- A gallery of real captures, filterable by tag, where every tile is a runnable page.
- The example runs in place, full width, and is also a standalone URL you can share or open in a new
  tab.
- The source is one click away, and it is the _same file_ that runs, not a simplified transcript.
- A shared kit (orbit camera, parameter panel, stats) so examples look and behave alike and each one
  is short.
- Consistent naming: `<category>-<subject>`, so the URL tells you what you will see.

**Not copied.**

- Hundreds of examples. The catalogue below has about sixty, and launch needs sixteen. Fewer,
  finished, captured and tested beats many.
- External assets fetched at runtime. Every model, texture, environment and sound is on the site's
  own origin (`CONSTITUTION.md` §9.1), vendored with its licence.
- A visual style per example. Every example uses the kit's panel, the site's fonts, and the same
  fallback panel when WebGPU is missing.
- Running canvases on the index page. The index shows posters; one example runs at a time.

## 2. Where examples live and how they build

```
website/
  examples/
    catalogue.ts               the manifest: slug, title, category, copy, uses, assets, status, order
    _kit/                      shared runtime: boot, fallback, orbit camera, panel, stats, bridge, css
    assets/                    vendored sample assets + ATTRIBUTION.md + manifest of SHA-256 digests
    <slug>/
      index.html               minimal: <canvas>, the kit css, <script type="module" src="./main.ts">
      main.ts                  the example; the file the source pane shows
      *.json                   any scene, material, input or animator document the example loads
    vite.config.ts             one multi-page Vite build over every <slug>/index.html
  public/examples/<slug>.{png,webp,avif}   committed posters, 1280×720
```

- **One Vite build for all examples**, using `ignifx()` from `@ignifx/vite-plugin` with `assetRoot`
  at `website/examples/assets/`. Rollup shares chunks, so Babylon Lite is downloaded once per site
  deploy and reused by every example the visitor opens.
- Output goes to `website/dist/examples/<slug>/run/` before the site plugin writes its pages, so
  `/examples/<slug>/run/` is a real file and the viewer page can iframe it.
- The website package now depends on the workspace (`ignifx`, `@ignifx/vite-plugin`,
  `@ignifx/devtools` as `workspace:*`). The Cloudflare build command becomes
  `pnpm turbo run build --filter=@ignifx/website...`, which builds the packages first. This is the
  one change to ADR-0019 (`06-engineering.md` §2).
- The site plugin reads `catalogue.ts` and **fails the build** if a listed slug has no directory, no
  `main.ts`, no poster, or a status that is not `ready`.
- 2D examples pull Rapier (about 800 KB gzipped, inlined). Load it with a dynamic import from the kit
  so 3D examples never pay for it; this is the follow-up the engineering plan already records.

## 3. The viewer

The viewer page (`/examples/<slug>/`) is a normal prerendered page. It contains:

1. **The frame.** `<iframe src="/examples/<slug>/run/" title="Interactive example: <title>"
loading="eager" allow="fullscreen; gamepad; pointer-lock">` inside a 16:9 box with the poster
   as its background until the frame reports ready.
2. **The toolbar.** Play/Pause (sends `ignifx:pause` / `ignifx:resume`), Fullscreen
   (`iframe.requestFullscreen()`), Open standalone (a link), a devtools hint, and the live figures.
3. **The source pane.** Tabs for `main.ts` and any JSON the example ships, highlighted with Shiki at
   build time from the same files that were bundled. "View on GitHub" links to
   `https://github.com/astrum-forge/ignifx/blob/main/website/examples/<slug>/main.ts`. "Copy" copies
   the active tab.
4. **The footer.** Components used, assets with licences, previous and next in catalogue order.

The parameter panel is **inside the frame**: it is part of the example, built with the kit, so the
example is complete when opened standalone and the viewer has no per-example code.

### Bridge protocol (same origin, `postMessage`)

| Direction      | Message                                                  | When                                                                   |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| frame → viewer | `{ type: "ignifx:ready" }`                               | `app.start()` resolved and one frame drew                              |
| frame → viewer | `{ type: "ignifx:stats", frameMs, drawCalls }`           | Every 500 ms while running                                             |
| frame → viewer | `{ type: "ignifx:unsupported", code: "IGX-0701" }`       | WebGPU missing; the viewer keeps the poster and shows the support pill |
| viewer → frame | `{ type: "ignifx:pause" }` / `{ type: "ignifx:resume" }` | Toolbar, and automatically when the tab is hidden                      |

### Query flags every example honours (from the kit)

`?static=1` freezes time after the first frame for captures; `?seed=<n>` seeds anything random;
`?nopanel=1` hides the panel (used for posters); `?autoplay=0` waits for a click (used when
`prefers-reduced-motion` is set).

## 4. The shared kit `website/examples/_kit/`

| Module        | Provides                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `boot.ts`     | `bootExample({ title, extensions, settings, setup })`: finds the canvas, calls `createApp`, adds `devtools()`, catches `IGX-0701` and renders the fallback panel, posts `ready`, `stats`, handles `pause`/`resume`, reads the query flags. |
| `orbit.ts`    | `OrbitCamera` script on `@ignifx/input` actions (drag, wheel, touch pinch, right-stick), with damping, limits, and a `frame(bounds)` helper.                                                                                               |
| `panel.ts`    | A parameter panel: `slider`, `toggle`, `select`, `button`, `color`, `readout`, grouped and collapsible, built on `@ignifx/ui`'s overlay so it scales and routes focus correctly.                                                           |
| `stage.ts`    | Common scene dressings: a ground plane with a grid material, a three-point light rig, an environment loader that picks `.env` by name.                                                                                                     |
| `bridge.ts`   | The `postMessage` protocol above, plus `document.visibilityState` handling.                                                                                                                                                                |
| `fallback.ts` | The "WebGPU is not available" panel with the link to `/docs/browser-support/`.                                                                                                                                                             |
| `kit.css`     | Canvas fill, panel styling in the site's tokens, fallback panel.                                                                                                                                                                           |

The kit is the only place an example touches the DOM directly. Everything else is engine API, which is
the point: a visitor reading `main.ts` should see ignifx, not glue.

## 5. Assets: sources, licences, pipeline

### 5.1 Rules

1. **CC0 or CC-BY only.** No NonCommercial, no NoDerivatives, no bespoke licences. The Khronos
   _DamagedHelmet_ is CC-BY-NC 4.0 and the _Duck_ is under the SCEA Shared Source licence; neither may
   be used, however familiar they are.
2. **Confirm the licence from the asset's own `README.md` or `metadata.json` at download time**, and
   record it. The table in §5.3 is the plan's best knowledge, not the record.
3. **Every asset is listed in `website/examples/assets/ATTRIBUTION.md`** in the format
   `tests/fixtures/assets/ATTRIBUTION.md` already uses: what it is, licence, copyright line, source
   URL, SHA-256. The site renders that file as `/examples/attribution/`, and every example page
   footer names its assets.
4. **Size caps.** 4 MB per file, 48 MB for all example assets at launch. Cloudflare Pages refuses
   files over 25 MiB and a site over 20,000 files. Assets are **committed**, not fetched at build
   time, so a build never depends on a third party being up.
5. **Compress before committing.** Run models through `gltf-transform` to resample animations, weld
   and quantize geometry, and encode textures to KTX2 (`KHR_texture_basisu`, which Babylon Lite
   lists and the engine's texture loader accepts). Convert HDRIs to Babylon's prefiltered `.env`
   (the repository's `studio.env` is 205 KB). Keep the command in `assets/README.md` so a
   re-encode is reproducible.

### 5.2 Sources

| Source                                                    | Licence    | Used for                                            |
| --------------------------------------------------------- | ---------- | --------------------------------------------------- |
| KhronosGroup/glTF-Sample-Assets                           | per model  | PBR models, material extension tests, skins, morphs |
| Poly Haven (polyhaven.com)                                | CC0        | HDRIs → `.env` environments                         |
| Kenney (kenney.nl)                                        | CC0        | 2D sprites, tilesets, UI sounds, impacts            |
| The repository's own synthesised art, audio and rigs      | Apache-2.0 | Anything the templates already use                  |
| JetBrains Mono / Public Sans / Archivo (already vendored) | OFL-1.1    | `WorldText` and `HudText` fonts                     |

### 5.3 Candidate models (verify licence and size at download)

| Model                                | Expected licence          | Why it is on the list                                                       |
| ------------------------------------ | ------------------------- | --------------------------------------------------------------------------- |
| Corset                               | CC0 (Microsoft)           | Hero candidate: cloth, metal, fine normal maps, small                       |
| BoomBox                              | CC0 (Microsoft)           | Hero candidate: metal, plastic, emissive; needs KTX2 to fit the cap         |
| Avocado, WaterBottle, Lantern        | CC0 (Microsoft)           | Clean PBR objects for the material and lighting examples                    |
| SciFiHelmet                          | CC0 (Michael Pavlovich)   | The hero if it fits after KTX2; otherwise P1                                |
| MetalRoughSpheres                    | CC0 / CC-BY (verify)      | The canonical roughness × metallic grid                                     |
| ClearCoatTest                        | CC0 (Analytical Graphics) | `KHR_materials_clearcoat`                                                   |
| SheenChair                           | CC-BY 4.0 (Wayfair)       | `KHR_materials_sheen`                                                       |
| IridescenceLamp                      | CC-BY 4.0 (Wayfair)       | `KHR_materials_iridescence`                                                 |
| AnisotropyBarnLamp                   | CC-BY 4.0 (Wayfair)       | `KHR_materials_anisotropy`                                                  |
| TransmissionTest / DragonAttenuation | CC-BY 4.0                 | `KHR_materials_transmission` and `volume`                                   |
| EmissiveStrengthTest                 | CC0                       | `KHR_materials_emissive_strength`, the bloom example's model                |
| TextureTransformTest, UnlitTest      | CC0 / CC-BY               | `KHR_texture_transform`, `KHR_materials_unlit`                              |
| Fox                                  | CC0 model, CC-BY rig      | Skinned animation with three clips; the Animator example                    |
| CesiumMan, BrainStem                 | CC-BY 4.0                 | Skinning stress and a humanoid                                              |
| AnimatedMorphCube, MorphStressTest   | CC-BY 4.0                 | Morph targets                                                               |
| Box, BoxTextured, BoxVertexColors    | CC-BY 4.0 (Cesium)        | Already vendored; the smallest real glTF                                    |
| ABeautifulGame                       | CC-BY 4.0 (Wayfair)       | P2: a showpiece with transmission; ~30 MB, only after KTX2 and a cap review |

## 6. Capture, quality gates and performance

- **Posters** come from a new `tests/visual/tests/examples.spec.ts` that opens every
  `/examples/<slug>/run/?static=1&nopanel=1&seed=1` at 1280×720 and writes
  `website/public/examples/<slug>.png`; a local script derives WebP and AVIF. The same capture is a
  golden with a per-example tolerance, so a broken example fails CI before it reaches the site.
- **Frame budget.** Every example must render under 4 ms median on the CI GPU at 1280×720, asserted
  like the templates in `benchmarks/template-frame-time.test.ts`. Heavier examples say so on the
  page ("This example is deliberately heavy").
- **Bundle budget.** An example's own chunk (excluding the shared vendor chunks) is under 60 KB
  gzipped. Vendor chunks are content-hashed and immutable.
- **Load behaviour.** The viewer page loads its iframe eagerly; the index loads nothing. A hidden tab
  pauses the frame. Reduced-motion visitors get the poster and a Play button.
- **Accessibility.** Every frame has a title; the panel is keyboard-operable; a paused example is
  announced.

## 7. The catalogue

Status key:

- **ready** — the engine API exists today; build it.
- **verify** — expected to work through Babylon Lite's loader or an existing component, but no test
  exercises it yet; build it, and add the engine test.
- **engine** — Babylon Lite 1.27.0 has the capability and ignifx does not expose it; needs an engine
  change first (§8).
- **lite** — not in Babylon Lite 1.27.0; cannot be built without upstream work. Listed so nobody
  promises it.

Priority: **P0** launch set (16), **P1** first month, **P2** later.

### 7.1 Basics

| Slug                | Title                    | One line                                                                                       | Shows                                                           | Assets | Status | Pri |
| ------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ | ------ | --- |
| `hello-cube`        | Hello cube               | The smallest complete app: light, ground, spinning cube.                                       | `createApp`, `Camera`, `Light`, `MeshRenderer`, `Script.define` | none   | ready  | P0  |
| `cameras`           | Cameras                  | Perspective and orthographic, field of view, priority switching.                               | `Camera` fields, `world.mainCamera`                             | none   | ready  | P1  |
| `transforms`        | Transforms and hierarchy | Parenting, local versus world, `lookAt`, a solar system.                                       | `Transform`, `setParent`                                        | none   | ready  | P1  |
| `lifecycle`         | Lifecycle                | Watch `awake`, `start`, `fixedUpdate`, `update`, `lateUpdate` fire, with time scale and pause. | `Script` callbacks, `app.time`                                  | none   | ready  | P1  |
| `coroutines-tweens` | Coroutines and tweens    | A sequence written as a generator; a tween on the game clock.                                  | `startCoroutine`, `app.tweens`                                  | none   | ready  | P1  |
| `signals`           | Signals                  | Owner-scoped connections that disconnect when a script dies.                                   | `Signal`, `app.events`                                          | none   | ready  | P2  |
| `custom-geometry`   | Custom geometry          | A procedural mesh from vertex data.                                                            | `MeshAsset.fromData`                                            | none   | ready  | P2  |
| `primitives`        | Primitives               | Sphere, capsule, cylinder, torus, plane from factories.                                        | new `MeshAsset` factories                                       | none   | engine | P1  |

### 7.2 Models and materials

| Slug                    | Title                      | One line                                                                             | Shows                                          | Assets                                                                                                 | Status | Pri |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ | --- |
| `pbr-model`             | Physically based rendering | **The hero.** A glTF model, image-based lighting, bloom, tone mapping, orbit.        | `Model`, `Environment`, `PostProcessStack`     | Corset or BoomBox, Poly Haven `.env`                                                                   | ready  | P0  |
| `model-loading`         | Model loading              | Load, show progress, swap between models, release handles.                           | `app.assets.load`, `AssetHandle`, `Model`      | three small models                                                                                     | ready  | P0  |
| `material-grid`         | Roughness and metalness    | The classic sphere grid, from code, live sliders.                                    | `pbrMaterialDefinition`, `createMaterialAsset` | MetalRoughSpheres or generated                                                                         | ready  | P0  |
| `material-overrides`    | Material overrides         | Replace a glTF material by name at runtime.                                          | `Model.materialOverrides`                      | Avocado                                                                                                | ready  | P1  |
| `unlit-and-transparent` | Unlit and transparency     | Unlit materials, alpha modes, render order.                                          | material `alphaMode`, `renderOrder`            | UnlitTest                                                                                              | verify | P1  |
| `gltf-extensions`       | glTF material extensions   | Clear coat, sheen, iridescence, anisotropy, transmission, volume, emissive strength. | Babylon Lite's glTF loader via `Model`         | ClearCoatTest, SheenChair, IridescenceLamp, AnisotropyBarnLamp, TransmissionTest, EmissiveStrengthTest | verify | P1  |
| `texture-formats`       | Texture formats            | PNG, WebP and KTX2 side by side with sizes and decode times.                         | texture loader                                 | BoxTextured variants                                                                                   | verify | P2  |
| `skinned-animation`     | Skinned animation          | A rigged glTF with clips; scrub, blend, change speed.                                | `Model` + `Animator`, `features.skeletons`     | Fox                                                                                                    | ready  | P0  |
| `morph-targets`         | Morph targets              | Blend shapes driven from a slider.                                                   | Lite morph targets through `Model`             | AnimatedMorphCube                                                                                      | engine | P2  |
| `node-attachment`       | Attach to a node           | Weld a prop to a hand bone.                                                          | `Model.attachToNode`                           | Fox + a prop                                                                                           | ready  | P1  |
| `lod`                   | Level of detail            | Three meshes swap by distance; fly the camera.                                       | `LodGroup`                                     | generated                                                                                              | ready  | P2  |
| `billboards`            | Billboards                 | Sprites that face the camera in a 3D scene.                                          | `Billboard`                                    | generated                                                                                              | ready  | P2  |
| `gaussian-splats`       | Gaussian splatting         | A `.splat` scene.                                                                    | Lite `loadSplat`                               | a CC0 splat                                                                                            | engine | P2  |

### 7.3 Lighting and environment

| Slug           | Title                     | One line                                                           | Shows                                       | Assets             | Status | Pri |
| -------------- | ------------------------- | ------------------------------------------------------------------ | ------------------------------------------- | ------------------ | ------ | --- |
| `lights`       | Light types               | Directional, point, spot and hemispheric, each with a gizmo.       | `Light`                                     | none               | ready  | P0  |
| `shadows`      | Shadows                   | PCF versus ESM, map size, bias, cascades, moving casters.          | `Light.shadows`, `features.shadows`         | Lantern            | ready  | P0  |
| `ibl`          | Image-based lighting      | Switch environments, rotate, blur the reflections.                 | `Environment`                               | three `.env` files | ready  | P0  |
| `skybox-fog`   | Skybox and fog            | Linear and exponential fog against a skybox.                       | `Environment.skybox`, `Environment.fog`     | one `.env`         | ready  | P1  |
| `tone-mapping` | Tone mapping and exposure | Standard, ACES and Neutral with exposure and contrast, split view. | `Environment.imageProcessing`               | Corset             | ready  | P0  |
| `light-masks`  | Light include and exclude | Which lights touch which meshes.                                   | `Light.includeOnly`, `Light.exclude`        | none               | ready  | P2  |
| `device-loss`  | Device loss recovery      | Simulate a lost GPU device and watch the scene come back.          | `features.deviceLostRecovery`, `app.events` | none               | engine | P2  |

### 7.4 Post-processing

| Slug                    | Title                            | One line                                                                                                                                | Shows                                                     | Assets               | Status | Pri |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------- | ------ | --- |
| `bloom`                 | Bloom                            | Emissive surfaces bleed light; threshold, weight, kernel, scale.                                                                        | `PostProcessStack.bloom`, `features.postProcessing`       | EmissiveStrengthTest | ready  | P0  |
| `anti-aliasing`         | Anti-aliasing                    | None, MSAA ×4 and SMAA on thin geometry, with a magnifier.                                                                              | `msaaSamples`, `PostProcessStack.smaa`                    | generated            | ready  | P1  |
| `image-processing-pass` | Grading as a pass                | Exposure and contrast as a post pass versus the environment path.                                                                       | `PostProcessStack.imageProcessing`                        | Corset               | ready  | P2  |
| `post-stack`            | The full stack                   | Bloom, SMAA and grading together, toggled one by one.                                                                                   | `PostProcessStack`                                        | Corset               | ready  | P1  |
| `depth-of-field`        | Depth of field                   | Focus distance and aperture.                                                                                                            | Lite `createDepthOfFieldPostProcessTask`                  | Corset               | engine | P1  |
| `chromatic-aberration`  | Chromatic aberration             | Lens fringing with strength and centre.                                                                                                 | Lite `createChromaticAberrationPostProcessTask`           | any                  | engine | P2  |
| `taa`                   | Temporal anti-aliasing           | TAA against MSAA on a moving camera.                                                                                                    | Lite `createTaaPostProcessTask`                           | any                  | engine | P2  |
| `contact-shadows`       | Screen-space contact shadows     | Small-scale contact darkening.                                                                                                          | Lite `createScreenSpaceContactShadowsPostProcessTask`     | any                  | engine | P2  |
| `ssgi`                  | Screen-space global illumination | Indirect light bounce, toggled.                                                                                                         | Lite `createScreenSpaceGlobalIlluminationPostProcessTask` | any                  | engine | P2  |
| `ssao`                  | Ambient occlusion                | _Wishlist._ Babylon Lite 1.27.0 has no SSAO; see `07-wishlist.md` W-R4. The nearest shipped effects are contact shadows and SSGI above. | —                                                         | —                    | lite   | —   |

### 7.5 Rendering techniques

| Slug            | Title             | One line                                                       | Shows                                                | Assets | Status | Pri |
| --------------- | ----------------- | -------------------------------------------------------------- | ---------------------------------------------------- | ------ | ------ | --- |
| `picking`       | Picking           | Click to select: GPU pick and CPU raycast, compared.           | `pickAsync`, `world.raycastRender`, `screenToRay`    | none   | ready  | P0  |
| `many-entities` | Many entities     | Two thousand spinning cubes with the frame time on screen.     | `MeshRenderer` at scale, `app.diagnostics`           | none   | ready  | P1  |
| `instancing`    | Instancing        | Ten thousand instances through thin instancing.                | Lite thin instances                                  | none   | engine | P2  |
| `render-scale`  | Render scale      | Resolution scale and pixel-ratio clamp with a live frame time. | `app.renderer.resolutionScale`, `pixelRatio`         | Corset | ready  | P1  |
| `screenshot`    | Screenshots       | Capture the frame to an image.                                 | `captureScreenshot`                                  | any    | ready  | P2  |
| `world-text`    | Text in the world | HUD text and world-space labels that follow entities.          | `HudText`, `WorldText`, `WorldText2D`, `WorldAnchor` | a font | ready  | P1  |
| `gpu-timings`   | GPU timings       | Per-task GPU times from the frame graph.                       | `profileTasks`, `taskTimings`                        | Corset | ready  | P2  |

### 7.6 2D

| Slug                | Title                     | One line                                                       | Shows                                               | Assets             | Status | Pri |
| ------------------- | ------------------------- | -------------------------------------------------------------- | --------------------------------------------------- | ------------------ | ------ | --- |
| `sprite-animation`  | Sprite animation          | An atlas, three clips, flip and speed.                         | `SpriteRenderer`, `SpriteAnimator`, atlas importers | Kenney characters  | ready  | P0  |
| `tilemap`           | Tilemap                   | A Tiled map with layers, chunk culling, and a character on it. | `Tilemap`, `TilemapRenderer`, `Camera2D`            | Kenney tileset     | ready  | P0  |
| `ldtk`              | LDtk import               | The same scene from an LDtk project.                           | LDtk importer                                       | Kenney tileset     | ready  | P2  |
| `parallax`          | Parallax                  | Five bands scrolling at different factors.                     | `ParallaxLayer`                                     | Kenney backgrounds | ready  | P1  |
| `pixel-perfect`     | Pixel-perfect camera      | Toggle pixel-perfect and zoom; see the difference at 2×.       | `Camera2D.pixelPerfect`                             | Kenney tileset     | ready  | P1  |
| `sorting-and-ysort` | Sorting layers and Y-sort | Props and characters overlap correctly as they move.           | sorting layers, `ySort`                             | Kenney town        | ready  | P1  |
| `sprite-effects`    | Sprite layer effects      | Tint, flash, and a custom sprite shader on one layer.          | `SpriteLayerEffect`                                 | Kenney characters  | ready  | P2  |
| `camera-follow-2d`  | 2D camera follow          | A dead-zoned follow with bounds.                               | `Camera2DFollow`                                    | Kenney tileset     | ready  | P2  |
| `picking-2d`        | 2D picking                | Click sprites; tiles by cell.                                  | `pickAt`, `Tilemap.worldToCell`                     | Kenney tileset     | ready  | P2  |

### 7.7 Physics

| Slug                    | Title                          | One line                                                                       | Shows                                     | Assets    | Status | Pri |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------- | --------- | ------ | --- |
| `physics-playground`    | Physics playground             | Drop boxes, spheres, capsules; friction and bounce sliders; a sleep indicator. | `Rigidbody`, colliders, physics materials | none      | ready  | P0  |
| `character-controller`  | Character controller           | A capsule that climbs 30° and refuses 60°, steps, and snaps to ground.         | `CharacterController`                     | none      | ready  | P0  |
| `raycasts-triggers`     | Raycasts and triggers          | A crosshair ray and a trigger volume with enter and exit events.               | `app.physics.raycast`, trigger events     | none      | ready  | P1  |
| `shape-queries`         | Shape queries                  | Overlap and sweep with a visualised shape.                                     | shape casts, overlap, the layer matrix    | none      | ready  | P2  |
| `mesh-and-heightfield`  | Mesh and heightfield colliders | A terrain and a concave prop.                                                  | `MeshCollider`, `HeightfieldCollider`     | generated | ready  | P2  |
| `moving-platforms`      | Moving platforms               | Kinematic movers carrying a character.                                         | `PlatformMover`, `RigidbodyMover`         | none      | ready  | P1  |
| `projectiles`           | Projectiles                    | Fire, hit, destroy.                                                            | `Projectile`                              | none      | ready  | P2  |
| `physics-2d`            | 2D physics                     | Stack, throw, and knock over 2D bodies.                                        | `Rigidbody2D`, 2D colliders               | Kenney    | ready  | P0  |
| `platformer-controller` | Platformer controller          | Slopes, auto-step, one-way platforms, coyote time.                             | `CharacterController2D`                   | Kenney    | ready  | P0  |
| `tilemap-collision`     | Tilemap collision              | A collision layer becomes colliders.                                           | tilemap collider                          | Kenney    | ready  | P1  |
| `determinism`           | Determinism                    | Two worlds, same inputs, same hash, live.                                      | fixed step, `createManualClock`           | none      | ready  | P2  |

### 7.8 Gameplay (3D toolkit)

| Slug                 | Title              | One line                                                           | Shows                                               | Assets          | Status | Pri |
| -------------------- | ------------------ | ------------------------------------------------------------------ | --------------------------------------------------- | --------------- | ------ | --- |
| `third-person`       | Third-person       | A controller and an orbit camera that will not clip through walls. | `ThirdPersonController`, `ThirdPersonCamera`        | repo rig        | ready  | P0  |
| `first-person`       | First-person       | Pointer lock, sprint, crouch, a view model.                        | `FirstPersonController`                             | repo rig + prop | ready  | P1  |
| `animator`           | Animator           | A state machine with a blend tree, a trigger and an event.         | `Animator`, `.animator.json`                        | Fox             | ready  | P0  |
| `navigation`         | Navigation         | Bake a navmesh, click to move agents, drop obstacles.              | `NavMeshSurface`, `NavMeshAgent`, `NavMeshObstacle` | generated       | ready  | P1  |
| `scenes-and-prefabs` | Scenes and prefabs | Load a scene, instantiate prefabs with overrides, save and reload. | `SceneAsset`, `world.instantiate`, `serializeScene` | JSON            | ready  | P1  |
| `spawn-on-click`     | Spawn on click     | A click is a ray; the ray spawns a prefab.                         | `screenToRay`, `instantiate`                        | JSON            | ready  | P2  |

### 7.9 Input

| Slug             | Title                   | One line                                                   | Shows                                                | Assets | Status | Pri |
| ---------------- | ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------ | ------ | --- |
| `input-actions`  | Input actions           | A visualiser: every device, every action, its value, live. | `.input.json`, composites, processors, `PlayerInput` | none   | ready  | P0  |
| `rebinding`      | Rebinding               | Press a control, rebind an action, persist it.             | `performInteractiveRebind`, `saveOverrides`          | none   | ready  | P1  |
| `touch-controls` | Touch controls          | A virtual joystick and buttons driving a character.        | `VirtualJoystick`, `VirtualButton`                   | none   | ready  | P1  |
| `pointer-lock`   | Pointer lock and cursor | Lock on click, release on Escape, cursor styles.           | pointer lock API                                     | none   | ready  | P2  |

### 7.10 Audio

| Slug               | Title               | One line                                                   | Shows                                         | Assets        | Status | Pri |
| ------------------ | ------------------- | ---------------------------------------------------------- | --------------------------------------------- | ------------- | ------ | --- |
| `audio-mixer`      | Audio mixer         | A bus tree with faders; one-shots on SFX, a loop on Music. | `.audio.json`, `app.audio.bus`, `AudioSource` | Kenney + repo | ready  | P0  |
| `positional-audio` | Positional audio    | Walk around emitters; hear attenuation and panning.        | spatial `AudioSource`, `AudioListener`        | repo          | ready  | P1  |
| `audio-unlock`     | Autoplay and unlock | What happens before the first click, and after.            | `app.audio.state`, queued plays               | repo          | ready  | P2  |

### 7.11 UI

| Slug             | Title          | One line                                                           | Shows                                  | Assets | Status | Pri |
| ---------------- | -------------- | ------------------------------------------------------------------ | -------------------------------------- | ------ | ------ | --- |
| `ui-overlay`     | UI overlay     | HUD, a dialog, toasts, scaling modes, safe areas.                  | `app.ui`, `Dialog`, `Toast`, `HudText` | none   | ready  | P0  |
| `menus`          | Menus          | A title and settings menu driven by keyboard, gamepad and pointer. | `Menu`, `MenuStack`                    | none   | ready  | P1  |
| `loading-screen` | Loading screen | A preload group with progress.                                     | `LoadingScreen`, preload groups        | models | ready  | P1  |
| `i18n`           | Translations   | Switch locale, see plurals.                                        | `app.i18n`, `.i18n.json`               | none   | ready  | P2  |

### 7.12 Platform

| Slug            | Title              | One line                                                                 | Shows                             | Assets | Status | Pri |
| --------------- | ------------------ | ------------------------------------------------------------------------ | --------------------------------- | ------ | ------ | --- |
| `save-load`     | Save and load      | Serialise the world, store it, reload it, with a versioned document.     | `app.storage`, `serializeScene`   | none   | ready  | P1  |
| `platform-info` | Platform           | Everything `app.platform` knows about this device.                       | `app.platform`                    | none   | ready  | P2  |
| `devtools`      | Devtools overlay   | The overlay, open by default, with a counter to watch.                   | `app.devtools`, `app.diagnostics` | none   | ready  | P0  |
| `templates/*`   | The four templates | Each template as an example page, playable, with its README as the copy. | everything                        | repo   | ready  | P0  |

**Launch set (P0, 16 + the four templates):** hello-cube, pbr-model, model-loading, material-grid,
skinned-animation, lights, shadows, ibl, tone-mapping, bloom, picking, sprite-animation, tilemap,
physics-playground, character-controller, physics-2d, platformer-controller, third-person, animator,
input-actions, audio-mixer, ui-overlay, devtools. _(That is 23 rows; trim to sixteen by moving
model-loading, lights, picking, physics-2d, platformer-controller, ui-overlay and devtools to P1 if
the launch date needs it. The hero, shadows, bloom, tone mapping, tilemap, physics playground,
third-person and animator are not negotiable.)_

## 8. Engine work this catalogue asks for

Listed so the engine backlog and the site backlog agree. None of it blocks launch.

| Item                                                                                                  | Unlocks                                   | Size   |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------ |
| `MeshAsset.sphere/capsule/cylinder/plane/torus` factories                                             | `primitives`, cleaner playground scenes   | S      |
| `PostProcessStack.depthOfField` on Lite's task                                                        | `depth-of-field`                          | M      |
| `PostProcessStack.chromaticAberration`, `.taa`, `.contactShadows`, `.ssgi`                            | four P2 examples                          | M each |
| Morph target weights on `Model`                                                                       | `morph-targets`                           | M      |
| Thin-instance renderer component                                                                      | `instancing`                              | M      |
| `.splat` asset type                                                                                   | `gaussian-splats`                         | M      |
| A test-only device-loss trigger through `.lite`                                                       | `device-loss`                             | S      |
| glTF extension coverage tests (clearcoat, sheen, iridescence, anisotropy, transmission, volume, KTX2) | moves seven rows from _verify_ to _ready_ | S each |
| Dynamic import of Rapier in `@ignifx/physics-2d`                                                      | 2D examples that do not cost 800 KB       | M      |
| SSAO                                                                                                  | Upstream only: not in Babylon Lite 1.27.0 | —      |

The full list of engine features and examples that are wanted but not yet possible, with usefulness and effort, is `07-wishlist.md`. Nothing from it enters this catalogue, or the site, until it is delivered and functional (`07` §1).

## 9. Definition of done for one example

1. `website/examples/<slug>/main.ts` under 200 lines, imports only from published entry points and
   the kit, and is readable top to bottom as a lesson.
2. A `catalogue.ts` entry with title, category, one line, one paragraph, three "Try" bullets, the
   components used, and its assets.
3. Assets vendored under the size caps, attributed, and digested.
4. Honors `?static`, `?seed`, `?nopanel`, `?autoplay`; posts `ready` and `stats`; pauses when hidden;
   shows the fallback panel without WebGPU.
5. A committed poster and golden; frame and bundle budgets asserted.
6. Reviewed by running it on a touch device and with a gamepad if it takes input.
