# @ignifx/vite-plugin

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
