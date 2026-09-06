# Platform and storage

`app.platform` says where the game is running; `app.storage` is where it keeps settings, save games,
and input rebindings. Rationale in `docs/architecture/14-platform-electron.md` §1, §2, §5.

## 1. `app.platform`

Populated once, during `createApp`. Read it; never write it.

| Field                            | Value                                                                      |
| -------------------------------- | -------------------------------------------------------------------------- |
| `kind`                           | `"browser"`, `"electron"` (set by the Electron extension), or `"node"`     |
| `os`                             | `"macos" \| "windows" \| "linux" \| "ios" \| "android" \| "unknown"`       |
| `isMobile`                       | `true` on a phone or a tablet; an iPad reports `os: "ios"`                 |
| `hasPointerLock` / `hasGamepads` | Capability probes, `false` headless                                        |
| `webgpu`                         | `{ adapterInfo, features, limits }`, or `null` headless and without WebGPU |
| `locale`                         | BCP 47 tag, `"en-AU"`                                                      |
| `reducedMotion`                  | `true` when the operating system asks for reduced motion                   |

```ts run
import { createApp } from "@ignifx/core";

const app = await createApp({ headless: true });
if (app.platform.reducedMotion) {
  // Turn screen shake off rather than scaling it down.
}
const budget = app.platform.isMobile ? 0.75 : 1;
app.log.info("host:", app.platform.kind, app.platform.os, app.platform.locale, budget);
app.log.info("webgpu:", app.platform.webgpu); // null — a headless app never asks for an adapter
app.dispose();
```

## 2. `app.storage`

Five calls, asynchronous on every backend. Values are JSON, or bytes: a `Blob`, an `ArrayBuffer`, or
any typed array is stored as octets and **reads back as a `Uint8Array`**.

```ts run
import { createApp } from "@ignifx/core";

interface AudioSettings {
  readonly master: number;
  readonly music: number;
}

const app = await createApp({ headless: true });
const settings = app.storage.namespace("settings");

await settings.set<AudioSettings>("audio", { master: 0.8, music: 0.5 });
const audio = await settings.get<AudioSettings>("audio");
app.log.info("master volume:", audio?.master ?? 1);

await settings.set("thumbnail", Uint8Array.from([137, 80, 78, 71]));
app.log.info("keys:", await settings.keys()); // ["audio", "thumbnail"] — always sorted
await settings.delete("thumbnail");
app.dispose();
```

A namespace is a **scope, not a prefix**: `namespace("saves")` sees none of the root's keys, and
`namespace("saves").namespace("coop")` sees none of `"saves"`'s. Names are 1–64 characters of
`A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `-`. Keys are opaque — `/`, `..`, `:` and spaces are all fine,
up to 512 characters, and backends encode them for you.

## 3. Save games

A save is a scene file: `serializeScene` out, `app.storage` in the middle, `instantiateScene` back.
Numbers are canonicalized on the way in, so saving the same state twice produces the same bytes.

```ts run
import { createApp, createSceneAsset, instantiateScene, serializeScene } from "@ignifx/core";
import type { SceneFile } from "@ignifx/core";

const app = await createApp({ headless: true });
app.world.createEntity("Player").transform.localPosition.set(1, 2, 3);

const saves = app.storage.namespace("saves");
await saves.set("slot1", serializeScene(app.world.activeScene, { name: "Level01" }));

const file = await saves.get<SceneFile>("slot1");
if (file !== null) {
  const asset = await createSceneAsset("saves/slot1.scene.json", file);
  const built = instantiateScene(app.world, asset);
  app.log.info("restored:", built.roots[0]?.name, built.issues);
}
app.dispose();
```

If a save instances a prefab that has been edited since, `instantiateScene` reports `IGX-0604` in
`built.issues` and applies the overrides that still fit. Pass `{ strictInstanceHashes: true }` to
make that a throw instead.

## 4. Backends

| Backend                    | Default for               | Where it puts things                                |
| -------------------------- | ------------------------- | --------------------------------------------------- |
| `IndexedDbStorageBackend`  | browser, Electron         | One `ignifx` database, one `values` store           |
| `MemoryStorageBackend`     | Node, tests               | Nothing; it disappears with the app                 |
| `createFileStorageBackend` | `{ directory }` opt-in    | `<directory>/<namespace>/<key>.json` or `.bin`      |
| `@ignifx/electron`'s       | installed by `electron()` | `userData/<namespace>/…` through the preload bridge |

Override the default with `createApp({ storage })`, which takes either a backend or `{ directory }`.

## 5. Gotchas

- `platform.webgpu` is `null` in a headless app, and describes the **adapter**, so its `features`
  and `limits` are an upper bound on what the running device was given.
- `app.dispose()` disposes the backend, so a store outlives its app only if you built it yourself.
- Writing a `Blob` and reading a `Blob` back does not work; you get the octets, not the wrapper.
- `undefined`, functions, and cycles have no JSON form: storing one is `IGX-1423`, not a silent
  `null`.
