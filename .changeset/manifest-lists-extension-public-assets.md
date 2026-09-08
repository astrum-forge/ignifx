---
"@ignifx/vite-plugin": patch
---

Extension public assets are listed in the asset manifest, and the bundler's duplicate copy is folded away

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
