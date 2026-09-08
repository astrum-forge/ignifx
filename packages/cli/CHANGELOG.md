# @ignifx/cli

## 0.2.0

### Patch Changes

- c8fb925: A scaffolded 2D project keeps its sprite sheets beside its atlas documents, so it deploys under a sub-path
  
  `create-ignifx --template 2d-topdown` and `--template 2d-sidescroller` used to copy a project whose
  sheet images sat in `public/` and whose `.atlas.json` documents named them root-relatively
  (`"image": "/tiles.png"`). That was a workaround for a Phase 6 loader that resolved a relative
  `image` against the document's own URL, which a content-hashed build breaks. It only ever resolved
  at a site's root: the same project built for a sub-path — a project page, for one — asked the
  origin's root for a sheet that was not there and got a 404.
  
  `@ignifx/2d` resolves a relative `image` as an address through the asset manifest
  (`resolveAtlasImageUrl`), so both templates now write their sheets into `assets/` next to the
  documents that name them and reference them as `"image": "tiles.png"`. The images are byte for byte
  what they were; only their location and the eight `image` fields changed, and neither template has a
  `public/` directory any more. No CLI code changed.

## 0.1.0

### Minor Changes

- a0625fb: `create-ignifx` now ships real templates. `2d-topdown` and `2d-sidescroller` are copied into the
  package at pack time (`scripts/copy-templates.ts`) and land in a generated project ready to build.
  
  - `copyTemplate` rewrites `workspace:` dependency specifiers to a published range — `DEFAULT_DEPENDENCY_RANGE`,
    which is `^` plus the package's own version — so a scaffolded `package.json` installs from the
    registry. Pass `dependencyRange: null` to copy it byte for byte.
  - `resolveTemplatesRoot` finds the templates in either layout: `<package>/templates` in a published
    tarball, the repository's own `templates/` in a checkout. `TEMPLATE_ROOT_CANDIDATES` names both,
    and `src/bin.ts` uses it, so `node packages/cli/dist/bin.js my-game` works without a pack.
  - `VERSION` is exported, matching every other first-party package.
  
  The catalog half of the same problem — `"vite": "catalog:"` — is resolved at pack time instead,
  because only the repository has a catalog to read; a project scaffolded from a checkout therefore
  still carries `catalog:` and is meant for testing the copy rather than for installing.
  
  The scaffolded project is named after its target directory; `copyTemplate({ projectName })` overrides it and `null` keeps the template's name.
- b511cad: Ship the Electron desktop target.
  
  `@ignifx/electron` is no longer a skeleton. It has three entry points, one per Electron process:
  
  - **`@ignifx/electron/main`** — `createGameWindow` builds a window with `contextIsolation`,
    `sandbox`, `nodeIntegration: false` and `webSecurity` fixed as `CONSTITUTION.md` §9.2 requires,
    a strict Content-Security-Policy injected as a response header, every navigation and
    `window.open` refused, and every permission but pointer lock and full screen denied.
    `applyWebGpuSwitches()` turns WebGPU on, `registerIgnifxScheme()` and `serveIgnifxProtocol()`
    serve a packaged build from the secure `ignifx://app` origin — with a real MIME table and real
    `Range` support, which `net.fetch` of a `file://` URL does not provide — and
    `installHostHandlers()` registers the typed IPC surface behind the bridge. `windowOptionsFor`,
    `cspFor`, `protocolPathFor` and `parseRangeHeader` are exported as pure builders so the security
    checklist is a unit test rather than a manual review.
  - **`@ignifx/electron/preload`** — `exposeIgnifxHost()`, the one call a preload script makes. It
    exposes storage, paths, window controls, dialogs, the shell and the runtime versions through
    `contextBridge`, `invoke`-based, with no `ipcRenderer` reaching the page.
  - **`@ignifx/electron`** — the `electron()` extension. It finds the bridge, records
    `app.platform.kind = "electron"`, installs a file-system `StorageBackend` that writes
    `@ignifx/core`'s own on-disk layout, forwards the host's focus events to `onApplicationFocus`,
    and defines `app.desktop`. Registered in a browser tab it is inert, so one renderer bundle serves
    both builds.
  
  `create-ignifx --desktop` is real: it copies the template's `desktop/` directory,
  `electron.vite.config.ts` and `electron-builder.yml`. Without the flag the scaffold is browser-only
  and the three Electron build tools are stripped from its `package.json`, so a browser game does not
  download an Electron binary it never runs.
  
  All four templates gain a desktop variant with `dev:desktop`, `build:desktop` and `dist:desktop`.

### Patch Changes

- 0ea4c56: Fixes from the Phase 11 skill evaluation
  
  - `SceneAssetToken` lets a script declare a scene or prefab field with `asset(SceneAssetToken)`; `AssetTypeToken.prototype` is optional so a plain token can name an asset that has no class. Previously a prefab handle could only be held as an untyped property.
  - `create-ignifx` skips `out/`, `release/` and `coverage/` (desktop build output) at every depth and skips symlinks instead of following them; a template checkout that had been built used to be copied wholesale and to crash on the packaged Electron app's framework links.
- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
