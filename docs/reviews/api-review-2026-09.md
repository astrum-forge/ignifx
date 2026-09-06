# API review, September 2026 — rename/removal pass and freeze proposal

**Status:** review · **Date:** 2026-09-07 · **Base commit:** `d049484` · **Scope:** all 15 API
reports under `packages/*/api/*.api.md` (13,836 lines, 1,439 top-level export declarations outside
the umbrella).

This is the review `docs/plan/engineering-plan.md`'s Hardening section asks for and that
`CONSTITUTION.md` §4.3 makes a precondition of 1.0 ("the public API report has been reviewed and
frozen"). Every report was read against its architecture document
(`docs/architecture/00`–`16`), against `docs/standards/coding-standards.md` §5.1, and against the
package's own `SKILL.md` and the generated `skills/ignifx/references/api/<package>.md`.

Precedence when the documents disagree is `CONSTITUTION.md` §10.1: constitution → coding standards →
architecture → ADRs → plan → skill → code. Where the code drifted from an architecture document the
document wins; where an architecture document contradicts the coding standards the standards win and
the document needs a correction (§8 lists those).

---

## 1. What was checked, and the verdict counts

Each row of the tables in §2–§5 is one finding. 71 findings: 25 applied here, 46 left for the owner.

| Section                                                               | Findings | Verdicts                                                     |
| --------------------------------------------------------------------- | -------: | ------------------------------------------------------------ |
| §2 applied — release-tag contradictions                               |        6 | 5 `rename` (tag only), 1 `internalize`                       |
| §3 applied — the same concept spelled two ways                        |        5 | 3 `remove`, 2 `rename` (one covers a const/type pair)        |
| §4 applied — §5.1 violations and `@internal` leaks                    |       14 | 2 `rename`, 11 `internalize`, 1 `document` (an added export) |
| §5.1 proposals — names an architecture document settles the other way |        9 | 3 `rename`, 6 `keep`-and-carve-out                           |
| §5.2 proposals — §5.1 violations above the size bar                   |        7 | 6 `rename`, 1 `keep`-and-carve-out                           |
| §5.3 proposals — unit suffixes                                        |        9 | 7 `rename`, 2 `document`                                     |
| §5.4 proposals — inconsistencies no document settles                  |       13 | 9 `rename`, 4 `document`                                     |
| §5.5 — verdict `keep`, evidence on record                             |        8 | 8 `keep`                                                     |
| **Total**                                                             |   **71** |                                                              |

No applied rename kept a `@deprecated` alias: `CONSTITUTION.md` §4.2 permits a breaking change in a
`0.x` minor, and every one of them takes a single line in `skills/**` to explain, which is the bar
this pass set for skipping the alias. `keep` rows are findings that looked like violations and turned
out to be justified; they are recorded because a freeze needs the reasoning on file, not just the
outcome.

The most objective measure of the pass is API Extractor's own output, which is recorded inside each
report:

| Warning class                    | Before |  After |  Change |
| -------------------------------- | -----: | -----: | ------: |
| `ae-internal-missing-underscore` |     18 |      3 |     −15 |
| `ae-incompatible-release-tags`   |      7 |      2 |      −5 |
| `ae-forgotten-export`            |     25 |     28 |      +3 |
| **Total**                        | **50** | **33** | **−17** |

The `ae-forgotten-export` count rises by three because internalizing a type that an `@internal`
constructor still takes trades one warning class for the other — five new ones in `@ignifx/ui` and
`@ignifx/devtools`, against two removed in `@ignifx/electron`. That is the right trade: a warning
that the public surface is correctly small replaces a warning that it is wrongly large. §7 proposes
what to do with the class as a whole.

Per report: core 23 → 15, ui 9 → 4, devtools 3 → 1, electron-main 1 → 0, electron-preload 1 → 0;
2d (3), 3d (2), physics (4), physics-2d (4) unchanged; audio, cli, input, electron root, vite-plugin
and the umbrella were and are at 0.

---

## 2. Applied — release-tag contradictions

A `@public` signature that references an `@internal` symbol is incoherent under `CONSTITUTION.md`
§5.4, and API Extractor says so. Seven existed. Five of them — every one outside `@ignifx/3d` — are
fixed here, four by promoting the referenced symbol and one by demoting the referencing one. The four
promoted symbols were already exported from their package barrel, already re-exported by the
umbrella, and already documented in the generated skill API pages: public in fact, `@internal` only
in the tag.

| Symbol                 | Package | Verdict      | Reason                                                                                                                                                                     | Blast radius | Applied                                          |
| ---------------------- | ------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ------------------------------------------------ |
| `MATERIAL_ALPHA_MODES` | core    | rename (tag) | `@internal`, but `@public` `MaterialAlphaModeName` derives from it. Its seven sibling tables in `src/render/**` are all `@public`.                                         |            8 | `@internal` → `@public`                          |
| `MaterialAlphaMode`    | core    | rename (tag) | Same; also the surviving public name for the concept (§3).                                                                                                                 |            8 | `@internal` → `@public`                          |
| `SHADOW_TECHNIQUES`    | core    | rename (tag) | `@internal`, but `@public` `ShadowTechniqueName` derives from it.                                                                                                          |            6 | `@internal` → `@public`                          |
| `TONE_MAPPING_NAMES`   | core    | rename (tag) | `@internal`, but `@public` `ToneMappingCurve` derives from it.                                                                                                             |            6 | `@internal` → `@public`                          |
| `AnchorInput`          | ui      | rename (tag) | `@internal`, but `@public` `computeAnchorPlacement(input: AnchorInput, …)` takes one.                                                                                      |            5 | `@internal` → `@public`                          |
| `UiSystemOptions`      | ui      | internalize  | `@public`, but `UiSystem`'s constructor — the only thing that takes one — is `@internal`, and the interface carried the `@internal` `TextRuntime` into the public surface. |            3 | `@public` → `@internal`, dropped from the barrel |

The two `ae-incompatible-release-tags` left are in `@ignifx/3d`: `NavigationService.crowd` and
`.plugin` are `@public` and return `LiteNavCrowd` / `LiteNavigationPlugin`, which are `@beta`. That
is the ADR-0017 navigation escape hatch and it is deliberate — but §5 lists it as a freeze decision,
because `@public` returning `@beta` is the same category of contradiction and the owner should say
whether the accessors drop to `@beta` or the Lite aliases rise to `@public` with an unstable remark.

### Two renames reverted after testing

`ShadowTechniqueName` → `ShadowTechnique` and `ToneMappingCurve` → `ToneMappingName` were attempted
and **reverted**. The unions those names alias are declared in `src/lite/**`, and re-exporting them
from the barrel makes rolldown's declaration bundler emit the type once as `ShadowTechnique$1` while
`LightShadowSettings.technique` still references a bare `ShadowTechnique`, which API Extractor then
rejects with `ERROR: Internal Error: Unable to follow symbol for "ShadowTechnique"`. The render-layer
alias is what keeps the public d.ts buildable, so it stays. §5.4 records the residue.

---

## 3. Applied — the same concept spelled two ways

| Symbol removed / renamed                       | Package     | Verdict | Reason                                                                                                                                                                                                                      | Blast radius | Replacement                                    |
| ---------------------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ---------------------------------------------- |
| `MaterialAlphaModeName`                        | core        | remove  | `export type MaterialAlphaModeName = MaterialAlphaMode;` — a bare alias of a name the barrel already exported.                                                                                                              |            8 | `MaterialAlphaMode`                            |
| `MATERIAL_ALPHA_MODE_NAMES`                    | core        | remove  | `readonly MaterialAlphaModeName[] = MATERIAL_ALPHA_MODES` — a re-typing of a constant the barrel already exported.                                                                                                          |            6 | `MATERIAL_ALPHA_MODES`                         |
| `PlayStateOptions`                             | 3d          | remove  | Field-for-field identical to `AnimatorPlayOptions`; `Animator.play` forwards its options object into `AnimatorStateMachine.play` unchanged.                                                                                 |            5 | `AnimatorPlayOptions`                          |
| `ASSET_MANIFEST_FORMAT_VERSION`                | vite-plugin | rename  | Same concept as core's `ASSET_MANIFEST_VERSION` (the `formatVersion` literal, value `1`) on the two ends of one handshake; the packages already agree on `ASSET_MANIFEST_FORMAT`, `AssetManifest` and `AssetManifestEntry`. |            8 | `ASSET_MANIFEST_VERSION`                       |
| `Capsule2DDirection` · `CAPSULE_2D_DIRECTIONS` | physics-2d  | rename  | Every other component-level 2D name in the package puts `2D` last (`BodyType2D`/`BODY_TYPES_2D`, `InterpolationMode2D`, `CollisionEventMode2D`).                                                                            |         8, 9 | `CapsuleDirection2D` · `CAPSULE_DIRECTIONS_2D` |

## 4. Applied — coding-standards §5.1 violations and `@internal` leaks

| Symbol                                                                                           | Package     | Verdict     | Reason                                                                                                                                                                                                | Blast radius |
| ------------------------------------------------------------------------------------------------ | ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: |
| `Quat.fromEulerRadians` / `fromEulerRadiansToRef` / `toEulerRadiansToRef`, params `x/y/zRadians` | core        | rename      | §5.1's units row gives **`fromEulerRad`** as its own literal example. The shipped names spelled the unit out. Renamed to `fromEulerRad` / `fromEulerRadToRef` / `toEulerRadToRef`, params `x/y/zRad`. |            8 |
| `requiresFormatHeader`                                                                           | vite-plugin | rename      | §5.1 booleans row: a query method takes an `is`/`has`/`can`/`should` **prefix**. Every other boolean query in the package complies. Renamed to `isFormatHeaderRequired`.                              |            9 |
| `isValidLayer`                                                                                   | core        | internalize | `@internal`, used only inside `packages/core/src`, exported from the barrel and re-exported by the umbrella.                                                                                          |            6 |
| `asDomCanvas`, `resolveDomTarget`                                                                | ui          | internalize | `@internal`; only ui and its own tests use them.                                                                                                                                                      |       20 / 8 |
| `UiHostOptions`, `I18nServiceOptions`, `TextRuntimeOptions`                                      | ui          | internalize | `@internal` option bags of `@internal` constructors.                                                                                                                                                  |    2 / 1 / 1 |
| `TextRuntime`                                                                                    | ui          | internalize | `@internal` class the UI system drives; nothing outside ui touches it.                                                                                                                                |            9 |
| `asDomCanvas`, `resolveDevtoolsTarget`, `DevtoolsServiceOptions`                                 | devtools    | internalize | `@internal`; only devtools uses them. `asDomCanvas` also collided by name with ui's byte-identical copy, which is why the umbrella already excluded one of the two by hand.                           |  23 / 12 / 4 |

**Added, not removed:** `HostFileFilter` is now exported from `@ignifx/electron/main` and
`@ignifx/electron/preload`. `HostOpenDialogOptions.filters` is typed with it on both entry points but
the type was exported only from the package root, leaving both subpath declaration files incomplete
(one `ae-forgotten-export` each). It is the same declaration in `src/host-contract.ts`.

### Umbrella

`packages/ignifx/src/index.ts` no longer re-exports any symbol its declaring package marks
`@internal`. Fourteen names left: the ten internalized above plus the four retired or renamed names
from §3. `packages/ignifx/test/index.test.ts`, `packages/ui/test/barrel.test.ts` and
`packages/vite-plugin/test/index.test.ts` — the three barrel-lock lists — were updated in the same
change, and are the only tests that had to change at all.

---

## 5. Proposals left for the owner

Each row is a real finding with a concrete change, held back because it exceeds the ≤ 10-reference
bar this pass applied, because an architecture document names the current spelling and only the owner
may amend it, or because the standard itself needs a carve-out first.

### 5.1 Names an architecture document currently settles the _other_ way

`CONSTITUTION.md` §10.1 puts the coding standards above the architecture documents, so these are
standards violations that need a documentation correction to fix. None was applied, because
`docs/architecture/**` is out of this pass's ownership.

| Symbol                                                               | Package  | Proposal              | Reason                                                                                                                                                                                                       | Blast radius | Doc that must change                                                |
| -------------------------------------------------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -----------: | ------------------------------------------------------------------- |
| `Tween.onComplete` (signal) and `TweenOptions.onComplete` (callback) | core     | `onCompleted`         | §5.1 signals row: `on` + past tense. Every other signal in core is past tense (`onDestroyed`, `onSceneLoaded`, `onReplaced`, `onApplied`).                                                                   |           47 | `12-3d-toolkit.md` §4 names `onComplete` twice                      |
| `UiHost.pointerOverUi`                                               | ui       | `isPointerOverUi`     | §5.1 booleans: a computed read-only property takes the prefix. Its own sibling `keyboardHasFocus` and the value it feeds, `app.input.uiHasPointer`, both comply.                                             |           10 | `13-ui.md` §1                                                       |
| `Entity.activeInHierarchy`                                           | core     | `isActiveInHierarchy` | §5.1 booleans. `Component.isEnabledInHierarchy` (`03-scripting-and-components.md` §1) — the same shape one class over — already complies, so the pair is asymmetric in the documents as well as in the code. |           34 | `02-scene-graph.md` §4, `01-lifecycle-and-time.md` §6               |
| `Assets.onProgress`                                                  | core     | (no good past tense)  | §5.1 signals row not met. A streaming/progress signal has no natural past tense.                                                                                                                             |           59 | `05-assets-and-loading.md` §4 declares it — or add a §5.1 carve-out |
| `SceneInstance.onUnloading`                                          | core     | (keep; document)      | The only present-participle signal in core (`02-scene-graph.md` §3 declares it) — and correctly so: it fires _before_ the unload, so `onUnloaded` would misstate the timing.                                 |           18 | add a "pre-transition signal" carve-out to §5.1                     |
| `InputAction.wasPressedThisFrame` / `wasReleasedThisFrame`           | input    | (keep; document)      | §5.1 booleans not met, but `08-input.md` §2 defines them verbatim as the Unity-parity model.                                                                                                                 |           80 | add a `was*ThisFrame` carve-out to §5.1                             |
| `Animator.onEvent` (3d) and `SpriteAnimator.onEvent` (2d)            | 3d, 2d   | (keep; document)      | Not past tense, but `12-3d-toolkit.md` §3 (Animator) states the shared vocabulary outright ("so 2D and 3D share one state-machine vocabulary"), and four templates plus one recipe call `.onEvent.connect`.  |           34 | §5.1 carve-out for multiplexed signals                              |
| `Desktop.onWindowEvent`                                              | electron | (keep; document)      | Same multiplexed-signal shape.                                                                                                                                                                               |           34 | as above                                                            |
| `NavigationService.onReady`                                          | 3d       | (keep; document)      | A readiness latch, not an event.                                                                                                                                                                             |            5 | as above                                                            |

### 5.2 §5.1 violations with no doc conflict, above the blast-radius bar

| Symbol                                                     | Package    | Proposal                                                                                        | Blast radius |
| ---------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- | -----------: |
| `approximately(a, b, epsilon)`                             | core       | `isApproximately` — every other boolean-returning free function in core is `is`-prefixed        |           13 |
| `PlatformInfo.reducedMotion`                               | core       | `prefersReducedMotion` — it is `matchMedia("(prefers-reduced-motion: reduce)")`                 |           15 |
| `ManualClock.advance(milliseconds)` / `.set(milliseconds)` | core       | `advance(ms)` / `set(ms)` — the sibling time API uses `Ms` (`Clock.nowMs`, `FrameSample.cpuMs`) |           24 |
| `compositeIsVector(kind)`                                  | input      | `isVectorComposite` — §5.1 wants the token as a **prefix**                                      |           10 |
| `CharacterController2D.onOneWayPlatforms`                  | physics-2d | `respectOneWayPlatforms` — an `on`-prefixed name on a plain schema boolean reads as a signal    |           12 |
| `TilemapCollider2D.needsRebuild()`                         | physics-2d | `shouldRebuild()` (already `@internal`)                                                         |            2 |
| `equalsWithEpsilon` (`Color`, `Vec2/3/4`, `Quat`, `Mat4`)  | core       | keep, and carve equality comparators out of §5.1 explicitly                                     |          233 |

### 5.3 Pixel- and second-valued fields without the §5.1 unit suffix

The unit rule ("seconds, metres, degrees in public APIs; suffix when not — `Ms`, `Px`, `Rad`") is the
single largest source of open findings, and it cuts both ways: some fields are missing a `Px`, and
some carry a redundant `Seconds`.

| Symbols                                                                                                                                                          | Package       | Proposal                                                                                                                                                         |         Blast radius |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------: |
| `UiSurfaceMetrics.cssWidth/cssHeight/deviceWidth/deviceHeight`                                                                                                   | ui            | `…Px` — the TSDoc says "in CSS pixels" / "in device pixels"                                                                                                      |      37 (`cssWidth`) |
| `UiLayout.offsetX/offsetY`, `HudPlacementInput.offsetX/offsetY/targetWidth/targetHeight/blockWidth/blockHeight`                                                  | ui            | `…Px`                                                                                                                                                            |       48 (`offsetX`) |
| `TilemapDefinition.tileWidth/tileHeight`                                                                                                                         | 2d            | `tileWidthPx`/`tileHeightPx` — **wire-format keys move too**                                                                                                     |                   44 |
| `Camera2D.referenceResolution`                                                                                                                                   | 2d            | `referenceResolutionPx` — its own sibling is `viewportSizePx`                                                                                                    |                   33 |
| `GridAtlasImportOptions.{imageWidth,imageHeight,cellWidth,cellHeight,margin,spacing}`                                                                            | 2d            | `…Px` — a pure import helper, no on-disk compatibility argument                                                                                                  |     31 (`cellWidth`) |
| `SpriteFrameDefinition.x/y/w/h`                                                                                                                                  | 2d            | keep as packer-JSON short keys; document the wire-format exception in §5.1                                                                                       |                    — |
| `InputEventRecord.x/y/deltaX/deltaY`, `SimulatedEvent.…`                                                                                                         | input         | keep; add an `@remarks` naming the backing-store pixel space, which today only prose carries                                                                     |                   17 |
| `SpriteClip.durationSeconds`, `MusicPlayer.crossfadeSeconds`, `AnimatorPlayOptions.transitionSeconds`, `PlatformMover.waitSeconds`, `Projectile.lifetimeSeconds` | 2d, audio, 3d | seconds is the **default** unit and needs no suffix (`fixedDeltaTime` is §5.1's own example); the same packages also use bare `duration`, `fadeIn`, `coyoteTime` | 3 / 19 / 17 / 77 / — |
| `BackendSpatialRequest.coneInnerAngleRadians` / `coneOuterAngleRadians`                                                                                          | audio         | `…Rad` — §5.1's example is the abbreviation                                                                                                                      |                    8 |

Because "seconds needs no suffix" and "`*Seconds` is clearer" are both defensible, the freeze
decision the owner has to make is **which** convention §5.1 states, not which symbols get renamed;
the renames follow mechanically.

### 5.4 Vocabulary that is inconsistent but that no document settles

| Finding                                                                                                                                                                              | Packages                      | Proposal                                                                                                                                                                                        |      Blast radius |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: |
| The `as const` table does not read as the plural of its derived union: `PROJECTIONS`/`CameraProjection`, `FOG_MODE_NAMES`/`EnvironmentFogMode`                                       | core                          | `CAMERA_PROJECTIONS`, `ENVIRONMENT_FOG_MODES` — the other eight pairs in core already mirror                                                                                                    |              6, 6 |
| `SHADOW_TECHNIQUES`/`ShadowTechniqueName`, `TONE_MAPPING_NAMES`/`ToneMappingCurve`                                                                                                   | core                          | no mechanical fix: the render-layer alias exists because the lite-layer union cannot be re-exported (see §2)                                                                                    |              4, 4 |
| `Storage` is rolled up as `Storage_2` because it collides with the DOM lib's global `Storage`                                                                                        | core                          | `AppStorage` or `StorageService`                                                                                                                                                                |                44 |
| `TextMetrics` is rolled up as `TextMetrics_2` for the same reason                                                                                                                    | ui                            | `UiTextMetrics`                                                                                                                                                                                 |                 — |
| `Physics2DMaterialValues` breaks its own package's trailing-`2D` convention: `class PhysicsMaterial2D implements Physics2DMaterialValues`                                            | physics-2d                    | `PhysicsMaterialValues2D`                                                                                                                                                                       |                14 |
| `Collider.center` / `CharacterController.center` (3d) vs `Collider2D.offset` / `CharacterController2D.offset` (2d) — identical TSDoc, different word                                 | physics, physics-2d           | pick one; `09-physics.md` §2.2 names `center`                                                                                                                                                   |          84 / 399 |
| `Physics2DService.overlapBox/overlapCircle/shapeCast` take `centre` where the 3D signatures take `position`                                                                          | physics-2d                    | `position`, the spelling the rest of the public surface uses                                                                                                                                    |                 — |
| `ControlSpec` and `ControlDescriptor` alongside `ActionDefinition`/`BindingDefinition`/`ActionMapDefinition` — three words for "declared shape" and "resolved record" in one package | input                         | `ControlDefinition`, or document why controls differ                                                                                                                                            |          14 / 105 |
| `ComponentTypeToken`/`AssetTypeToken` vs `ServiceKey`/`ServiceClassKey`/`ServiceNameKey` — both are phantom-typed lookup markers                                                     | core                          | standardise on `Token` or on `Key`                                                                                                                                                              |          up to 47 |
| `TextureAsset.releaseGpu`/`retainGpu`/`isReleased` vs `MeshAsset`/`ModelAsset` `.dispose()`/`isDisposed`                                                                             | core                          | unify the vocabulary, or document the two lifecycle families explicitly                                                                                                                         | 38 (`isReleased`) |
| `LocaleAsset.document: LocaleDocument` vs `AnimatorAsset.definition: AnimatorDefinition`                                                                                             | ui, 3d                        | `Definition` is the repo-wide word (36 `*Definition` types across five packages; one `*Document`)                                                                                               |                 — |
| `AudioClip` is the only loaded-asset class without an `*Asset` suffix                                                                                                                | audio                         | keep — `10-audio.md` §2's heading is literally "`AudioClip` asset"                                                                                                                              |               252 |
| `LiteFont` (core, ui) and `LiteAnimationGroup` (core, 3d) are declared twice, structurally identical; `asDomCanvas` three times (core-adjacent packages ui, devtools, input)         | core, ui, 3d, devtools, input | the duplication is deliberate and documented (optional peers cannot import each other), but the umbrella has to exclude a name by hand for each. Record the rule rather than remove the copies. |      14 / 13 / 23 |
| `ResolvedIgnifxConfig` (the parsed `ignifx.config.ts`) vs `ResolvedIgnifxPluginOptions` (the Vite plugin's own bag)                                                                  | vite-plugin                   | disambiguating note in the skill page; no rename                                                                                                                                                |                 — |

### 5.5 Names that look like violations and are not (verdict `keep`, evidence on record)

Recording these matters for a freeze: without the reason, a later pass renames them again.

- **`SupportStateName`** (physics) and **`SpriteBlendName`** (2d) carry a `Name` suffix that the
  other twenty-odd table/union pairs do not. Both are forced: `packages/physics/src/lite/character.ts`
  already declares a `SupportState` const mapping Lite's enum, and `@babylonjs/lite` exports
  `SpriteBlendMode`, which `packages/2d/api/2d.api.md` imports by name. A rename to the bare name
  was attempted for `SupportStateName` and reverted. Blast radius 8 / 12.
- **`forceRendererDeviceLossForTesting`** (core) is `@internal` yet exported from core's barrel — the
  one surviving `ForTesting` symbol. It is a documented seam
  (`docs/adr/0018-electron-tooling.md`; `packages/core/src/render/renderer.ts`) that
  `templates/3d-third-person/src/desktop-probe.ts` needs for the Phase 9 device-loss exit criterion,
  because `forceWebGpuDeviceLossForTesting` lives in Lite and `CONSTITUTION.md` §3.4 forbids
  importing Lite outside `src/lite/**`. It is already excluded from the umbrella. §7 records the one
  consequence: a scaffolded `3d-third-person` ships a file that imports an `@internal` symbol.
- **`platformInternals`** and **`storageInternals`** (core) are `@internal`, exported from the barrel,
  and used by `@ignifx/electron`. `docs/architecture/14-platform-electron.md` §3 names both by name
  as the renderer extension's installation path. Correctly public-by-necessity; keep.
- **`destroy()` / `dispose()` / `release()` / `close()` / `remove()`** are four distinct, consistently
  applied concepts across all fifteen reports, not synonyms: `destroy` is the queued entity/component
  lifecycle verb, `dispose` is immediate teardown of an owned resource (28 occurrences, no
  competitor), `release` decrements a refcount (`AssetHandle`, `BatchHandle`, `AudioClip`), `close`
  pairs with `open`, `remove` is a partial operation. No finding.
- **`*Options` vs `*Settings`** is a two-tier convention applied without exception: `<Name>Options`
  is what you pass an extension factory, `<Name>Settings` + `default<Name>Settings()` is the resolved
  project-config section. All eight extension packages follow it. `*Config` appears only in
  `@ignifx/vite-plugin`, where it names the Vite-ecosystem `ignifx.config.ts` file. No finding.
- **`create*`** is the only factory prefix in the repository; no `make*` or `new*` exists.
- **`uiHasFocus`, `uiHasPointer`, `pointerOverUi`, `activeInHierarchy`** are named verbatim in
  `08-input.md` §5 and `13-ui.md` §3 / `02-scene-graph.md` §2 — hence §5.1 above rather than a silent
  rename.
- **No `Async` suffix, no `I`-prefixed interface, and no non-PascalCase type** exists in any report.

---

## 6. Error codes — no findings

Checked every `IGX-####` defined in every package against
`docs/architecture/15-devtools-and-diagnostics.md` §1's ranges.

| Package     | Defines                                                                                           | Documented range               | Overlap |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| core        | 0101–0110, 0201–0208, 0301–0309, 0401–0410, 0501–0506, 0601–0609, 0701–0710, 1420–1426, 1501–1506 | 01–07 + platform + diagnostics | none    |
| input       | 0801–0810                                                                                         | 08xx                           | none    |
| physics     | 0901–0908                                                                                         | 09xx                           | none    |
| audio       | 1001–1010                                                                                         | 10xx                           | none    |
| 2d          | 1102–1113                                                                                         | 11xx                           | none    |
| physics-2d  | 1101, 1150–1157                                                                                   | 11xx (shared)                  | none    |
| 3d          | 1201–1214                                                                                         | 12xx                           | none    |
| ui          | 1301–1308                                                                                         | 13xx                           | none    |
| cli         | 1401–1403                                                                                         | 14xx                           | none    |
| electron    | 1460–1467                                                                                         | 14xx                           | none    |
| devtools    | 1550–1557                                                                                         | 15xx                           | none    |
| vite-plugin | 0550–0555, 0650–0653                                                                              | 05xx/06xx tops                 | none    |

`IGX-1101` sitting in `@ignifx/physics-2d` while `@ignifx/2d` starts at `IGX-1102` is deliberate and
recorded in both packages' `errors.ts` and in the plan. `CORE_ERROR_MESSAGES` is typed
`Readonly<Record<CoreErrorCode, string>>`, so a code without a message cannot compile. Every
cross-package occurrence of another package's code (`@ignifx/3d` mentioning `IGX-0902`,
`@ignifx/vite-plugin` mentioning `IGX-0903`) is a TSDoc cross-reference, not a definition.

---

## 7. Freeze proposal

### Reports I consider ready to freeze as they stand

`@ignifx/audio`, `@ignifx/cli`, `@ignifx/electron` (all three entry points), and
`@ignifx/vite-plugin` — zero API Extractor warnings, no unapplied `rename` or `remove` finding, and
every option bag documents its defaults. `@ignifx/input` also has zero warnings; it is one decision
away (`compositeIsVector`, and the §5.1 carve-out for `was*ThisFrame`).

### Reports that need a decision first

| Report                   | Blocking decisions                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`                   | §5.1 rows (`onComplete`, `activeInHierarchy`, `onProgress`, `onUnloading`), `Storage`'s DOM collision, the `Token`/`Key` split, the `*Seconds` convention, `approximately`, `reducedMotion`, `ManualClock` units |
| `ui`                     | `pointerOverUi`, the `…Px` suffixes, `TextMetrics_2`, `LocaleDocument`                                                                                                                                           |
| `2d`                     | the `…Px` suffixes (`tileWidth`/`tileHeight` move the on-disk keys too), `SpriteLayerRegistry`'s public-but-all-`@internal` surface, `TwoDRuntime`                                                               |
| `3d`                     | the two `@public`→`@beta` navigation accessors, `onEvent`                                                                                                                                                        |
| `physics` / `physics-2d` | `center`/`offset`, `centre`/`position`, `Physics2DMaterialValues`, and whether the 2D query API grows `overlap`/`distanceToNearest` parity                                                                       |
| `devtools`               | `DevtoolsPanelHandle.visible`                                                                                                                                                                                    |
| `ignifx`                 | follows whatever the packages decide                                                                                                                                                                             |

### The 28 remaining `ae-forgotten-export` warnings

These are not defects to fix by exporting. Each is an implementation type referenced by an
`@internal` member of a `@public` class (`RendererImpl`, `WorldInternals`, `ComponentStore`,
`PhysicsHost`, `RapierWorld`, `TwoDRuntime`, …). Exporting them would enlarge the public surface to
silence a warning about the surface being correctly small. The freeze decision is to **accept them as
a class** and say so in the report configuration (`messages.extractorMessageReporting`), so a _new_
one is visible instead of being lost in a standing list of 28. Four in `@ignifx/physics` /
`@ignifx/physics-2d` are a genuinely different case — `LitePhysicsWorld`, `LitePhysicsBody`,
`RapierWorld`, `RapierBody` back the `@public` `.lite` / `.rapier` escape hatches, so a game cannot
name the type of `rigidbody.lite.body`; those four should be exported as unstable aliases.

---

## 8. `docs/**` corrections needed (not applied — outside this pass's ownership)

1. `docs/architecture/12-3d-toolkit.md` §4 (Tweening) names `onComplete` for both the tween option callback and
   the signal. If §5.1's signals rule stands, the sentence and the code change together.
2. `docs/architecture/13-ui.md` §1 names `app.ui.pointerOverUi`. Same.
3. `docs/architecture/02-scene-graph.md` §4 declares `readonly activeInHierarchy: boolean` while
   `03-scripting-and-components.md` §1 declares `readonly isEnabledInHierarchy: boolean` for the same
   shape. One of the two is wrong whichever way §5.1 is read.
4. `docs/architecture/11-2d-toolkit.md` §2.1's `Camera2D` table lists a `clearColor` field. No such
   field exists on `Camera2D`; `clearColor` lives only in the Lite adapter. The same table writes
   `bounds { min, max }` where the component has flat `boundsMin`/`boundsMax`.
5. `docs/architecture/14-platform-electron.md` §2 enumerates the storage codes `IGX-1421`–`IGX-1426`
   but omits `IGX-1420` (`cryptoUnavailable`), which sits in the same sub-band that
   `@ignifx/electron` re-exports constants from.
6. `docs/architecture/15-devtools-and-diagnostics.md` §1 assigns `14xx` to "platform"; `@ignifx/cli`
   allocates `IGX-1401`–`IGX-1403` there for scaffolding failures, which are not platform failures.
   No collision exists (core holds 1420–1426, electron 1460–1467), but the sub-range ownership is
   recorded nowhere.
7. `docs/architecture/16-docs-harness-and-skill.md` §3 promises one `references/api/<package>.md` per package under
   `references/api/`. `@ignifx/electron` ships three API reports and one skill page: every
   `/main` and `/preload` symbol — `GameWindowOptions`, `CspOptions`, `HostHandlerOptions` and their
   fully `@defaultValue`-documented fields — never reaches the reference an agent is told to read.
8. `docs/standards/coding-standards.md` §5.1 needs three carve-outs the code has already taken:
   equality comparators (`equalsWithEpsilon`), past-tense edge flags (`was*ThisFrame`), and
   multiplexed or pre-transition signals (`onEvent`, `onWindowEvent`, `onProgress`, `onUnloading`).
   It also needs to state the `*Seconds`-vs-bare rule one way or the other (§5.3), and whether
   on-disk wire-format keys are exempt from the unit-suffix rule (`SpriteFrameDefinition.x/y/w/h`).
9. `packages/physics/src/components/collider.ts:97`'s TSDoc says "changing a size, a **centre**"
   two lines below a field spelled `center`.

---

## 9. Verification run for the applied changes

| Command                                                                        | Result                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `pnpm check` (build, format, lint, typecheck, test, api-report, docs:harness)  | PASS — 280 files, 3,896 node tests; `regeneration-diff` clean over 61 generated files |
| `pnpm test:browser`                                                            | PASS — 36 files, 231 Chromium/WebGPU tests                                            |
| `pnpm test:visual`                                                             | PASS — 45 Playwright tests, 4.2 min                                                   |
| `pnpm bundle-size`                                                             | PASS — 5 tests, no drift against `benchmarks/baselines.json`                          |
| `pnpm deps` (Node 24.20.0)                                                     | PASS — 0 violations, 865 modules, 4,681 dependencies                                  |
| `create-ignifx` × 4 templates, `tsc --noEmit -p tsconfig.json` in the scaffold | PASS ×4                                                                               |
