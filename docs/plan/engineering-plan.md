# ignifx engineering plan

The engine's open-work list, and the document `CONSTITUTION.md` §4.3, §7.6 and §10.1 call "the engineering plan". One or two lines an item. Remove an item when it ships; design belongs in `docs/architecture/` or an ADR, history in git. Check an item against the code before acting on it.

## Shipped

The planned 0.x scope is on `main` and on npm as one fixed version line: the kernel, renderer, assets, scenes and prefabs, storage and edit mode (`core`); the 2D and 3D toolkits; Havok and Rapier physics; input, audio, UI and devtools; custom shaders, instancing, particles and terrain; HDR, TAA, ambient occlusion, screen-space GI, reflection probes, baked light probes and lightmap run time; Electron, the editor host, the Vite plugin, the CLI and the `ignifx` umbrella; four templates with desktop variants; the skills and their compiled recipes.

## 1.0 gates

- Met (constitution §4.3): the planned scope is complete; the four templates build in CI; the documentation harness passes.
- **API reports reviewed and frozen** (§4.3): not met; see "API freeze".
- **Two consecutive minors with no breaking change:** not met; 0.21.0 has a **Breaking** entry (`@ignifx/electron`).
- **Browser matrix** (Chrome, Edge, Safari, Firefox, Chrome Android, Electron on three systems): CI runs Chromium only; nothing else has been run.
- **Determinism on three platforms:** unit tests run on Linux only; the physics hashes are recorded on macOS.
- **Migration infrastructure:** no `registerFileMigration`, component `migrate` or storage migration exists.
- **Provenance** (§9.4): off in all 17 manifests; an owner decision below.
- **Bundle:** the `hello-cube` entry chunk is 268,634 bytes gzipped against a 250,000 target; chase it or restate it.
- **Dependency audit** recorded per release (`SECURITY.md`): last recorded 2026-09-07.

## Open work

### Kernel, scenes and formats

- Seams devtools and 2D ask for: `unregisterSystem`, `world.onHierarchyChanged`, `renderer.onSceneRegistered`, a listing of asset handles.
- A scene's `settings` block is read by `@ignifx/2d` only; a 3D scene cannot set clear colour, environment or gravity.
- `Camera` has no culling mask. glTF cameras and lights are not imported. `Environment` has no scene ambient colour (Lite has no scene-level ambient term).
- `MeshRenderer` draws `materials[0]` only, and ignores `onReplaced` (a hot-reloaded `.mesh.json` is not redrawn).
- `.basis` textures are refused (`IGX-0509`): Lite exposes no transcoder URL.
- Storage: a 512-character key can encode past the 255-byte file-name limit; no codec caps it, and `packages/core/src/storage/names.ts` says otherwise.
- The umbrella re-exports two `@internal` classes (`Particle2DUpdateSystem`, `Particle2DWriteSystem`); no test holds the rule.
- `isWebGpuAvailable()` tests `"gpu" in navigator`, so `navigator.gpu = undefined` gives a `TypeError`, not `IGX-0701`.
- `npx @ignifx/cli <dir>` cannot pick an executable: the package has two bins and neither is named `cli`. The documented form is `npx --package=@ignifx/cli create-ignifx <dir>`; a `create-ignifx` package or a `cli` bin would restore the short form.
- CLI commands designed and not built: `rename-layer`, `rename-sorting-layer`, `schemas`, `migrate`, `bake` and `bake navmesh`, an atlas import, manifest validation against the runtime. `packages/2d/src/atlas/definition.ts` prints a hint naming `ignifx import atlas`, which does not exist.

### Rendering and lighting

- Lightmap baker: decided as editor work, for editor 0.8 or later (ADR-0040). Dynamic diffuse GI is a candidate for after 1.0, not committed (ADR-0040, Consequences).
- Reflection probes: no GGX prefilter, no capture to a file, no blending while any probe captures every frame; probe resources are freed through undeclared Lite fields.
- Lightmaps: a placement with `uv2: false`, or on a mesh without `uvs2`, is not applied as authored: it logs `IGX-0735` once and samples the whole texture.
- TAA: no per-object velocity for PBR meshes, no floating-origin handling. Ambient occlusion: no history of its own; a render-to-texture camera samples the main view's.
- Shadows: the technique cannot change at run time and a `Light`'s `shadows` record is read once. Soft shadows, area lights and point-light shadows wait on Lite.
- One camera draws to the screen (no split view). The material format has no emissive strength.
- Particles: trails, soft particles (ADR-0025); no `particles-2d` benchmark scene. Terrain: lit foliage and time-driven `displace` (blocked upstream), holes, LOD morphing, more than eight layers, streaming (ADR-0026). Sub-emitters (ADR-0025). Surface shaders on Standard hosts (ADR-0024); the pinned Lite makes `roughness` and `metallic` writable, so letting a surface shader write them is engine work now (untested whether a plugin write lands before lighting). `captureCompositeScreenshot` (ADR-0008).

### 2D, 3D and physics

- 2D: a depth-hosted mixed mode, run-time atlas packing, isometric Tiled maps, 2D lighting, `Animator` driving `SpriteAnimator`, 2D blend spaces.
- 2D physics: Rapier is imported statically (one large chunk); a velocity written before the body is built is dropped; cross-platform determinism needs the `-deterministic` build.
- 3D: `CameraBrain`, `VirtualCamera`, camera shake; root motion; `Animator` has no playhead seek and drops parameter writes made before its state machine exists.
- 3D characters: `ThirdPersonController.isGrounded` returns the raw value, not the slope-classified one; only `ThirdPersonController` has `stepHeight`.
- Navigation: Lite has no navmesh serialization and no `removeAgent`; `NavMeshSurface.prebaked` bakes at run time.
- 3D physics: child colliders do not join an ancestor `Rigidbody` as a compound body; gravity is one global vector (no regional gravity); shape identity in `shapeCast`/`overlap`, per-body damping, gravity factor and sleep control wait on Lite.

### Input, UI, audio and devtools

- Input interactions (`hold`, `tap`, `multiTap`) and key display names.
- `WorldText` created after `app.start()` never draws (`IGX-1308`; Lite cannot remove a text renderable).
- Audio bus effects and devtools analyzers. The devtools stats panel shows a fixed list, though the `show-diagnostics-in-devtools` recipe says custom counters appear there.
- Missing recipes: cross-scene links, local-multiplayer device pairing. Missing gotcha: a `Ray` literal with a short `length` misses silently.

### Desktop and editor host

- `onApplicationPause` has no desktop path: core has no seam for an extension to dispatch it.
- The Electron suite runs on macOS only; Windows and Linux are packaged, never launched; installers, signing, notarization and auto-update are unexercised.
- `style-src 'unsafe-inline'` needs nonces through `@ignifx/ui`; ASAR integrity is off until a signing identity exists.
- Electron is 44; the quarterly bump (ADR-0018) is next due in December 2026. The desktop log has no file sink.
- `@ignifx/editor-protocol` is not on npm, so `packages/editor-host/src/protocol/` is a hand-synchronised copy.
- Editor host: planar 2D gizmos, a sprite selection outline, thumbnails for sprite animations, tilemaps and compressed textures, box selection of entities that draw nothing, multi-selection pivots, live scene settings; in the game view post-processing, parallax, off-screen tilemap chunks and UI text.

### Tooling and documentation

- Remove the TypeScript 6 alias when TypeScript 7.1 ships a programmatic API (ADR-0007).
- No architecture document covers particles or terrain; ADR-0025 and ADR-0026 are their design records.
- Adapter comments say "verified against 1.27.0"; re-check them against the pinned Lite version.

### Tests and measurements not done

- Visual goldens for TAA, ambient occlusion, contact shadows, SSGI, AgX and the baked-lighting scenes.
- GPU cost of HDR bloom, SSGI, contact shadows, ambient occlusion, auto exposure and baked lighting; the `high` tier on its own device class.
- Device loss for the HDR target, scene inputs, ambient occlusion, auto exposure, probes, lightmaps and text; reflection-probe ±Y faces and a rotated environment.
- A browser hot-reload round trip that edits a file.

### Unconfirmed (reported, not reproduced)

- A static sprite moved by a gizmo in edit mode is not redrawn (the editor may work around it).
- `overlapBox` wholly inside a tilemap's merged outline finds nothing where `overlapCircle` does.
- A capsule wedged into two overlapping static boxes is pushed through the wall.
- A character rests about 9 cm above standing height after landing.
- Independently animated instances of one model asset; the displacement margin on `Model` material overrides and terrain chunks; a bilateral upsample for half-resolution ambient occlusion.
- Whether any upstream ask has been filed: the repository links no Lite issue.

### Candidates, not commitments

Feature wishes with no code behind them.

Compute shaders for game code; screen-space reflections; depth of field, chromatic aberration, motion blur, FXAA; volumetric fog; subsurface scattering; water; decals; video and texture-array assets; CSG; procedural sky; joints, ragdoll, cloth, vehicles; inverse kinematics, retargeting, morph-target weights; Gaussian splats; runtime auto-tiling; nine-slice and masks for world sprites; 2D skeletal animation; replays; captions and other accessibility helpers; a mobile template; Steam and portal adapters; dialogue, behaviour trees, a cutscene timeline; pooling and hit-stop helpers; pseudo-localisation and right-to-left text; adaptive music; a production error overlay; achievements; mod support; photo mode.

Out of scope (`docs/architecture/00-overview.md` §7): an editor inside the engine, multiple worlds or on-screen viewports, networking, WebXR. Also not planned before 1.0: worker rendering, asset packs and level streaming.

## Decisions waiting for the owner

- **Constitution against practice.** §9.4 records a private-repository exception, and the repository is public. §7.4 requires a human to approve every merge, and `main` has no branch protection. §4.3 and §7.6 speak of phases, estimates and exit criteria, which this plan does not have. The status line calls the 2026-09-11 revision "proposed" while its text is in force. `docs/architecture/05-assets-and-loading.md` forbids code from a network host at run time, which §9 does not.
- **Provenance.** Set `"provenance": true` in the 17 manifests and correct `release.yml`'s comment, or record why not. Unchecked: whether npm's Trusted Publisher settings need a change.
- **Vulnerability reporting.** `SECURITY.md` names GitHub private vulnerability reporting, which is disabled on the repository. Enable it or name another channel.
- **Branch protection** on `main`, which `CODEOWNERS` and §7.4 assume.
- **Ratify or reject** what is implemented and unratified: ADR-0014, 0021, 0024, 0025, 0026, and ADR-0028's amendment of 2026-10-29.
- **Seven proposed ADRs**, none built: optional asset references (0033), project documents gate scene load (0034), scene number precision (0035), canonical scene text (0036), uid collisions on load (0037), `MeshRenderer.uniqueMaterial` (0038), `ModelNodeAttachment` (0039).
- **Website ADRs.** ADR-0019 and 0020 concern `ignifx-website`, which cites them; keep them here or move them.
- **Stateless particles.** Lite has compute, the condition ADR-0025 names for revisiting its vertex evaluator.
- **Template environment map.** The 3D templates' `high`-tier `ReflectionProbe` is idle because they load no environment; shipping one changes the `high` goldens.
- **Edit mode.** Audio preview and a listener on the editor camera (ADR-0028, open questions 6 and 7).
- **Agent evaluation** (a fresh agent builds a recipe from the skill alone): whether the practice continues.
- **Architecture documents:** standards that outrank ADRs and code (§10.1), or descriptions of the code.
- **Skills:** whether shipped pages keep pointers into `docs/`; a generated index in place of the 2 MB umbrella API page; inherited members in API pages; how an installed project finds subsystem skills.
- **Designed, never built; schedule or drop:** `DayNightCycle`, `SimpleWater`, `FogVolume`, `Model.expandToEntities()`.

## API freeze

Proposed by an API review in September 2026 and undecided; nothing here is a rule until the owner decides it. Seven API reports have never been reviewed: `particles`, `particles-2d`, `terrain`, `editor-host`, `editor-host-vite`, `core-prefab`, `cli-tilemap`.

- **Renames:** `onComplete` → `onCompleted`; `pointerOverUi` → `isPointerOverUi`; `activeInHierarchy` → `isActiveInHierarchy`; `approximately` → `isApproximately`; `reducedMotion` → `prefersReducedMotion`; `compositeIsVector` → `isVectorComposite`; `onOneWayPlatforms` → `respectOneWayPlatforms`; `needsRebuild` → `shouldRebuild`; `ManualClock.advance(milliseconds)` → `(ms)`; `PROJECTIONS` → `CAMERA_PROJECTIONS`; `FOG_MODE_NAMES` → `ENVIRONMENT_FOG_MODES`; `Storage` → `AppStorage`; `TextMetrics` → `UiTextMetrics`; `Physics2DMaterialValues` → `PhysicsMaterialValues2D`; `ControlSpec`/`ControlDescriptor` → `ControlDefinition`; `LocaleDocument` → `LocaleDefinition`; `centre` → `position` in 2D queries; `coneInnerAngleRadians` → `…Rad`.
- **Pick one:** `center` (3D) or `offset` (2D) on colliders; `Token` or `Key` for typed lookup markers; `releaseGpu`/`isReleased` or `dispose`/`isDisposed` on assets; whether seconds-valued fields take a `Seconds` suffix; a `Px` suffix on `UiSurfaceMetrics`, `UiLayout`, `HudPlacementInput`, `Camera2D.referenceResolution`, `GridAtlasImportOptions` and `TilemapDefinition.tileWidth`/`tileHeight` (which moves on-disk keys); `ignifx-probes` and `ignifx-lightmap` against the dotted `ignifx.<name>` of every other format id.
- **Exceptions the code takes, absent from standards §5.1:** equality comparators (`equalsWithEpsilon`); `was*ThisFrame`; multiplexed, progress and pre-transition signals (`onEvent`, `onWindowEvent`, `onProgress`, `onUnloading`, `onReady`); wire-format keys (`SpriteFrameDefinition.x/y/w/h`); `pickAsync` and `instantiateAsync`.
- **Conventions the code follows, unwritten:** `destroy`, `dispose`, `release`, `close` and `remove` are distinct verbs; `<Name>Options` is passed to a factory, `<Name>Settings` with `default<Name>Settings()` is resolved configuration; `create*` is the only factory prefix; `2D` goes last in a name; `*Definition` names a declared shape; an `as const` table is the plural of its union; a `Name` suffix (`SupportStateName`, `SpriteBlendName`, `ShadowTechniqueName`) marks a name whose bare form a Lite-layer declaration already takes.
- **Release tags:** `NavigationService.crowd`/`.plugin` and `Animator.manager` are `@public` and return `@beta` Lite types. The 33 `ae-forgotten-export` warnings are not accepted as a class, so a new one is invisible; `LitePhysicsWorld`, `LitePhysicsBody`, `RapierWorld` and `RapierBody` back public escape hatches a game cannot name.

## Upstream asks (Babylon Lite)

`docs/architecture/07-rendering.md` §8, "Upstream asks", is the list: each ask by name, checked against the pinned typings, with the workaround in use. Three more gaps in Lite are outside that list: navmesh serialization, `removeAgent`, and removal of a text renderable (see the navigation and `WorldText` items above). None has a tracked issue.
