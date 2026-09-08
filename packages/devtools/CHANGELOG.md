# @ignifx/devtools

## 0.2.1

### Patch Changes

- Updated dependencies [21a4ba7]
- Updated dependencies [6a39fae]
- Updated dependencies [6a39fae]
- Updated dependencies [388b0f6]
- Updated dependencies [6a39fae]
  - @ignifx/input@0.2.1
  - @ignifx/physics-2d@0.2.1
  - @ignifx/physics@0.2.1
  - @ignifx/core@0.2.1
  - @ignifx/ui@0.2.1
  - @ignifx/audio@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0
  - @ignifx/audio@0.2.0
  - @ignifx/input@0.2.0
  - @ignifx/physics@0.2.0
  - @ignifx/physics-2d@0.2.0
  - @ignifx/ui@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: the overlay's internal plumbing leaves the public barrel
  
  **Breaking.** Three symbols marked `@internal` are no longer exported from `@ignifx/devtools`:
  `asDomCanvas`, `resolveDevtoolsTarget` and `DevtoolsServiceOptions`. Nothing outside the package
  used them, and the `ignifx` umbrella had to drop `asDomCanvas` by hand because `@ignifx/ui` exported
  a byte-identical copy of the same `@internal` helper. `DevtoolsDomTarget` stays `@public`.
- 737ee13: The devtools overlay, its nine panels, and `app.devtools`
  
  `devtools()` gives a game `app.devtools`, the `devtools` settings section, and a toggle key — a raw
  `keydown` on the document (default `Backquote`), never an input action, so it works without
  `@ignifx/input` and survives a pause menu disabling an action map.
  `app.devtools` is `{ open, close, toggle, isOpen, panel(name), panels, select, selected,
  reloadScenes, isSceneReloadDelegated, onOpened, onClosed, onSelectionChanged }`. On an app with no
  DOM canvas `open()` is a documented no-op with one debug line; everything else works headlessly.
  
  **Zero cost when closed**, precisely: no system is registered until the first `open()`, no signal is
  subscribed to while it is closed, and no DOM exists while it is closed. `benchmarks/devtools-closed.test.ts`
  measures a 1,002-entity headless scene over 1,200 frames per variant and asserts the per-frame
  median moves by at most 0.02 ms; it measured 0.0005 ms. Core's scheduler has no `unregisterSystem`,
  so after the first `open()` the `PreRender` sampler stays registered and returns on its first line
  while the overlay is closed.
  
  Nine panels: **Stats**, **Scene tree** (search, select, toggle active, destroy, virtualised to
  10,000 entities), **Inspector** (schema-driven editing, copy as JSON, "select in world" through
  `renderer.pickAsync`), **Assets**, **Input**, **Audio**, **Physics**, **Console** and **Timeline**
  (per-phase CPU milliseconds over the 300-frame ring buffer). The overlay mounts into
  `app.ui.layer("devtools")` when `@ignifx/ui` is registered and builds its own root beside the canvas
  otherwise. `@ignifx/ui`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics` and `@ignifx/physics-2d`
  are optional peers the package never imports: every reach into them is a structural shape check, so
  a game with only `@ignifx/core` opens the same overlay.
  
  `createDevtoolsLogSink()` is how the Console panel gets log lines: `app.log`'s sink is fixed by
  `createApp`, so the game passes one sink object to both `createApp({ logSink })` and
  `devtools({ logSink })`. Without it the panel still shows `app.onError` and `app.hotReload` reports.
  
  New codes: `IGX-1550` (duplicate extension), `IGX-1551` (headless no-op), `IGX-1552` (unknown
  panel), `IGX-1553` (read-only field), `IGX-1554` (rejected inspector write), `IGX-1555` (no asset
  reload entry point), `IGX-1556` (scene cannot be re-instantiated), `IGX-1557` (no canvas to pick
  from). `@ignifx/core` keeps `IGX-1501`–`IGX-1549`.

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [7ca9efe]
- Updated dependencies [d049484]
- Updated dependencies [d349254]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [4cfb15f]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [8947b19]
- Updated dependencies [c7f3bb1]
- Updated dependencies [a0625fb]
- Updated dependencies [d349254]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0
  - @ignifx/physics-2d@0.1.0
  - @ignifx/ui@0.1.0
  - @ignifx/audio@0.1.0
  - @ignifx/input@0.1.0
  - @ignifx/physics@0.1.0
