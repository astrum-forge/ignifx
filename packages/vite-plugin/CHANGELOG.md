# @ignifx/vite-plugin

## 0.12.0

### Patch Changes

- 1c7878c: Fix a sidecar (`*.meta.json`) key named `__proto__`: it is now kept as data in the scanned asset's `meta` and in the manifest entry, instead of changing the prototype of the `meta` object and disappearing from the manifest.
- Updated dependencies [8ea4101]
- Updated dependencies [3999551]
- Updated dependencies [8d7f8ef]
- Updated dependencies [0dbe07f]
- Updated dependencies [234534b]
- Updated dependencies [5dcbff1]
- Updated dependencies [a71c607]
- Updated dependencies [38ddd7a]
- Updated dependencies [51efbc6]
- Updated dependencies [7f5b116]
  - @ignifx/core@0.12.0

## 0.11.0

### Minor Changes

- 3b5b8ed: Serve and bundle the Babylon Lite KTX2 and meshopt decoders that `@ignifx/core` publishes, so a packaged game with `script-src 'self'` loads `.ktx2` textures and meshopt-compressed glTF without `cdn.babylonjs.com`.

### Patch Changes

- 8ee8a2f: Keep the editor-private `.ignifx/` directory out of `vite build` output and off `vite dev` and `vite preview` when reached through a symbolic link or a copy in `publicDir`; such a build now fails with `IGX-0556`.
- Updated dependencies [2964d6e]
- Updated dependencies [fac8cc9]
- Updated dependencies [3b5b8ed]
  - @ignifx/core@0.11.0

## 0.10.0

### Minor Changes

- 159ea03: Add `.mesh.json` mesh files: a file names one primitive (`box`, `sphere`, `plane`, `ground`, `cylinder`, `capsule`, `torus`) and its `MeshAsset` factory options, so a scene file can reference a primitive by address (`{ "$asset": "meshes/crate.mesh.json" }`) without code publishing it first. A bad primitive or option fails the load with `IGX-0507`.
  
  - `@ignifx/vite-plugin` records `.mesh.json` files as `mesh` assets and checks their header; pass `meshFileJsonSchema()` from `@ignifx/core` in `schemas.formats` to validate their options at build time.
- 324ce73: Read project settings from `ignifx.settings.json` as well as `ignifx.config.ts`; the config file wins a section both define.
  Pass `schemas.settings` to fail a misspelled settings key with `IGX-0554`. Editing either file now restarts the dev server, so the new values reach the game.
- 86218fb: A `.meta.json` sidecar with `"publish": false` keeps its asset out of the manifest, `dist/` and validation, in `vite dev` and in a build; a `publish` value that is not a boolean is `IGX-0551`.
  The editor-owned sidecar keys `guid`, `importer`, `source`, `outputs` and `options` (exported as `EDITOR_SIDECAR_KEYS`) no longer reach a manifest entry's `meta`; every other key still does.

### Patch Changes

- dc768d6: - `describeSchema` now describes each field's inspector options (`min`, `max`, `step`, `hidden`, `readonly`, `group`, `transient`), an enum's `values`, an asset field's `assetType`, a `componentRef` field's `componentType`, and the nested field of an `array`, `record`, `map` or `optional`.
  - Add `describeRegisteredSchemas(app.world.registry)`, which describes every registered component with `allowMultiple` and the `package` that registered it, for inspectors outside the engine.
  - `toJsonSchema` writes the same options as `x-ignifx-*` keywords (`x-ignifx-step`, `x-ignifx-group`, `x-ignifx-asset-type`, …) and marks read-only fields with `readOnly`.
  - Add `ComponentRegistry.registrarOf(typeId)`, the extension that registered a component.
  - The Vite plugin's JSON Schema validator skips `x-` extension keywords and `readOnly` instead of rejecting them with `IGX-0653`.
- 08e4b01: Fixed: editing a script in `src/scripts/` (or your `scripts` glob) now hot-reloads it through `app.hotReload` instead of reloading the whole page.
- d6fe3e8: Never serve the editor's private `.ignifx/` directory: `vite dev` and `vite preview` answer 404 to every form of a request into it, and `server.fs.deny` lists it.
- 6573ebf: `vite build` and `vite dev` now find `@ignifx/physics`'s Havok WebAssembly in a standalone pnpm project, instead of failing with `IGX-0553` unless `@babylonjs/havok` was a direct dependency.
- Updated dependencies [6f197c9]
- Updated dependencies [1804a62]
- Updated dependencies [e0276f8]
- Updated dependencies [4c6e200]
- Updated dependencies [324ce73]
- Updated dependencies [37cf52e]
- Updated dependencies [612ba87]
- Updated dependencies [159ea03]
- Updated dependencies [b0480a0]
- Updated dependencies [1fba2ea]
- Updated dependencies [df7b73f]
- Updated dependencies [dc768d6]
- Updated dependencies [738f68d]
- Updated dependencies [fd0afe5]
- Updated dependencies [63d4e86]
  - @ignifx/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [2c61694]
  - @ignifx/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [874d49b]
  - @ignifx/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [2ea5e9e]
- Updated dependencies [a837a3e]
  - @ignifx/core@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [d843b2e]
  - @ignifx/core@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [3a8b165]
- Updated dependencies [41450fb]
- Updated dependencies [e198c1c]
- Updated dependencies [96cdf34]
- Updated dependencies [946e837]
- Updated dependencies [09ef95f]
  - @ignifx/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [d617f2c]
- Updated dependencies [6175ff5]
- Updated dependencies [ee4f87b]
  - @ignifx/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [097d60b]
- Updated dependencies [1f45e2f]
  - @ignifx/core@0.4.0

## 0.3.1

### Patch Changes

- @ignifx/core@0.3.1

## 0.3.0

### Minor Changes

- 6e1eed7: - List every `.wgsl` file under the asset root in the manifest as a `shader` asset, and `.particles.json`, `.terrain.json` and `.r16` files as `particles`, `terrain` and `heightmap` assets.
  - Validate shaders at build time and in the dev server: WGSL syntax errors report `IGX-0654` with the parser's line, and contract errors report `IGX-0655` (missing or repeated `// @ignifx` form line, an undeclared `shaderUniforms`, `shaderSystem`, `surfaceUniforms` or texture, a missing entry point, a hand-written `@group`/`@binding`, or `textureSample` reachable from a vertex stage). Set `validate: false` to turn the checks off.
  - Editing a `.wgsl` file announces `ignifx:asset-changed`, which the engine's shader hot reload listens for.

### Patch Changes

- be82465: Clarify API documentation and starter-template comments, and update the README's setup instructions.
- Updated dependencies [be82465]
- Updated dependencies [6e1eed7]
  - @ignifx/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [388b0f6]
  - @ignifx/core@0.2.1

## 0.2.0

### Patch Changes

- c8fb925: Extension public assets are listed in the asset manifest, and the bundler's duplicate copy is folded away
  
  `@ignifx/physics` declares `HavokPhysics.wasm` in `ignifx.assets.public` and the plugin copied it
  unhashed into the public path — but never wrote it into the manifest. `Assets.resolveUrl("HavokPhysics.wasm")`
  therefore missed and fell back to a **page-relative** `assets/HavokPhysics.wasm`, which is right only
  when the document sits directly above the asset root: the templates work because they sit at `/`, and
  a page under `/examples/<slug>/run/` fetched a URL nothing had written and died with `IGX-0903`. Every
  published file is now an entry at its bare file name, carrying the served URL with `resolvedConfig.base`
  applied, its byte size, its content hash, and the type its extension implies (`binary` for `.wasm`) —
  in the emitted `assets.manifest.json` **and** in `virtual:ignifx/manifest`, the manifest the bundle
  carries and game code actually reads. Verified end to end: `templates/3d-first-person` built with
  `--base /x/`, served under `/x/` and again with its document one directory deeper, resolves
  `window.__ignifxReady` to `"ready"` in Chromium on SwiftShader with no `IGX-0903` and no failed
  request; before the change the deeper document 404ed on `/x/deep/assets/HavokPhysics.wasm`. A project
  asset whose address equals a published file name is now `IGX-0552` rather than an arbitrary answer
  from `resolveUrl`.
  
  The same build also shipped the binary **twice**: `@babylonjs/havok`'s ESM build carries a
  `new URL("HavokPhysics.wasm", import.meta.url)` that Rollup resolves into a second, content-hashed
  copy — 2.09 MB of dead weight, dead because `@ignifx/physics` always hands Emscripten a `wasmBinary`.
  `generateBundle` now matches bundler-emitted assets against the published files **by bytes**, repoints
  the chunk's reference at the plugin's unhashed copy, and drops the bundler's, so exactly one
  `HavokPhysics*.wasm` ships and every URL that already worked keeps working. Files are still copied
  unhashed under their base name.
  
  Also documented, in the README and in `docs/architecture/05-assets-and-loading.md` §7: discovery reads
  the packages installed **directly** in each `node_modules` from the Vite root upwards, so an extension
  reached only through the `ignifx` umbrella publishes nothing until the project depends on it by name.
- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: the manifest version constant and the format-header query match the vocabulary they
  share with the runtime
  
  **Breaking.**
  
  - `ASSET_MANIFEST_FORMAT_VERSION` is renamed to `ASSET_MANIFEST_VERSION`. `@ignifx/core` — the other
    end of the same handshake, which reads the `formatVersion` this constant writes — has always
    called it `ASSET_MANIFEST_VERSION`, and the two packages already agree on `ASSET_MANIFEST_FORMAT`,
    `AssetManifest` and `AssetManifestEntry`. The value is still `1`.
  - `requiresFormatHeader` is renamed to `isFormatHeaderRequired`. `docs/standards/coding-standards.md`
    §5.1's booleans row requires an `is`/`has`/`can`/`should` **prefix** on a query method; every other
    boolean query in the package already complies (`isJsonArray`, `isJsonObject`, `isSidecarFileName`,
    `isDevServerEntry`).
- 69b2c56: Phase 2: the asset service, the scene format, and the Agent Skill that documents them
  
  `@ignifx/core` gains the runtime half of the asset pipeline (`docs/architecture/05-assets-and-loading.md`). `app.assets` resolves addresses through the manifest `@ignifx/vite-plugin` generates, answers `load`/`loadAsync`/`loadAll`/`preloadGroup` with reference-counted `AssetHandle`s (`state`, `value`, `promise`, `progress`, `error`, `refCount`, `retain`, `release`, `[Symbol.dispose]`, `onReplaced`), schedules fetches through a priority queue with a concurrency limit and retries, cancels them through an `AbortSignal`, and collects zero-reference assets after `gcDelay`. Completed loads are delivered by one `PreUpdate` system, so a handle's state flips and its promise settles at exactly one point per frame. `Assets.register` publishes an in-code value at a `memory:` address, `AssetLoader`/`LoaderContext` is the extension-facing contract behind `ctx.registerAssetType`/`ctx.registerAssetLoader`, and `binaryAssetLoader`, `jsonAssetLoader`, and `textAssetLoader` ship with the core extension beside the GPU loaders.
  
  Serialization is complete for the `ignifx.scene` format (`06-serialization-and-scene-format.md`, ADR-0005): `SceneFile` and its entity, component, transform, instance, and override records; `serializeScene`, `serializeEntity`, `serializeComponent`, `stringifySceneFile`, `validateSceneFile`, `computeSceneHash`, `sceneFileJsonSchema`, `parseOverridePath`, `UidRemap`, `createSceneAsset`, `createSceneLoader`, `instantiateScene`, and `assertSceneDependenciesLoaded`. The world drives them through `loadScene` (single or additive, cancellable, with progress), `unloadScene`, `instantiate`, `instantiateAsync`, and `moveEntityToScene`; `SceneInstance` now carries the `AssetHandle<SceneAsset>` it was built from and its uid remap. `app.events` joins `App` as the engine-wide signal table — `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost`, `onDeviceRecovered`, `onDeviceRecoveryFailed`.
  
  Documentation lands with it. The entry Agent Skill documents the render components, the mesh and material factories, `app.assets`, scene and prefab loading, `app.renderer`, and the `rendering` and `assets` settings sections, with examples the harness compiles; there is a new `references/concepts/rendering.md`, a rewritten `assets.md`, hand-written `references/formats/scene.md` and `material.md` beside the generated tables, the first two generated recipes ("load a model", "spawn a prefab") extracted from `examples/recipes/`, and seventeen new gotchas covering the feature opt-ins, runtime material warm-up, handle ownership, and colour encoding.
  
  **Breaking**
  
  - `asset(TypeToken)` fields now hold `AssetHandle<A> | null` at runtime instead of `AssetRefValue<A> | null`. Read `field.value` for the asset and `field.address` for the address; the file encoding, `{ "$asset": "<address>" }`, is unchanged.
  - `CoreErrorCode.cryptoUnavailable` moved from `IGX-1401` to `IGX-1420`. `IGX-1401`–`IGX-1419` belong to `@ignifx/cli` (`docs/architecture/00-overview.md` §2), so the kernel's code was in the wrong half of the platform range.
  - `SceneInstance.asset` is typed `AssetHandle<SceneAsset> | null` rather than `null`, so code that relied on it narrowing to `null` no longer compiles.
  
  Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
- 69b2c56: Phase 2: `@ignifx/vite-plugin` ships the asset pipeline
  
  The plugin is now real. `ignifx(options?)` scans the asset root, hashes every file with sha256, reads `.meta.json` sidecars for group membership and per-loader import options, and emits `assets.manifest.json` in the `ignifx.manifest` format the assets service reads (`docs/architecture/05-assets-and-loading.md` §2/§7): one sorted entry per asset with `address`, `url`, `bytes`, `hash`, `type`, `groups`, and an optional `meta`. In development the manifest is served from `/assets.manifest.json` and from `virtual:ignifx/manifest`; in a build every asset is copied to `<outDir>/<publicPath>` under an immutable-cacheable name that keeps two-segment JSON extensions intact (`level1.scene.json` → `level1.<hash>.scene.json`). `ignifx.config.ts` is resolved with Vite's own config loader and injected as `import.meta.env.IGNIFX_CONFIG` (`04-extensions.md` §5), and `defineConfig` ships here until `ignifx/config` re-exports it. Every format-headed JSON file under the asset root is validated: the `format`/`formatVersion` header always, and the matching JSON Schema when the game supplies one, through a dependency-free validator covering the subset the generated schemas use (`type`, `required`, `properties`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `minItems`, `maxItems`, `oneOf`, `anyOf`, `$ref` to `#/$defs/*`) and reporting anything outside it rather than ignoring it; problems carry JSON pointers, fail the build, and surface in the dev overlay. Files an extension lists in `ignifx.assets.public` are discovered across `node_modules` and copied unhashed, because WASM loaders locate their binary by name. The dev server watches the asset root and sends `ignifx:asset-changed` (`{ address, kind, url }`) over HMR, invalidating the manifest module, while an edit to the project config forces a full reload; `virtual:ignifx/scripts` generates the game's component registry from a glob, keeping every exported class that declares a `static typeId`. Errors are `VitePluginError` values carrying `IGX-055x` (assets) and `IGX-065x` (serialization) codes.
- 737ee13: `virtual:ignifx/scripts` accepts HMR updates
  
  The generated script registry now self-accepts: a script file is already in Vite's module graph, so hot reload needs no channel of its own. On an update the module diffs the old and new registries by `typeId` for its log line and hands the new registry to `app.hotReload.apply`, which decides what each change means. The module exports `acceptHotReload(app)` next to `scripts` — one line of game code, because a generated module cannot discover the app and a module-level app reference is forbidden — and keeps its subscribers in `import.meta.hot.data`, so the module that handles the second update still knows about them.
  
  None of that ships in a build: `scriptsModuleSource(pattern, { hot })` emits the client only when the dev server is serving the module, and a production bundle carries `acceptHotReload` as an empty function with no `import.meta.hot` reference at all.

### Patch Changes

- 8947b19: Kernel and build fixes surfaced by Phase 4
  
  - `ExtensionContext.setSimulationScene(null)` is a no-op while the app is being disposed. `App.dispose()` disposes the world before the extensions, and `World.dispose()` has already dropped the scene, so a clear from an extension's `dispose` — which the hook's own documentation recommends — used to throw `IGX-0106`.
  - `ignifx.assets.public` entries that begin with `node_modules/` are resolved through the extension's own `node_modules` and then each ancestor directory, so a dependency's file (Havok's `.wasm`, declared by `@ignifx/physics`) is found under a hoisting package manager as well as under pnpm.
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
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0
