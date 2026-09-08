# 07 · Rendering (the Babylon Lite adapter)

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` (`src/lite/**`) · **Related:** `00-overview.md` §3, `02-scene-graph.md`, `11-2d-toolkit.md`

ignifx does not render; Babylon Lite does. This document defines the components that expose Lite's renderer to entities, and the rules the adapter follows. Lite API names below are verified against `@babylonjs/lite@1.27.0`.

---

## 1. Engine and surface

- `createApp({ canvas })` runs a capability check (`navigator.gpu` present and `requestAdapter()` succeeds) and then `createEngine(canvas, options)`. Failure rejects with `IgnifxError` code `IGX-0701` carrying a reason in `context` (`no-navigator-gpu`, `no-adapter`, `device-failed`, `context-failed`). Templates catch it and show a static "WebGPU required" page.
- Engine options exposed by `createApp`: `msaaSamples` (1 or 4, default 4), `alphaMode`, `srgb`, `format`, `maxDevicePixelRatio` (default `Infinity`, i.e. native DPR), `useHighPrecisionMatrix`/`useFloatingOrigin` (large worlds; off by default), `requiredLimits`.
- Sizing: Lite re-reads `clientWidth × clientHeight × devicePixelRatio` at the start of every frame (`resizeEngine`). ignifx exposes `app.renderer.pixelRatio` (maps to `maxDevicePixelRatio`) and `app.renderer.resolutionScale` (0.25–1, implemented by lowering `maxDevicePixelRatio`); for `OffscreenCanvas` it exposes `app.renderer.setSize(w, h)` (`setSurfaceSize`; on a laid-out DOM canvas Lite re-reads the layout size next frame, so `setSize` is an `OffscreenCanvas`-only API). Lite always requests a `high-performance` adapter; there is no `powerPreference` option.
- One render scene per world (`createSceneContext(engine)`), registered in `app.start()` via `registerScene` (or `registerSceneWithShadowSupport` when any shadow-casting light exists at start; the adapter picks the right call).
- Multiple surfaces (`createSurface`) and worker rendering are post-1.0.

### 1.1 Feature opt-ins are declared up front

Lite enables many features only through explicit calls that must happen **before `registerScene`** (its deferred-builder drain). Process- or scene-global opt-ins: `enableStandardSkeleton()`, `enableMaterialStencil()`, `enablePbrLightmap()` (async), `enableMaterialPlugins(scene)`, `enableAsyncShaderPipelineCompilation`, `enableBoneControl()` (before loading skinned assets), `enableGltfCameras()`, and the `enableDeviceLost*Recovery` family (before creating resources). ignifx therefore takes a `rendering.features` block in `ignifx.config.ts`/`createApp` (`{ shadows, postProcessing, skeletons, boneControl, stencil, lightmaps, materialPlugins, asyncPipelines, deviceLostRecovery }`), applies the corresponding calls during `app.start()` before `registerScene`, and rejects late toggles with `IGX-0704`. Two of those names are not `enable*` calls at all: `shadows` picks `registerSceneWithShadowSupport` over `registerScene`, and `postProcessing` picks the scene's whole render path at `createSceneContext` (§2.7) — earlier than the rest, because a frame graph is built there and Lite exposes no way to retarget its render task afterwards. Extensions declare the features they need through `ctx.requireRenderingFeature(name)` at registration. Per-object opt-ins (`enableThinInstanceGpuCulling(mesh, enabled)`, `setAlphaToCoverage(target, enabled)`) are `MeshRenderer`/material fields that the adapter applies when it creates the Lite object, before that object is registered.

Entities added after `registerScene` go through Lite's runtime material-swap path, which compiles new material families asynchronously (a mesh may appear a few frames after `addToScene`). The adapter pre-registers the material families of every asset in the `boot` preload group before `registerScene`, and `app.renderer.warmUp(materials)` exists for spawn-heavy games.

## 2. Components

### 2.1 `Camera`

| Field              | Type / default                                           | Lite mapping                                                                                      |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `projection`       | `"perspective"` \| `"orthographic"`; default perspective | `enableOrthographicCamera` / `disableOrthographicCamera`                                          |
| `fov`              | vertical degrees, default 60                             | `camera.fov` (radians)                                                                            |
| `orthographicSize` | half-height in world units, default 5                    | `camera.ortho.halfHeight`                                                                         |
| `near`, `far`      | 0.1, 1000                                                | `nearPlane`, `farPlane`                                                                           |
| `viewport`         | `{x, y, width, height}` normalized, default full         | `camera.viewport` (`NormalizedViewport`; y measured from the bottom, per `resolveCameraViewport`) |
| `clearColor`       | `[r,g,b,a]`, default from scene settings                 | `scene.clearColor` (main camera only)                                                             |
| `priority`         | number, default 0                                        | main camera = highest priority enabled camera                                                     |
| `cullingMask`      | layer mask, default all                                  | post-1.0 (Lite render task mesh lists)                                                            |

- Implementation: a Lite `FreeCamera` (`createFreeCamera({0,0,0}, {0,0,1})`) parented to the entity's node so the entity's transform defines the view; `world.mainCamera` sets `scene.camera`. A world with no enabled camera renders nothing and logs `IGX-0706` once — unless another rendering context has claimed the frame through `Renderer.addCameraSource`, an `@internal` hook whose one caller is `@ignifx/2d`: a `"sprite"`-mode world draws through a `Camera2D` and needs no `Camera` at all, so the warning would be wrong there (amended 2026-09-08). The claim is re-asked every frame and clears the once-only latch, so a world that later loses its `Camera2D` warns exactly as one that loses its `Camera` does.
- **Clear-colour precedence.** There is one `scene.clearColor` and three things that may write it, so they are ranked, strongest first: (1) `Camera.clearColor` on the **main** camera, when it is not `null` — the sync system writes it every frame that camera renders; (2) `Environment.clearColor` of the winning environment, written whenever the field changes (§2.5); (3) the `rendering.clearColor` setting, written once as the render scene is created, before any frame has run; (4) Babylon Lite's own default, a mid grey, which only code that bypasses `createApp` ever sees — ignifx's own default for the setting is opaque black. Every one of those is stored as sRGB `[r,g,b,a]` and decoded to linear on the way to Lite, and the surface is not an sRGB-encoding format, so the decoded value is what is presented: a channel lands on screen at `srgbToLinear(value) * 255` (measured 2026-09-08 — `{0.6, 0.2, 0.9}` reads back as `81, 8, 201`). `@ignifx/2d`'s `"sprite"` mode has its own clear, because the sprite pass owns the swapchain pass and nothing the render scene did survives underneath: it clears to rung (3), the `rendering.clearColor` setting, decoded the same way, and rungs (1) and (2) do not apply (there is no `Camera` or `Environment` in a 2D scene, and `Camera2D` has no `clearColor` field). A camera whose `clearColor` goes back to `null` does **not** restore the setting: `null` means "leave the scene's clear colour alone".
- Methods: `screenToRay(x, y)` (backing-store pixels — the canvas's `width`/`height`, the space `worldToScreen`, `pickAsync`, and `<Pointer>/position` share; amended 2026-09-06, the previous "CSS pixels" was wrong at DPR ≠ 1 → world `Ray`), `worldToScreen(point, out?)`, `screenToWorldPoint(x, y, distance)`, `viewportToWorldPoint`, `getProjectionMatrix()` (via Lite `getProjectionMatrix(camera, aspect)`), `getViewMatrix()`.
- Cinemachine-style rigs live in `@ignifx/3d` and `@ignifx/2d` as scripts that drive the camera entity's transform; the `Camera` component itself has no follow logic.

### 2.2 `Light`

| Field                                                                                                          | Lite                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`: `"directional"` \| `"point"` \| `"spot"` \| `"hemispheric"`                                            | `createDirectionalLight` / `createPointLight` / `createSpotLight` / `createHemisphericLight`, **unparented**; the entity's world pose is written onto the light each frame it moves             |
| `color` (sRGB), `intensity`                                                                                    | `diffuse`/`specular` (linear) and `intensity`; hemispheric lights use `diffuseColor`/`specularColor`                                                                                            |
| `range` (point/spot)                                                                                           | `range`                                                                                                                                                                                         |
| `spotAngle` (degrees, full cone), `spotExponent`                                                               | `angle` (radians), `exponent`                                                                                                                                                                   |
| `groundColor` (hemispheric)                                                                                    | `groundColor`                                                                                                                                                                                   |
| `shadows`: `{ enabled, technique: "esm" \| "pcf" \| "csm", mapSize, bias, normalBias, cascades, maxDistance }` | `createEsmDirectionalShadowGenerator` / `createPcfDirectionalShadowGenerator` / `createCsmDirectionalShadowGenerator` / `createPcfSpotlightShadowGenerator` assigned to `light.shadowGenerator` |
| `includeOnly` / `exclude` (entity refs)                                                                        | `includedOnlyMeshIds` / `excludedMeshIds`                                                                                                                                                       |

- Point-light shadows and area lights are not available in Lite; the schema rejects `shadows.enabled` on point lights (`IGX-0703`).
- **A light is not parented in Lite.** Every other render component mirrors its entity by parenting a Lite object under the entity's node; a light cannot, because Lite reads its pose from two places that only agree when there is no parent. The shader takes the light's direction from `worldMatrix[8..10]`, which Lite composes as `parentWorld × localMatrixFromDirection(direction, position)`; the shadow frustum is fitted from `direction`/`position` **directly**. Parenting the light and writing a world direction onto it rotated it twice; parenting it and leaving the local direction alone made it shade one way and cast another. Both were visible in the Phase 2 visual goldens (ADR-0002, "Corrections after the visual suite").
- **The adapter writes the entity's world pose onto the light instead**, in each frame the entity's `worldMatrixVersion` moved: the world forward axis for a directional or spot light, the world **up** axis for a hemispheric light's sky direction, and the world position for anything that has one. That write is also the only "this light moved" signal Lite has — the lights UBO re-uploads only when a light's own observables are written.
- Changing light topology (adding a shadow caster light after start) triggers `rebuildSceneRenderables`; the adapter batches this to once per frame.

### 2.3 `MeshRenderer`

```ts
class MeshRenderer extends Component.define({
  mesh: asset(MeshAsset), // "models/hero.glb#mesh:Body" or a primitive created in code
  materials: array(asset(MaterialAsset)), // one per submesh; empty → default material
  castShadows: bool(true),
  receiveShadows: bool(true),
  renderOrder: i32(0),
  pickable: bool(true),
}) {}
```

- `materials` keeps its array shape for the day Lite exposes submesh materials; in Lite 1.27.0 a `Mesh` has one `material`, so index 0 is used and the rest are ignored.
- A `MeshAsset` holds a template Lite `Mesh` (geometry uploaded once). Each `MeshRenderer` clones the template (`cloneTransformNode`, which shallow-clones meshes and shares GPU buffers) and parents the clone to the entity node, then `addToScene`. Removing the component calls `removeFromScene` on the clone; the template's buffers stay alive while the asset is retained (Lite ref-counts shared geometry).
- Primitives: `MeshAsset.box(options)`, `.sphere`, `.plane`, `.ground`, `.cylinder`, `.capsule`, `.torus`, `.fromData(positions, normals, indices, uvs)` (Lite `createBox`, `createSphere`, … `createMeshFromData`). Primitive assets created in code are owned by the caller and released with `dispose()`/`using`.
- Shadow casting is expressed through Lite's per-generator caster lists (`setShadowTaskCasterMeshes`); the adapter maintains those lists from `castShadows`. It rebuilds them only in a frame that owes no `rebuildSceneRenderables`: Lite's shadow task records a render pass over the caster meshes and looks each caster material's build group up in the scene, and a caster whose material family the scene has not registered yet throws inside the frame. So a caster added at runtime joins the lists on the frame after its renderable rebuild has resolved.
- `visible` is derived from `entity.activeInHierarchy && component.enabled` (`mesh.visible`); never remove a mesh from the scene to hide it (Lite disposes a mesh leaving its last scene).

### 2.4 `Model`

```ts
class Model extends Component.define({
  model: asset(ModelAsset),
  materialOverrides: map(asset(MaterialAsset)), // by material name
  castShadows: bool(true),
  receiveShadows: bool(true),
  pickable: bool(true),
}) {
  readonly nodes: ReadonlyMap<string, LiteNodeView>; // glTF node name → transform-like view (position/rotation/scale)
  readonly animations: readonly AnimationGroup[]; // Lite groups, re-bound per instance; consumed by @ignifx/3d Animator
  readonly skeletons: readonly Skeleton[];
  attachToNode(nodeName: string, entity: Entity): void; // parents the entity's node under a glTF node (bone attachments)
}
```

- Instantiation clones the asset's container root (`cloneTransformNode`) under the entity node and `addToScene`s it; animation groups are duplicated per instance. The instanced Lite subtree is opaque: it is not expanded into entities in the MVP (an `expandToEntities()` tool is planned for tooling after 1.0). `attachToNode` covers the common "weapon in hand" case.
- glTF cameras and lights inside models are ignored unless `importLights`/`importCameras` are enabled on the asset's `.meta.json`.
- The adapter strips `animationGroups` from the container before `addToScene` so that Lite does not tick them; ignifx's animation system owns advancement (`01-lifecycle-and-time.md` §3).
- **`castShadows` and `receiveShadows` cover the whole instantiated subtree**, and mean exactly what they mean on a `MeshRenderer` (§2.3). Every mesh in the clone is collected **once**, when the subtree is instantiated — its shape is fixed from then on — and that list is what the model contributes to `setShadowTaskCasterMeshes` while it casts, and what `receiveShadows` is written across (Lite's `receiveShadows` is per mesh). A hidden model casts nothing, for the same reason a hidden `MeshRenderer` does. Instantiating a model, showing or hiding it, and flipping `castShadows` each report a caster change and rebuild the lists that frame; destroying one cannot report anything — the component has left the world's list — so its teardown raises the renderer's "caster set may have moved" flag and the next frame rebuilds.

### 2.5 `Environment`

One per world (the most recently enabled wins; the adapter logs `IGX-0705` once while two are enabled). Its `clearColor` is written only when the field changes, which is what leaves the `rendering.clearColor` setting standing in a world whose environment never touches its own, and what keeps the main camera's per-frame override above it (§2.1). Fields: `environment: asset(EnvironmentAsset)` (IBL `.env`/`.hdr`), `skybox: { enabled, size }`, `rotation` (degrees, Y), `blur` (0 to 1), `fog: { mode: "none" | "linear" | "exp" | "exp2", color, density, start, end }`, `imageProcessing: { exposure, contrast, toneMapping: "standard" | "aces" | "neutral" | "none" }`, `clearColor` (`ambientColor` arrives with the 3D toolkit in Phase 7). Maps to `loadEnvironment`, `setEnvironmentRotation`, `setEnvironmentBlur`, `scene.fog`, `setSceneImageProcessing`, `scene.clearColor`.

**Assigning a different loaded `EnvironmentAsset` swaps the lighting** (amended 2026-09-08; before that the component only re-aimed whatever the loader had installed, so a second handle changed the rotation and the blur and left the lighting alone). Lite 1.27.0 declares no public way to replace a registered scene's environment — no `scene.environmentTexture`, no `unloadEnvironment` — so the adapter writes the one field every consumer of it reads: `scene._envTextures`, the field `loadEnvironment` itself assigns and the field Lite's own device-lost recovery replaces. `installSceneEnvironment` in `src/lite/gpu/environment.ts` is the only place ignifx touches a Lite field `index.d.ts` does not declare; its header records the `lib/` line behind every claim and a browser test pins the name. The diffuse harmonics and the LOD scale follow at once, because the render task's scene-UBO cache is keyed on the slot's object identity; the **specular** reflection follows only after the material groups are rebuilt, because a PBR bind group holds the cube map's texture view — so the component reports an install as a topology change and the §2.2 coalescing fires the frame's one `rebuildSceneRenderables`, one frame later as for any other topology change. Installing also re-applies rotation, blur, and image processing, because `loadEnvironment` overwrites `scene.imageProcessing` (tone mapping on, exposure 0.8, contrast 1.2) on every load. The GPU resources belong to the assets and are released by the asset system exactly as before, so two retained handles can be swapped back and forth for nothing. Assigning `null` is defined as "stop steering", not "go dark": Lite has no inverse of `loadEnvironment`, so the last installed environment keeps lighting the scene, exactly as detaching the component does, and `Environment.installed` keeps naming it.

**`skybox` is decided when the environment loads, and only reported here.** Lite builds the background inside `loadEnvironment`, as a feature-owned `Renderable` queued in the scene's deferred builders and drained by `registerScene`; `Renderable` (`index.d.ts` 9678) carries no visibility flag, no size, and no handle, and Lite offers nothing that removes or re-aims one. So the `.environment.json` is the authority (`skyboxEnabled`, `skybox`, `skyboxSize`); a `skybox` record that was _set_ to something the installed environment did not deliver logs `IGX-0711` once per component instead of being silently ignored (a field still at its schema default reports nothing, so a project whose declaration turns the background off is never told off for leaving the component alone); and an environment loaded **after** `app.start()` gets no background at all, because nothing drains the deferred builders again. A declaration that enables a skybox and names no image now passes the `.env` as its own `skyboxUrl`, which is what selects Lite's HDR cube background over the flat box painted in a snapshot of the clear colour (amended 2026-09-08). A swap does not move that background, so a world that switches environments at runtime wants `skyboxEnabled: false` and `Environment.clearColor`.

### 2.6 Materials

- `MaterialAsset` from `.material.json` (`06-serialization-and-scene-format.md` §6):
  - `"type": "pbr"` → `createPbrMaterial(props)`: `baseColor`, `baseColorTexture`, `metallic`, `roughness`, `metallicRoughnessTexture`, `normalTexture`, `emissive`, `emissiveTexture`, `occlusionTexture`, `alphaMode` (`opaque|mask|blend`), `alphaCutoff`, `doubleSided`, `unlit`, plus opt-in extensions (`clearcoat`, `sheen`, `transmission`, `anisotropy`, `iridescence`) that the adapter enables only when present so unused shader code is tree-shaken.
  - `"type": "standard"` → `createStandardMaterial()` + `setStandard*Texture` setters.
  - `"type": "shader"` → `createShaderMaterial` with a WGSL asset and a declared uniform/texture layout.
- Materials are shared: many renderers reference one asset. Per-renderer variation uses material _instances_ (`MaterialAsset.clone()`, an ignifx-level copy of the material props that creates a new Lite material) or per-instance colors via thin instances (post-MVP).
- Property changes after the scene is registered go through Lite's dirty mechanism (`markMaterialUboDirty` / opt-in `enableMaterialTracking`); the adapter marks dirty on setter calls.

### 2.7 `PostProcessStack`

Attached to the main camera entity. Ordered list of effects; each maps to a Lite post-process task appended to the scene frame graph with `addTask`, which puts it after the render pass: `bloom`, `depthOfField`, `chromaticAberration`, `smaa`, `taa`, `imageProcessing` (exposure/contrast/tone mapping when not using `Environment`), `screenSpaceContactShadows`, `ssgi`. MVP ships `bloom`, `smaa`, `imageProcessing`; the rest follow in Phase 7.

**Post-processing is a feature opt-in and renders through an offscreen target.** A chain can never sample the swapchain: `createSurface` configures the canvas context with no `usage`, so its texture is `RENDER_ATTACHMENT` only and binding it as a source fails WebGPU validation, rejecting the whole frame — a black page, which is exactly what the first round of visual goldens showed. So a project that wants a `PostProcessStack` declares `rendering.features.postProcessing` (§1.1). With it on, the render scene is created with `defaultRenderTask: false` and ignifx builds its own frame graph:

```text
[shadow] → scene ──→ sceneColor ──→ present ──→ swapchain
                         └─ a PostProcessStack appends its effects here, and disables present
```

- `sceneColor` is an offscreen, single-sample colour target — resolved from the MSAA target through the render task's `rst` when MSAA is on — and it carries the `TEXTURE_BINDING` the swapchain lacks.
- `present` is a copy task that composites `sceneColor` onto the swapchain. It always runs unless a chain is writing the swapchain itself, so the frame is never lost: an empty chain, a chain with every effect off, and a disabled stack all present the plain scene.
- Every target is sized by the surface, so a canvas resize reallocates them through the frame-graph rebuild Lite already does; the chain handles no resize itself.
- `imageProcessing` is always recorded **last**, whatever `order` says: Lite's task writes the swapchain unconditionally and takes no target, so nothing can read what it produced.
- A `PostProcessStack` may be configured before `app.start()`: its chain is appended to Lite's frame graph without recording while the scene is unregistered, and `registerScene`'s own `frameGraph.build()` then records it after the scene task (recording earlier failed with Lite error 107, "sourceTexture has no color texture", until 2026-09-07).
- A `PostProcessStack` attached without the feature logs `IGX-0710` once and is inert. The feature costs one full-screen blit per frame while no chain is recorded, which is why it is off by default.
- **Tuning is live; shape is rebuilt (2026-09-08).** A write to `bloom.weight`/`kernel`/`threshold`/`exposure` or to any SMAA field on a running stack is re-uploaded to the recorded Lite task on the next `PreRender` (`updateUniforms()`), and only when a value changed. A change to the chain's _shape_ — which effects are enabled, their `order`, or bloom's `scale`, which sizes the blur targets at creation — disposes the chain and records a new one; the old tasks stay in the frame graph disabled, because Lite has no removal. Until this date the records were read once, when the chain was first built, and a slider bound to `bloom.threshold` did nothing.

## 3. Picking

- `app.renderer.pickAsync(x, y, options)` → GPU pick (`createGpuPicker` + `pickAsync`), resolves to `{ entity, component, point, normal, distance }` using node metadata. Calls are serialized per picker (Lite constraint).
- `world.raycastRender(ray, options)` → synchronous CPU pick (`pickWithRay`) against renderable meshes; distinct from physics raycasts (`09-physics.md` §5).
- 2D sprite picking is provided by `@ignifx/2d` (`pickSprite2D`).

## 4. Device loss

- `createApp` enables `enableDeviceLostSceneRecovery` when `rendering.features.deviceLostRecovery` is on (every feature is opt-in), and the 2D/UI extensions enable `enableDeviceLostSpriteRecovery` / `enableDeviceLostTextRecovery` **before** creating resources (Lite requirement).
- Callbacks fan out to `app.events.onDeviceLost`, `onDeviceRecovered`, `onDeviceRecoveryFailed`. Lite cannot recover PCF/CSM shadows or glTF `EXT_lights_image_based` environments today; when those are in use, recovery is expected to fail and templates offer a reload. This is tracked as an upstream item.

## 5. Diagnostics and tools

- `app.diagnostics.render`: `drawCalls` (`engine.drawCallCount`), `gpuFrameTimeMs` (with `setGpuTimingEnabled`), per-task GPU timings (`getRenderTaskGpuTimings`) when `renderer.profileTasks` is on.
- `app.renderer.captureScreenshot()` → `captureScreenshot(engine)`; it settles only while the render loop is running (a frame must be presented), so headless apps get `IGX-0707`.
- Every build reaches Lite's error decoder through a dynamic import (`packages/core/src/lite/error-decoding.ts`), awaited during renderer initialisation: the decoder and Lite's 44 KB message table are one reachability set, and because `createApp({ mode })` defaults to `"development"` in every build, a static import would put the table in every production entry chunk (it did, until 2026-09-07; splitting it saved 10.8 KB gzipped in `hello-cube`). There is no separate `decodeError` path.

## 6. Headless behaviour

Under the null engine, `MeshRenderer`/`Model` skip GPU work: the template mesh has no geometry, `addToScene` is not called, and `visible` toggles are no-ops. Transforms, bounds from asset metadata, and picking by physics still work. Tests assert on component state, not on Lite scene contents.

## 7. Disposal order

`app.dispose()` runs: stop engine → `onStop` hooks → unload scene instances (component `onDestroy`, `removeFromScene`) → extension `dispose` in reverse order (physics disposes its Havok world _before_ the scenes are disposed: Lite's physics documentation warns that the step callback must be removed before the native world is released, which `disposePhysics` does, and ignifx orders it first so no scene callback can fire against a released world; audio disposes its engine independently) → `disposeScene(renderScene)` → release texture handles through Lite's resource pool (`acquireTexture`/`releaseTexture`; `Texture2D` has no dispose of its own) → `disposeEngine`. Lite does not cascade physics or audio disposal from scene disposal; ignifx does.

## 8. Known Lite gaps that shape this document

| Gap                                                                               | Handling                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No GUI system                                                                     | `@ignifx/ui` uses DOM overlays and Lite text layers (`13-ui.md`)                                        |
| No point-light shadows, area lights, reflection probes (local IBL probes exist)   | Schema-level rejection; documented                                                                      |
| No public setter for a scene's environment, and no handle on the skybox it builds | `installSceneEnvironment` writes `scene._envTextures` (§2.5); the background stays a load-time decision |
| Single active camera per scene                                                    | `priority` selects; multi-camera post-1.0 via render tasks                                              |
| No layer masks on cameras                                                         | `cullingMask` deferred                                                                                  |
| Mesh disposal on last-scene removal                                               | hide via visibility; only `destroy` removes                                                             |
| Frequent breaking changes                                                         | adapter boundary + pinned version + compatibility test suite                                            |
