# ignifx Engineering Plan

**Status:** v1 (2026-09-05) · **Owner:** Astrum Forge Studios · **Precedence:** below constitution, standards, architecture docs, ADRs (`CONSTITUTION.md` §10.1) · **Living document** (`CONSTITUTION.md` §7.6)

This plan takes ignifx from an empty repository to a 1.0 release. It is ordered so that every phase produces something runnable and testable, each phase's riskiest unknown is retired by a spike before the phase's API is frozen, and documentation ships with code rather than after it.

---

## 1. Assumptions

- **Team:** one lead engineer (owner) coordinating AI coding agents, with occasional contributors. Agents draft; humans approve (`CONSTITUTION.md` §7.4). Estimates are in engineer-weeks of coordinated effort and carry ±40% uncertainty until Phase 2 calibrates them.
- **Review bandwidth** is the scarcest resource: every merge needs a human approval (`CONSTITUTION.md` §7.4), and physics, rendering, and determinism code takes disproportionate review time per line. Each phase budgets approver-hours next to its estimate (rule of thumb: 25% of engineer-weeks), and a phase does not start while the previous phase's review queue is open.
- **Foundation facts** (verified 2026-09-05): `@babylonjs/lite` 1.27.0; TypeScript 7.0.2 (native) with `@typescript/typescript6` for API-dependent tools; Node 24 LTS; pnpm 11; Vite 8; Vitest 5; Electron 44. See `docs/standards/coding-standards.md` §1.
- **Scope of 1.0:** the packages in `docs/architecture/00-overview.md` §2, four reference templates (2D top-down, 2D side-scroller, 3D third-person, 3D first-person), the Agent Skill and docs harness, the public website shell, Electron support. No editor, no networking, no XR before 1.0 (`00-overview.md` §7).
- **Cadence:** trunk-based, releasable `main`, a `0.x` minor release at the end of each phase that changes public API.

## 2. Milestone map

| Phase | Name                                             | Outcome                                                                                                             | Release | Estimate                 |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------ |
| 0     | Foundation                                       | Repo, toolchain, CI, docs harness skeleton, empty packages, website shell                                           | —       | 1–2 wk                   |
| 1     | Kernel                                           | App/World/Entity/Component/Script, Transform on Lite nodes, Time and phases, signals, coroutines, headless stepping | 0.1     | 3–4 wk                   |
| 2     | Rendering and assets                             | Camera/Light/MeshRenderer/Model/Environment/materials on Lite; asset service and loaders; scene format v1; prefabs  | 0.2     | 4–5 wk                   |
| 3     | Input                                            | Action maps, devices, pointer lock, rebinding                                                                       | 0.3     | 2 wk                     |
| 4     | Physics 3D                                       | Havok on the simulation scene, colliders, triggers, character controller, queries, interpolation                    | 0.4     | 3–4 wk                   |
| 5     | Audio                                            | Buses, sources, listener, clips, music player                                                                       | 0.5     | 2 wk                     |
| 6     | 2D toolkit + 2D physics                          | Camera2D, sprites, animation, atlases, tilemaps, parallax, Rapier 2D, two 2D templates                              | 0.6     | 4–5 wk                   |
| 7     | 3D toolkit                                       | Character/camera rigs, Animator, navigation, two 3D templates                                                       | 0.7     | 4–5 wk                   |
| 8     | UI                                               | DOM overlay host, anchors, world/HUD text, virtual controls, localization                                           | 0.8     | 2 wk                     |
| 9     | Platform                                         | Storage, Electron package, desktop templates, browser fallback page                                                 | 0.9     | 2–3 wk                   |
| 10    | Devtools                                         | Overlay panels, inspector, hot reload                                                                               | 0.9.x   | 2–3 wk                   |
| 11    | Docs harness and skill completion                | Generated references, recipes, subsystem skills, llms.txt, drift gates on                                           | 0.9.x   | 2–3 wk (plus continuous) |
| 12    | Templates, examples, website content, benchmarks | Polished templates, example gallery, site content, baselines                                                        | 0.9.x   | 3 wk                     |
| —     | Hardening and API freeze                         | Two consecutive minors without breaking changes, budgets met, browser matrix green                                  | 1.0     | 4–6 wk                   |

Phase 5 (audio) can run in parallel with Phase 4; Phase 3 (input) must finish before Phases 6 and 8, whose exit criteria need gamepad/touch actions and focus suppression; Phase 8 can then run in parallel with Phase 7. See §6. Total to 1.0: roughly 40–50 engineer-weeks.

## 3. Phase details

Each phase lists **Spikes** (retire risk first), **Deliverables**, **Exit criteria** (all must be true and verified in CI, except criteria explicitly marked _manual_, which are recorded in a tracking issue), and **Docs**.

### Phase 0 · Foundation (1–2 wk)

Spikes

- S0.1 Toolchain proof: a hello package builds with `tsdown` (`isolatedDeclarations`), type-checks with TS 7 `tsc --build`, lints with Oxlint + tsgolint, and runs a Vitest browser test in Chromium with WebGPU that calls `createEngine` on an `OffscreenCanvas`/canvas (headless Chrome with `--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan` or SwiftShader).
- S0.2 TS6 alias proof: API Extractor and TypeDoc run against the hello package through the `typescript` → `@typescript/typescript6` alias (ADR-0007).

Deliverables

- Root config: `package.json`, `pnpm-workspace.yaml` (catalog with exact `@babylonjs/lite@1.27.0`, TS alias pair, `allowBuilds`), `turbo.json`, `tsconfig.base.json`, `lefthook.yml`, `commitlint.config.ts`, `renovate.json`, `.nvmrc` (24), `.editorconfig`.
- Lint/format: `.oxlintrc.json`, `eslint.config.ts` (gap rules + placeholders for the custom `ignifx/*` rules, implemented in Phase 1), `.oxfmtrc`.
- Empty packages with barrels, `api/` reports, `skills/<name>/SKILL.md` stubs: `core`, `input`, `physics`, `physics-2d`, `audio`, `2d`, `3d`, `ui`, `electron`, `devtools`, `vite-plugin`, `cli`, `ignifx`.
- CI: `ci.yml` (all jobs from standards §12, some no-op), `release.yml` (Changesets + Trusted Publishing, dry-run), `website.yml`.
- Docs harness skeleton: `docs:api`, `docs:schemas`, `docs:recipes` scripts (empty output), example-extraction checker, skill lint; `.claude/skills/ignifx` symlink.
- `website/`: Vite + TypeScript SPA shell, placeholder page, `public/llms.txt`, separate deploy (design deferred).
- `create-ignifx` CLI skeleton that copies a template directory.
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, PR template with the definition-of-done checklist.

Exit criteria

- `pnpm check` passes on a clean clone in under 3 minutes; CI green on all jobs; a tagged `0.0.1` dry-run publish produces valid packages (publint, arethetypeswrong).
- Browser test job proves WebGPU is available in CI (software adapter acceptable).

Docs: standards table updated with the exact pinned versions; ADR-0009 confirmed.

Status (2026-09-05): delivered in the working tree and awaiting owner review. Met locally: `pnpm check` green in 15 s, WebGPU browser tests pass in Chromium (macOS; Linux flags unverified, see ADR-0009), dependency layering clean, dry-run publish of all 14 packages passes publint and arethetypeswrong. Outstanding until the first push: CI green on GitHub, the tagged `0.0.1` dry run, the npm scope claim (§9.1).

### Phase 1 · Kernel (3–4 wk) → 0.1

Spikes

- S1.1 Transform on Lite nodes: create `TransformNode`s, parent them by direct `parent`/`children` linking and by `setParent`, read `worldMatrix`/`worldMatrixVersion`, confirm that pure transform nodes need not be added to the Lite scene and that a mesh parented under them renders (Phase 2 confirms visually; Phase 1 verifies matrices numerically headless).
- S1.2 Single-callback loop: register one `onBeforeRender` after extensions; verify callback order relative to a `createHavokWorld` registration (physics callback must not run inside the render scene).
- S1.3 Headless determinism: `app.step(1/60)` × N produces identical transforms across runs and across Node/Chromium.

Deliverables (`@ignifx/core`)

- `createApp`, `App` (start/stop/dispose/step, services, settings, `onError`, diagnostics), extension host (`04-extensions.md`), core extension.
- `Time`, scheduler with phases, fixed loop, lifecycle flushes, destroy queue, coroutines (`01-lifecycle-and-time.md`).
- `World`, `SceneInstance` (implicit default scene), `Entity`, `Transform`, `Component`, `Script`, `Component.define` schema kinds, registration and `typeId`s, `Signal`, tags and layers, `LayerMask`.
- Math module (`Vec2/3/4`, `Quat`, `Mat4`, `Color`, `MathUtils`) structurally compatible with Lite's interfaces, with `ToRef` variants.
- Errors (`IgnifxError`, codes 01xx–04xx), logging, diagnostics core.
- Custom lint rules `ignifx/*` (standards §6.5).
- Vitest projects (node + browser) with fake clock utilities.

Exit criteria

- Lifecycle order test suite encodes every row of `01-lifecycle-and-time.md` §3–§6 and passes headless.
- Determinism test (S1.3) passes; coroutine semantics tests pass; 90% coverage on core.
- Two apps can run in one process (no globals).
- API report and generated `references/api/core.md` committed; entry `SKILL.md` documents `createApp`, `Entity`, `Script`, `Time`, `Signal` with compiling examples.

Status (2026-09-05): delivered in the working tree and awaiting owner review. Met locally: the lifecycle suites (`packages/core/test/lifecycle/**`) encode the frame order and the activation/enabling/destruction rules of `01-lifecycle-and-time.md` §3–§6 and pass headless; the S1.3 determinism test reproduces hash `7b79fbda` across Node and Chromium (ADR-0003 Validation, `packages/core/test/determinism/**`); the coroutine semantics suite passes; `pnpm test` runs 1,132 tests in 79 files with 97.5% line and 92.1% branch coverage, over the 90% core floor `vitest.config.ts` enforces; `packages/core/test/app/app.test.ts` proves two apps run independently in one process; `packages/core/api/core.api.md` and the generated `skills/ignifx/references/api/core.md` are committed, and the entry `SKILL.md` documents `createApp`, `Entity`, `Script`, `Time`, and `Signal` with examples the documentation harness compiles. Outstanding until CI runs: every exit criterion re-verified on GitHub Actions (Linux WebGPU flags still unverified, ADR-0009), and the browser project on a non-macOS runner.

### Phase 2 · Rendering and assets (4–5 wk) → 0.2

Spikes

- S2.1 Camera-as-child: a Lite `FreeCamera` parented under an entity node follows the entity's transform; orthographic toggle works; viewport mapping verified against `resolveCameraViewport`.
- S2.2 Runtime adds after `registerScene`: measure frames-to-visible for a new material family and for a pre-registered one; decide default warm-up behaviour.
- S2.3 Feature opt-ins: shadows via `registerSceneWithShadowSupport`, `enableDeviceLostSceneRecovery` ordering; forced device loss (`forceWebGpuDeviceLossForTesting`) recovers a simple scene.
- S2.4 Asset pipeline: `.glb` fetched as bytes with progress + abort into `loadGltf`; `cloneTransformNode` instancing shares GPU buffers (memory measured).

Deliverables

- Lite adapter: engine creation with capability check, render scene, `Camera`, `Light` (+ shadow generators), `MeshRenderer`, `Model`, `Environment`, `MaterialAsset` (PBR/Standard/Shader), `PostProcessStack` (bloom, SMAA, image processing), picking, device-loss wiring, screenshots, diagnostics (`07-rendering.md`).
- Asset service: addresses, handles, refcounts, priority queue, cancellation, manifest, core loaders (texture, model, scene, material, environment, font, json/text/binary), hot reload hooks (`05-assets-and-loading.md`).
- `@ignifx/vite-plugin`: manifest generation, `.meta.json`, JSON Schema validation, public asset copying, HMR channel.
- Serialization: scene format v1, instances/overrides, `serializeScene`, JSON Schema generation (`06-serialization-and-scene-format.md`).
- `examples/hello-cube`, `examples/gltf-viewer`; first visual golden tests.
- `benchmarks/` seed: hello-cube and a 1,000-entity scene with frame-time **and heap-growth** baselines (bounded heap growth over 600 headless steps enforces the allocation-free rule of the standards).

Exit criteria

- Visual tests: hello cube, PBR model with IBL and shadows, orthographic camera, post-process stack — goldens committed.
- Scene round-trip test: load → serialize → load produces byte-identical output; instance overrides applied and re-derived.
- Asset tests: refcount to zero unloads; abort cancels; hot reload swaps a texture in the browser test.
- Device-loss recovery test passes for the basic scene; documented unrecoverable cases produce `onDeviceRecoveryFailed`.
- Bundle-size baseline for `examples/hello-cube` recorded (target: ignifx core + Lite minimal scene under 250 KB gzipped; revisit after measurement).
- Skill: `references/formats/scene.md`, `material.md`, recipes "load a model", "spawn a prefab".

### Phase 3 · Input (2 wk) → 0.3

Deliverables (`@ignifx/input`): devices, action maps, bindings/composites/processors, control schemes, pointer lock, cursor, `.input.json` loader, rebinding, `PlayerInput`, headless simulation API (`08-input.md`).

Exit criteria: frame-consistency tests (edge flags stable across fixed steps), composite/processors unit tests, rebinding round trip, gamepad mapping table tests, browser test with synthetic DOM events; skill subsystem file `packages/input/skills/input/SKILL.md`.

### Phase 4 · Physics 3D (3–4 wk) → 0.4

Spikes

- S4.1 Simulation scene: Havok world on a null-engine scene stepped by `stepScene` while meshes render in the render scene; determinism across runs; Havok WASM served through the manifest.
- S4.2 Collision body identities: attempt upstream PR `onPhysicsCollisionBodies`; in parallel prototype the adapter-internal drain with a layout guard test. Decide by end of week 1; if still undecided, ship the drain behind the ADR-0013 opt-in flag, document trigger events as the default gameplay mechanism, and revisit at 0.4.1 (R-4).
- S4.3 Interpolation: display-pose write/restore does not leak into Havok (kinematic and dynamic cases).

Deliverables (`@ignifx/physics`): service, `Rigidbody`, colliders, `PhysicsMaterial`, `CharacterController`, layer matrix, queries, events, interpolation, debug viewer hook, settings (`09-physics.md`).

Exit criteria: analytic free-fall test (Lite's own headless example) reproduced through ignifx; stacking stability scene; trigger and collision enter/stay/exit tests; character controller slope/step and interpolation tests; determinism test on three platforms in CI (Linux, macOS, and Windows runners); forced device loss with active bodies and coroutines recovers with the simulation intact; physics subsystem skill.

### Phase 5 · Audio (2 wk) → 0.5

Deliverables (`@ignifx/audio`): service, buses from `.audio.json`, `AudioClip` loader (static/streaming), `AudioSource`, `AudioListener`, `MusicPlayer`, unlock flow, pause behaviour, headless stub (`10-audio.md`).

Exit criteria: browser tests with an `OfflineAudioContext` (Lite supports it) for bus routing and spatial attenuation; unlock flow test with a synthetic gesture; headless timing test for `onEnded`; audio skill.

### Phase 6 · 2D toolkit and 2D physics (4–5 wk) → 0.6

Spikes

- S6.1 Sprite sync at scale: 10,000 static tiles + 1,000 moving sprites in Lite layers at 60 fps; chunking strategy for tilemaps.
- S6.2 Rapier 2D: bundle impact (`-compat` inline vs. served `.wasm`), determinism, character controller behaviour on slopes/one-way platforms (ADR-0006 confirmation).
- S6.3 Pixel-perfect: integer zoom + DPR strategy produces crisp output on 1×, 1.5×, 2× displays (visual goldens).

Deliverables (`@ignifx/2d`, `@ignifx/physics-2d`): `Camera2D`, `SpriteRenderer`, atlases and importers (TexturePacker, Aseprite, grid), `SpriteAnimator`, `Tilemap` + renderer + collider with Tiled/LDtk importers, `ParallaxLayer`, sorting layers, Y-sort, 2D picking, layer effects; `Rigidbody2D`, colliders 2D, `CharacterController2D`, queries, events; templates `2d-topdown` and `2d-sidescroller` (`11-2d-toolkit.md`).

Exit criteria: both templates playable with keyboard, gamepad, and touch; visual goldens; tilemap import tests for Tiled and LDtk fixtures; 2D physics determinism and controller tests; performance budget met (S6.1 numbers recorded as baselines); 2D and physics-2d skills.

### Phase 7 · 3D toolkit (4–5 wk) → 0.7

Spikes

- S7.1 Animator on ignifx clock: detach animation groups from a loaded model, drive with `updateAnimationManager`, blend two clips with `crossFadeAnimationGroups`, masks with `createAnimationGroupMask`; verify `lateUpdate` sees the posed skeleton.
- S7.2 Navigation: Recast WASM via `createNavigationPluginAsync`, crowd update in `FixedUpdate`, agent positions written to transforms.

Deliverables (`@ignifx/3d`): `ThirdPersonController`, `FirstPersonController`, `ThirdPersonCamera`, `Animator` (asset + state machine + events + blend trees 1D), tweens (core), `NavMeshSurface`/`NavMeshAgent`/`NavMeshObstacle`, `LodGroup`, `Billboard`; templates `3d-third-person` and `3d-first-person` (`12-3d-toolkit.md`).

Exit criteria: templates playable; animator state-machine unit tests (transitions, exit time, triggers, events); navigation path tests headless; camera collision test; 3D skill. `CameraBrain`/`VirtualCamera` are stretch (7b) and may slip to 0.9.x.

### Phase 8 · UI (2 wk) → 0.8

Deliverables (`@ignifx/ui`): overlay host and layers, scaling modes, focus routing, `WorldAnchor`, `WorldText`/`WorldText2D`/`HudText` on Lite text, `VirtualJoystick`/`VirtualButton`, `Dialog`/`Toast`/`LoadingScreen`, `app.i18n` (`13-ui.md`).

Exit criteria: focus routing test (typing in a field does not fire actions); anchor placement visual test; text rendering golden; templates use the loading screen and a pause menu; UI skill.

### Phase 9 · Platform and Electron (2–3 wk) → 0.9

Spikes

- S9.1 Electron 44 + WebGPU on macOS, Windows, Linux (flags, `ignifx://` protocol serving the manifest, pointer lock, gamepads); document per-OS caveats.

Deliverables: `app.platform`, `app.storage` backends (IndexedDB, Electron FS, memory/Node), `@ignifx/electron` (main/preload/renderer), `create-ignifx --desktop` variants of the four templates, electron-vite + electron-builder configs, browser fallback page (`14-platform-electron.md`).

Exit criteria: desktop templates build installers on three OSes in CI (electron-builder, unsigned); storage round-trip tests per backend; save/load round trip through `serializeScene` + `app.storage` including instanced entities with overrides and a prefab-hash mismatch test; forced device loss in a running desktop template recovers with physics, coroutines, and audio intact; security checklist test (window options asserted); electron skill.

### Phase 10 · Devtools (2–3 wk) → 0.9.x

Deliverables (`@ignifx/devtools`): overlay with all panels in `15-devtools-and-diagnostics.md` §4, schema-driven inspector, physics viewer toggle, script hot reload (patch/recreate policies, `onHotReload`), scene reload.

Exit criteria: hot reload tests (state preserved under patch; lifecycle re-run under recreate); inspector edits reflect immediately; zero-cost-when-closed benchmark; devtools skill.

### Phase 11 · Docs harness and skill completion (2–3 wk, then continuous)

Deliverables: `docs:api` with TypeDoc markdown for every package; `docs:schemas`; `docs:recipes` from `examples/recipes/*`; example compile/run checks; API-report gate with skill-change heuristic; skill lint; `website/public/llms.txt`; subsystem skills reviewed against one template; `AGENTS.md` finalized (`16-docs-harness-and-skill.md`).

Exit criteria: all harness checks enforced (not advisory) in CI; SKILL.md at most 500 lines; _manual_: an agent given only the repo and the skill builds the "spawn a prefab on click" recipe in a fresh template without reading source (recorded in a tracking issue; replaced by a scripted agent-evaluation harness when tooling permits).

### Phase 12 · Templates, examples, website content, benchmarks (3 wk)

Deliverables: polish of the four templates (art, audio, menus, settings/rebinding screens, save/load); `examples/` gallery (≥ 12 recipes); `benchmarks/` scenes with baselines (frame time, bundle size per template); website content pages (features, getting started, docs links, gallery) still on the plain Vite SPA (visual design remains a later task per the brief).

Exit criteria: bundle ceilings and frame budgets recorded and enforced; website deploys from `website.yml`; getting-started page verified by following it on a clean machine.

### Hardening and 1.0 (4–6 wk)

- API review of every package report; rename/removal pass; freeze.
- Two consecutive minor releases (0.9.x → 0.10, 0.11) without breaking changes (`CONSTITUTION.md` §4.3).
- Browser matrix run (Chrome, Edge, Safari 26, Firefox Windows/macOS, Chrome Android, Electron on three OSes).
- Security review of Electron templates and dependency audit; license notices generated.
- Migration infrastructure switched on (`docs/migrations/`, `registerFileMigration`, format version bump path) even though no migration exists yet.
- 1.0 release notes, website launch content.

## 4. Cross-cutting workstreams

| Workstream                  | Ongoing responsibilities                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upstream (Babylon Lite)** | Track releases weekly; maintain the adapter compatibility suite; file issues/PRs for: public physics step, `onBeforeRender` disposer, collision events with body identities, per-body damping/gravity factor, point-light shadows, device-loss recovery of PCF/CSM and glTF IBL. Upgrade Lite at phase boundaries only. |
| **Performance**             | Benchmarks and baselines from Phase 2 on; budgets in standards §7; profile each template before its release.                                                                                                                                                                                                            |
| **Docs and skill**          | Every PR updates docs; harness gates from Phase 11 become blocking; quarterly "agent onboarding" evaluation.                                                                                                                                                                                                            |
| **Release engineering**     | Changesets discipline; Trusted Publishing; Renovate triage weekly; Electron quarterly bump; TS 7.1 migration when available (remove the TS6 alias, ADR-0007).                                                                                                                                                           |
| **Security**                | Dependency policy, Electron baseline tests, no telemetry audit before each release.                                                                                                                                                                                                                                     |

## 5. Risk register

| Id   | Risk                                                         | Likelihood / impact                 | Mitigation                                                                                                                                                        |
| ---- | ------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Lite breaking changes every few releases                     | High / Medium                       | Exact pin, adapter boundary (ADR-0002), compatibility suite, upgrade only at phase boundaries                                                                     |
| R-2  | TS 7 tooling gap (no API until 7.1) breaks a tool we rely on | Medium / Medium                     | TS6 alias recipe (ADR-0007); tsdown dts path needs no API; Oxlint primary                                                                                         |
| R-3  | Lite docs and `index.d.ts` disagree                          | High / Low                          | Treat `.d.ts` as truth; adapter tests per API used; inventory refreshed at each upgrade                                                                           |
| R-4  | Collision events lack body identities                        | Certain today / High                | Upstream PR first; ADR-0013 opt-in internals drain with layout guard as fallback; trigger events documented as the gameplay default until resolved (Phase 4 S4.2) |
| R-5  | Runtime-added meshes appear late (material swap compile)     | Medium / Medium                     | Warm-up of material families before `registerScene`; `renderer.warmUp`; document                                                                                  |
| R-6  | Mesh removal is terminal in Lite                             | Certain / Medium                    | Visibility toggles for hide; destroy recreates; tests                                                                                                             |
| R-7  | WebGPU unavailable on Firefox Linux/Android, older devices   | Certain / Medium                    | Clear unsupported page; matrix documented; no fallback by decision (ADR-0001)                                                                                     |
| R-8  | Electron WebGPU flag/driver issues, especially Linux         | Medium / Medium                     | S9.1 spike on three OSes; flags in the window factory; Linux best-effort                                                                                          |
| R-9  | Rapier 2D bundle/determinism issues                          | Low / Medium                        | S6.2 spike; Box2D v3 fallback (ADR-0006)                                                                                                                          |
| R-10 | Performance of sprite sync and tilemaps in Lite layers       | Medium / High for 2D                | S6.1 spike early in Phase 6; chunking, static flags, SoA buffers                                                                                                  |
| R-11 | Agents drift docs or introduce undocumented API              | Medium / Medium                     | Harness gates, API report gate, review rules (standards §15)                                                                                                      |
| R-12 | Scope creep toward an editor                                 | Medium / High                       | Constitution §1.3; editor explicitly post-1.0; schemas/inspector metadata keep the door open                                                                      |
| R-13 | WASM payloads (Havok ~2 MB, Recast, Rapier) hurt first load  | Medium / Medium                     | Lazy loading options, preload groups, manifest-served `.wasm` with caching                                                                                        |
| R-14 | Determinism differences across CPUs/WASM engines             | Medium / High for future networking | Three-OS determinism gate from Phase 4; published list of guaranteed vs best-effort operations; per-platform determinism is the only promise (`09-physics.md` §8) |

## 6. Dependency graph

| Phase                                     | Requires                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| P1 Kernel                                 | P0                                                                                 |
| P2 Rendering and assets                   | P1                                                                                 |
| P3 Input                                  | P2                                                                                 |
| P4 Physics 3D                             | P2                                                                                 |
| P5 Audio                                  | P2                                                                                 |
| P6 2D toolkit + 2D physics                | P3, P4 (shared stepping model and interpolation)                                   |
| P7 3D toolkit                             | P3, P4                                                                             |
| P8 UI                                     | P3                                                                                 |
| P9 Platform                               | P2 for storage and `@ignifx/electron`; P6 and P7 for the desktop template variants |
| P10 Devtools                              | P8 (overlay host), P1 (schemas)                                                    |
| P11 Harness completion                    | P10; harness checks accumulate from P0 onward                                      |
| P12 Templates, examples, site, benchmarks | P6, P7, P8, P9, P10                                                                |
| Hardening → 1.0                           | P11, P12                                                                           |

## 7. MVP checklist (what "feature complete" means)

- [ ] `createApp`, extensions, settings, headless mode
- [ ] Entity/Component/Script lifecycle exactly as `01-lifecycle-and-time.md`
- [ ] Scene format v1 with instances/overrides; save/load round trip
- [ ] Assets with refcounts, progress, cancellation, manifest, hot reload
- [ ] Rendering: cameras (persp/ortho), lights + shadows, meshes, glTF models, materials, environment, post stack (bloom/SMAA/tone), picking, device loss
- [ ] Input action maps across keyboard/mouse/gamepad/touch, pointer lock, rebinding
- [ ] Physics 3D with interpolation, triggers/collisions, character controller, queries
- [ ] Audio buses, spatial sources, music
- [ ] 2D: camera, sprites, animation, atlases, tilemaps, parallax, Y-sort, pixel-perfect, 2D physics
- [ ] 3D: character and camera rigs, Animator, navigation
- [ ] UI overlay host, anchors, text, virtual controls, i18n
- [ ] Storage; Electron package and desktop templates
- [ ] Devtools overlay and hot reload
- [ ] Docs harness enforced; entry + subsystem skills; llms.txt; website shell with content
- [ ] Four templates, examples gallery, benchmarks with baselines

## 8. Post-1.0 roadmap (not committed)

Editor (schema-driven inspector → scene editor), multi-camera/render targets, worker rendering (`OffscreenCanvas`), particles (Lite node particles), 2D lighting, networking (lockstep/server-authoritative on the deterministic loop), XR when Lite's path is runnable, asset packs, audio effects, root motion, 2D blend spaces, save-game migrations tooling.

## 9. Phase 0 kick-off checklist

1. Claim the `@ignifx` npm scope and the `ignifx` package name (both unclaimed on 2026-09-05); set up npm Trusted Publishing for the GitHub repository.
2. Create the workspace per `docs/standards/coding-standards.md` §2–§3 with the catalog pins.
3. Run spikes S0.1 and S0.2; record results in `docs/adr/0009-monorepo-tooling.md` (append "Validation").
4. Land CI with all jobs; make `main` protected (required checks, one human approval).
5. Publish `0.0.1` dry run; verify `npx skills add` finds `skills/ignifx/SKILL.md`.
