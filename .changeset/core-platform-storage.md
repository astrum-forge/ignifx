---
"@ignifx/core": minor
---

`app.platform` and `app.storage`

`app.platform` answers the whole of `docs/architecture/14-platform-electron.md` §1 rather than just `kind`: `os`, `isMobile`, `hasPointerLock`, `hasGamepads`, `locale`, `reducedMotion`, and `webgpu` (`{ adapterInfo, features, limits }`, `null` in a headless app and on a host without WebGPU). `kind` gained `"electron"`, which `@ignifx/electron`'s renderer extension sets through the `@internal` `platformInternals(app.platform).setKind(…)`. Detection is split into a host scrape and a pure interpretation, so every operating-system and mobile heuristic is unit-tested without a browser. The record is no longer frozen.

`app.storage` is new: `get`, `set`, `delete`, `keys(prefix?)`, and `namespace(name)`, asynchronous on every backend. Values are JSON — with numbers canonicalized the way scene files canonicalize them, so two saves of the same state are byte-identical — or bytes, from a `Blob`, an `ArrayBuffer`, or any typed array, which read back as a `Uint8Array`. A namespace is a backend scope rather than a key prefix, so `namespace("saves")` cannot see the root's keys or a sibling's. Three backends ship: `IndexedDbStorageBackend` (the browser default, one `ignifx` database and one `values` store keyed `[namespace, key]`), `MemoryStorageBackend` (the headless default), and `createFileStorageBackend({ directory })` (a directory tree, written atomically through a temporary file and a rename, with a key encoding that survives `/`, `..`, Windows device names, and case-insensitive file systems). `createApp({ storage })` takes a backend or `{ directory }`, and `StorageBackend` is the contract `@ignifx/electron`'s file-system backend implements.

New codes: `IGX-1421` (invalid namespace), `IGX-1422` (invalid key), `IGX-1423` (value with no JSON form), `IGX-1424` (out of quota), `IGX-1425` (backend failure), `IGX-1426` (unreadable stored value).
