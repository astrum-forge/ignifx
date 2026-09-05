---
"@ignifx/core": minor
"@ignifx/vite-plugin": minor
"ignifx": minor
---

Phase 2: the asset service, the scene format, and the Agent Skill that documents them

`@ignifx/core` gains the runtime half of the asset pipeline (`docs/architecture/05-assets-and-loading.md`). `app.assets` resolves addresses through the manifest `@ignifx/vite-plugin` generates, answers `load`/`loadAsync`/`loadAll`/`preloadGroup` with reference-counted `AssetHandle`s (`state`, `value`, `promise`, `progress`, `error`, `refCount`, `retain`, `release`, `[Symbol.dispose]`, `onReplaced`), schedules fetches through a priority queue with a concurrency limit and retries, cancels them through an `AbortSignal`, and collects zero-reference assets after `gcDelay`. Completed loads are delivered by one `PreUpdate` system, so a handle's state flips and its promise settles at exactly one point per frame. `Assets.register` publishes an in-code value at a `memory:` address, `AssetLoader`/`LoaderContext` is the extension-facing contract behind `ctx.registerAssetType`/`ctx.registerAssetLoader`, and `binaryAssetLoader`, `jsonAssetLoader`, and `textAssetLoader` ship with the core extension beside the GPU loaders.

Serialization is complete for the `ignifx.scene` format (`06-serialization-and-scene-format.md`, ADR-0005): `SceneFile` and its entity, component, transform, instance, and override records; `serializeScene`, `serializeEntity`, `serializeComponent`, `stringifySceneFile`, `validateSceneFile`, `computeSceneHash`, `sceneFileJsonSchema`, `parseOverridePath`, `UidRemap`, `createSceneAsset`, `createSceneLoader`, `instantiateScene`, and `assertSceneDependenciesLoaded`. The world drives them through `loadScene` (single or additive, cancellable, with progress), `unloadScene`, `instantiate`, `instantiateAsync`, and `moveEntityToScene`; `SceneInstance` now carries the `AssetHandle<SceneAsset>` it was built from and its uid remap. `app.events` joins `App` as the engine-wide signal table — `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost`, `onDeviceRecovered`, `onDeviceRecoveryFailed`.

Documentation lands with it. The entry Agent Skill documents the render components, the mesh and material factories, `app.assets`, scene and prefab loading, `app.renderer`, and the `rendering` and `assets` settings sections, with examples the harness compiles; there is a new `references/concepts/rendering.md`, a rewritten `assets.md`, hand-written `references/formats/scene.md` and `material.md` beside the generated tables, the first two generated recipes ("load a model", "spawn a prefab") extracted from `examples/recipes/`, and seventeen new gotchas covering the feature opt-ins, runtime material warm-up, handle ownership, and colour encoding.

**Breaking**

- `asset(TypeToken)` fields now hold `AssetHandle<A> | null` at runtime instead of `AssetRefValue<A> | null`. Read `field.value` for the asset and `field.address` for the address; the file encoding, `{ "$asset": "<address>" }`, is unchanged.
- `CoreErrorCode.cryptoUnavailable` moved from `IGX-1401` to `IGX-1420`. `IGX-1401`–`IGX-1419` belong to `@ignifx/cli` (`docs/architecture/00-overview.md` §2), so the kernel's code was in the wrong half of the platform range.
- `SceneInstance.asset` is typed `AssetHandle<SceneAsset> | null` rather than `null`, so code that relied on it narrowing to `null` no longer compiles.

Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
