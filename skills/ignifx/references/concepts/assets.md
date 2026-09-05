# Assets

Everything a game loads — textures, models, scenes and prefabs, materials, environments, fonts,
JSON, text, bytes — is addressed, typed, reference-counted, and asynchronous. Rationale in
`docs/architecture/05-assets-and-loading.md`.

```
address ──▶ manifest ──▶ url ──▶ loader ──▶ value
                   └── AssetHandle<T> (refCount, state, promise, onReplaced)
```

## 1. Addresses and the manifest

- An **address** is a path under the project's asset root (`assets/` by default):
  `"models/hero.glb"`, `"levels/level01.scene.json"`. Absolute `https:`, `blob:`, and `data:` URLs
  are taken as-is. A **fragment** selects a sub-asset: `"models/hero.glb#animation:Run"`.
- `AssetRef<T>` is the serializable form, `{ address, type? }`; `assetRef(address, type?)` builds
  one and `isAssetRef(value)` narrows an `unknown`. In a file it is `{ "$asset": "models/hero.glb" }`.
- `assets.manifest` maps addresses to URLs, byte sizes, hashes, types, and **groups** (`"boot"`,
  `"level1"`, …). `@ignifx/vite-plugin` generates it (`ASSET_MANIFEST_FORMAT`, version 1);
  `EMPTY_ASSET_MANIFEST` is what an app without one uses. `assets.resolveUrl(address)` is the
  lookup, and it is what a loader fetches.
- In-code assets live at a `memory:` address instead. `MeshAsset.box(app)` and
  `createMaterialAsset(app, …)` publish through `Assets.register`, so they name **no file**.

## 2. `AssetHandle<T>`

| Member               | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `address`, `type`    | What was asked for, and the loader type that answered               |
| `state`              | `"loading" \| "loaded" \| "failed" \| "released"`                   |
| `value`              | The loaded value; throws `IGX-0501` unless `state === "loaded"`     |
| `promise`            | Resolves with the value, rejects with an `AssetLoadError`           |
| `progress`, `error`  | `0…1`, bytes-weighted where sizes are known; the failure, or `null` |
| `refCount`           | Holders; `retain()` adds one, `release()` drops one                 |
| `[Symbol.dispose]()` | Same as `release()`, so `using handle = …` works                    |
| `onReplaced`         | Hot reload delivered a new value; `value` is already the new one    |

Two `load` calls for one address answer with the **same handle**, refcount incremented — so each
`load` needs exactly one `release`. At zero the value is unloaded after `assets.gcDelay` seconds
(default 5; `assets.gc()` collects now). A released handle stays a valid object: `state` becomes
`"released"` and `value` throws.

## 3. `app.assets`

| Member                                | Notes                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `load(ref, options?)`                 | Returns a handle **immediately**, still `"loading"`                           |
| `loadAsync(ref, options?)`            | The same, awaited                                                             |
| `loadAll(refs, options?)`             | A `BatchHandle`: `promise`, `progress`, `handles`, `release()`, `cancel()`    |
| `preloadGroup(group, options?)`       | Every manifest entry carrying that group label                                |
| `get(address)`                        | The cached handle or `null`, without changing the refcount                    |
| `release(handleOrAddress)`            | Drop one reference                                                            |
| `register(value, { type, address? })` | Publish an in-code value; the handle arrives already `"loaded"`               |
| `registerType`, `registerLoader`      | Normally reached through `ExtensionContext`                                   |
| `gc()`, `gcDelay`, `resolveUrl`       | Collection and address resolution                                             |
| `manifest`, `onProgress`              | The table, and `{ loaded, total, bytesLoaded, bytesTotal }` as work completes |

`LoadOptions` carries `signal` (an `AbortSignal`), `priority`, `type`, and `onProgress`. Requests go
through a priority queue with a concurrency limit (default 6) and retry twice on a network failure.
The `assets` settings section sets `root`, `preload`, `concurrency`, `gcDelay`, and `retries`.

**Completed loads are delivered in `PreUpdate`** while the app is running, by the
`ignifx/asset-delivery` system; before `app.start()` (and after `app.stop()`) there is no frame to
wait for, so a completed load settles at once — preload, `await`, then start. Once running: a handle's `state` flips and its `promise` settles at one point per frame, so "is this ready?"
has one answer for the whole frame.

## 4. `asset()` fields

The runtime value of an `asset()` schema field is the **loaded handle**, not an address:

```ts
import { Component, MeshAsset, MeshRenderer, asset, createApp } from "@ignifx/core";

class Pickup extends Component.define({ mesh: asset(MeshAsset) }) {
  static typeId = "mygame/Pickup";
}

const app = await createApp({ headless: true });
app.registerComponents([Pickup]);

// A primitive built in code is published at a `memory:` address, with one holder: this caller.
const box = MeshAsset.box(app, { size: 0.5 });
const crate = app.world.createEntity("Crate");
crate.addComponent(MeshRenderer, { mesh: box });
crate.addComponent(Pickup, { mesh: box });

app.log.info("pickup mesh:", crate.requireComponent(Pickup).mesh?.state);
box.release(); // one release for the one factory call; the fields never held a reference
app.dispose();
```

- A scene loader resolves every `{ "$asset": … }` in the file **before** the components' props are
  written, so `awake` can already read `this.mesh.value`.
- The field does not own the reference count: the scene instance that loaded the asset releases it
  on unload. Code that loads an asset itself pairs the `load` with a `release`.
- An address the resolver cannot answer decodes to `null` and reports `IGX-0602`; the component
  keeps working without it rather than failing the whole scene.
- Serializing a component that holds an **in-code** (`memory:`) asset writes `null` and reports the
  loss with `IGX-0602`. Save the asset as a file when it has to survive a round trip.

## 5. Loaders

An `AssetLoader<T>` declares a `type` and the `extensions` it claims, then `load(ctx)`, with optional
`unload`, `reload`, and `parseFragment`. `LoaderContext` gives `address`, `url`, `fragment`, `type`,
`app`, `signal`, `fetchBytes()`/`fetchText()`/`fetchJson()`, `loadDependency(ref)` (so refcounts and
progress propagate), `reportProgress(fraction)`, `meta` (the `.meta.json` sidecar), and the unstable
`lite.engine`.

The core extension registers: `texture` (`.png .jpg .jpeg .webp .ktx2 .basis`), `model`
(`.glb .gltf`), `scene` (`.scene.json .prefab.json`), `material` (`.material.json`), `environment`
(`.env .hdr .dds`), `font` (`.ttf .otf`), and the generic `jsonAssetLoader`, `textAssetLoader`, and
`binaryAssetLoader`. There is **no mesh file format**: geometry is either a primitive built in code
or part of a `ModelAsset`, so a `"mesh"` address fails with `IGX-0504`.

An extension adds its own with `ctx.registerAssetLoader(loader)` and `ctx.registerAssetType(type)`;
a second loader for one type is `IGX-0506`.

## 6. Hot reload

`@ignifx/vite-plugin` sends `ignifx:asset-changed` over Vite HMR in development. The service reloads
the affected handle in place and emits `handle.onReplaced` with the new value; `handle.value` is
already the new one when the handler runs, so a component re-reads it rather than reloading.

## 7. Errors

| Code       | When                                                  |
| ---------- | ----------------------------------------------------- |
| `IGX-0501` | `handle.value` read while the state is not `"loaded"` |
| `IGX-0502` | The load was aborted through `options.signal`         |
| `IGX-0503` | The app was disposed with loads in flight             |
| `IGX-0504` | No loader claims that type or extension               |
| `IGX-0505` | The fetch or the loader failed (an `AssetLoadError`)  |
| `IGX-0506` | Two loaders registered for one type                   |

`AssetLoadError` extends `IgnifxError` and carries `address` and `url`. Failures raised inside the
loading path are also reported through `app.onError` with `source: "asset"`.

## 8. Headless

`fetch` is the only I/O path, and `createApp({ fetch })` is where a Node app supplies one that maps
addresses to files. GPU-dependent loaders return CPU-side data: a headless `MeshAsset` carries no
geometry and a headless `TextureAsset` has `lite.texture === null`, while addresses, handles,
refcounts, groups, and scene loading behave exactly as they do in a browser.
