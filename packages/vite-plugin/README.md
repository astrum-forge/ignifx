# @ignifx/vite-plugin

The build-time half of the ignifx asset pipeline: it generates the asset manifest, validates the
JSON file formats, injects `ignifx.config.ts`, copies the static files extensions need, and carries
asset changes to the running game over HMR.

The package depends on nothing from the engine (`docs/architecture/00-overview.md` §2). It produces
the files `@ignifx/core` consumes at runtime.

> Status: pre-1.0. Breaking changes ship in minor releases (`CONSTITUTION.md` §4.2).

## Install

```sh
pnpm add -D @ignifx/vite-plugin
```

`vite` is a peer dependency (8.x).

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { ignifx } from "@ignifx/vite-plugin";

export default defineConfig({
  plugins: [ignifx()],
});
```

There is no default export: the plugin is the named factory `ignifx` (coding standards §4).

## What it does

| Concern              | Development                                                         | Build                                                           |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Manifest             | served from `/assets.manifest.json` and `virtual:ignifx/manifest`   | written to `<outDir>/assets.manifest.json`, URLs content-hashed |
| Assets               | served by Vite from the asset root                                  | copied to `<outDir>/assets/` with immutable-cacheable names     |
| Project config       | `import.meta.env.IGNIFX_CONFIG`                                     | same                                                            |
| Validation           | reported in the terminal and the browser error overlay              | fails the build                                                 |
| Extension WASM/fonts | served from `/assets/<name>`                                        | copied unhashed to `<outDir>/assets/<name>`                     |
| Changes              | `ignifx:asset-changed` over HMR; a config edit forces a full reload | —                                                               |

## Options

```ts
ignifx({
  assetRoot: "assets", // scanned recursively, relative to the Vite root
  publicPath: "assets/", // where hashed assets land inside build.outDir
  manifestFileName: "assets.manifest.json",
  config: undefined, // path to ignifx.config.ts; `false` disables loading
  validate: true, // header + JSON Schema validation; a failure fails the build
  schemas: undefined, // { scene?, formats? } — supplied by the game from @ignifx/core
  hashLength: 8, // hex characters kept from each asset's sha256
  scripts: "src/scripts/**/*.ts", // glob behind virtual:ignifx/scripts
});
```

## The manifest

`assets.manifest.json` carries the `format`/`formatVersion` header every ignifx file format shares
(`docs/architecture/06-serialization-and-scene-format.md` §6) and one entry per asset, sorted by
address so that two builds of the same tree produce the same bytes:

```json
{
  "format": "ignifx.manifest",
  "formatVersion": 1,
  "root": "assets",
  "entries": [
    {
      "address": "sprites/hero.png",
      "url": "/assets/sprites/hero.b7c23e74.png",
      "bytes": 10,
      "hash": "b7c23e74",
      "type": "texture",
      "groups": ["boot"],
      "meta": { "texture": { "srgb": true } }
    }
  ]
}
```

- **address** — the path relative to the asset root, `/`-separated. This is what game code loads:
  `app.assets.load("sprites/hero.png")`.
- **url** — root-relative in development, content-hashed in a build. The hash goes _before_ the
  extension, and a two-segment JSON extension stays intact: `level1.scene.json` becomes
  `level1.<hash>.scene.json`, so the loader still recognises the format.
- **type** — derived from the extension (`texture`, `model`, `scene`, `material`, `environment`,
  `font`, `audio`, `json`, `text`, `binary`); an unknown extension is `binary`.
- **groups** and **meta** — from the `.meta.json` sidecar; `meta` is omitted when there is none.

### Sidecars

A file named `<asset>.meta.json` next to an asset carries its group membership and per-loader import
options. `groups` becomes the entry's `groups`; everything else is passed through as `meta`.

```json
{ "groups": ["boot", "level1"], "texture": { "srgb": true, "mipmaps": true } }
```

Sidecars are never listed as assets of their own. Dot-prefixed files and directories are skipped.

## Virtual modules

```ts
import { manifest } from "virtual:ignifx/manifest";
import { scripts } from "virtual:ignifx/scripts";
```

- **`virtual:ignifx/manifest`** exports `manifest`, the same object the generated JSON holds, so a
  game can read it without a fetch. It is invalidated whenever an asset changes in development.
- **`virtual:ignifx/scripts`** exports `scripts`, every class exported by the `scripts` glob that
  declares a `static typeId`. The list is sorted by module path, so registration order is the same on
  every machine, and the modules are imported through `import.meta.glob(..., { eager: true })`, which
  puts each script file in Vite's HMR graph. The hot-reload _policies_ (patch vs. recreate) are
  `@ignifx/devtools`' (`docs/architecture/15-devtools-and-diagnostics.md` §5); this package ships the
  channel.

Add the declarations to your project so TypeScript knows the modules:

```ts
// src/vite-env.d.ts
declare module "virtual:ignifx/manifest" {
  import type { AssetManifest } from "@ignifx/vite-plugin";
  export const manifest: AssetManifest;
}
declare module "virtual:ignifx/scripts" {
  export const scripts: readonly (abstract new (...args: never[]) => unknown)[];
}
```

## Project config

`ignifx.config.ts` at the Vite root is loaded with Vite's own config loader and injected as
`import.meta.env.IGNIFX_CONFIG` (`docs/architecture/04-extensions.md` §5). It must export a plain,
JSON-serializable object by default.

```ts
// ignifx.config.ts
import { defineConfig } from "@ignifx/vite-plugin";

export default defineConfig({
  layers: ["Default", "Ground", "Player"],
  time: { fixedDeltaTime: 1 / 60 },
  assets: { root: "./assets", preload: ["boot"] },
});
```

From Phase 12 the same helper is re-exported as `ignifx/config`.

## Validation

Every JSON file under the asset root whose name has a two-segment JSON extension — `.scene.json`,
`.prefab.json`, `.material.json`, `.atlas.json`, `.input.json`, and the rest of the table in
`docs/architecture/06-serialization-and-scene-format.md` §6 — must carry a `format` string and a
positive integer `formatVersion`. Plain `.json` files are game data and are checked only if they
declare a header of their own.

When `schemas` is supplied, documents are also validated against the matching JSON Schema. The
validator implements the subset the generated schemas use — `type`, `required`, `properties`,
`additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `minItems`, `maxItems`,
`oneOf`, `anyOf`, and `$ref` to `#/$defs/*` — and reports anything outside it as `IGX-0653` rather
than ignoring it. There is no runtime dependency (coding standards §13).

Problems are reported with a JSON pointer:

```
levels/level1.scene.json /entities/0: missing required property "uid" (IGX-0652)
```

## HMR

```ts
import.meta.hot?.on("ignifx:asset-changed", ({ address, kind, url }) => {
  // kind: "added" | "changed" | "removed"
});
```

`@ignifx/core`'s assets service subscribes to this and fires `AssetHandle.onReplaced`
(`docs/architecture/05-assets-and-loading.md` §7). Editing `ignifx.config.ts` triggers a full reload
instead, because project settings are frozen at app construction.

`plugin.api.whenIdle()` resolves once the plugin has finished reacting to every file-system event it
has seen — useful in tests and in other plugins that read the served manifest.

## Extension public assets

A package in the `@ignifx` scope, or any package carrying the `ignifx-extension` keyword, may
declare files that must be served verbatim:

```json
{ "ignifx": { "assets": { "public": ["./wasm/HavokPhysics.wasm"] } } }
```

They are copied **unhashed** into the public path, because WASM loaders locate their binary by name.
Two extensions publishing the same file name is an error (`IGX-0553`).

Each one is also listed in the manifest, at its bare file name, with the served URL — `base`
included. That is what makes `app.assets.resolveUrl("HavokPhysics.wasm")` answer correctly on a page
served from a sub-path: without an entry, `resolveUrl` falls back to a **page-relative**
`<assetRoot>/<name>`, which points somewhere no file was written as soon as the document does not sit
directly above the asset root, and `@ignifx/physics` then reports `IGX-0903`. A project asset whose
address equals a published file name is an error (`IGX-0552`), because `resolveUrl` could not answer
for both.

If the bundler emits its own copy of the same bytes — `@babylonjs/havok`'s ESM build carries a
`new URL("HavokPhysics.wasm", import.meta.url)` that Rollup resolves, which would ship the binary
twice — the plugin repoints that reference at its own unhashed copy and drops the bundler's, so
exactly one file ships and the URLs that already worked keep working.

**Discovery walks `node_modules` from the Vite root upwards and reads only the packages installed
_directly_ in each one.** Under pnpm that is the root's own `dependencies`/`devDependencies`, so an
extension reached transitively — through the `ignifx` umbrella, for instance — publishes nothing. A
project that registers `physics()` through the umbrella must also list `@ignifx/physics` in its own
`package.json` for `HavokPhysics.wasm` to be copied and listed.

## Error codes

The plugin runs before an `App` exists, so it throws its own `VitePluginError` with a code from the
ranges `docs/architecture/15-devtools-and-diagnostics.md` §1 reserves. The codes are allocated from
the top of each range so that the runtime codes `@ignifx/core` allocates from the bottom cannot
collide with them.

| Code       | Meaning                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `IGX-0550` | The asset root does not exist or is not a directory (a warning in the plugin, which then builds an empty manifest) |
| `IGX-0551` | A `.meta.json` sidecar is malformed                                                                                |
| `IGX-0552` | Two files build to the same output name                                                                            |
| `IGX-0553` | An extension's `ignifx.assets.public` entry is missing or ambiguous                                                |
| `IGX-0554` | `ignifx.config.ts` could not be loaded                                                                             |
| `IGX-0555` | A plugin option is outside its domain                                                                              |
| `IGX-0650` | A JSON asset is not parseable                                                                                      |
| `IGX-0651` | A format-headed file has no usable `format`/`formatVersion` header                                                 |
| `IGX-0652` | A document failed its JSON Schema                                                                                  |
| `IGX-0653` | A supplied schema uses a keyword this validator does not implement                                                 |

## License

Apache-2.0 © Astrum Forge Studios
