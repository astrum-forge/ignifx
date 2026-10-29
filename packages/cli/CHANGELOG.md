# @ignifx/cli

## 0.12.0

### Patch Changes

- d3740bb: Fix `ignifx import tilemap` dropping an object property named `__proto__`: it is now printed with the object's other properties.

## 0.11.0

No changes in this release.

## 0.10.0

### Minor Changes

- 002ecfa: `2d-topdown`, `2d-sidescroller` and `3d-first-person` projects keep their level in `assets/scenes/main.scene.json`, which `src/main.ts` loads, and open in the ignifx editor as `3d-third-person` projects do. Change the level by editing the scene file, and put code-only steps after `loadScene` in `main.ts`.
  
  - The extension list moves to `src/extensions.ts`. `3d-first-person`'s `src/level.ts` is gone, and its primitive meshes are `assets/meshes/*.mesh.json` files.
  - The 2D templates no longer spawn the tilemap's objects layer; the player, props, shrine and coins are entities in the scene file.
  - `main.ts` no longer imports anything under `src/scripts/`, so a script edit hot-patches instead of reloading the page.
- c4d8ea4: `3d-third-person` projects keep their level in `assets/scenes/main.scene.json`, which `src/main.ts` loads; `src/level.ts` is gone. Change the level by editing the scene file, and put code-only steps after `loadScene` in `main.ts`.
  
  - The extension list moves to `src/extensions.ts`, whose `extensions()` other tools can call to build an app with the same extensions.
  - `main.ts` no longer imports anything under `src/scripts/`, so the template itself no longer turns a script edit into a full page reload.
- 86e2819: Add `ignifx import tilemap <map.tilemap.json> <scene.scene.json> [--parent <entity>]`, which moves a tilemap's objects into a scene file as entities, tagged with their type, and removes them from the map. It prints each object's size and properties for you to put on the components you add. A file that is not the expected document reports `IGX-1407`.

### Patch Changes

- b6297fd: `create-ignifx --desktop` now writes a `pnpm-workspace.yaml` with `allowBuilds`, so `pnpm install` no longer fails on the install scripts of `esbuild` and `electron-winstaller`.
- 982fdb9: Desktop projects from `create-ignifx --desktop` now depend on `@types/node`, so `pnpm typecheck` no longer fails with `TS2688: Cannot find type definition file for 'node'`.
- fd0afe5: - `create-ignifx` now pins a new project's `@ignifx/*` dependencies to its own release (for example `^0.9.1`) instead of `^0.0.0`, which installed the empty 0.0.0 packages.
  - `VERSION`, `app.version`, each extension's `version` and the `engineVersion` written into saved scenes now report the installed release instead of `"0.0.0"` (or `"0.2.1"`). `VERSION` is typed `string` instead of a fixed literal.
- ebc919e: `pnpm dev:desktop` in a desktop project now downloads the Electron binary on its first run, instead of failing with `Error: Electron uninstall` after a fresh install. The download runs from the `dev:desktop` script, not from an install script, so `pnpm install` still runs no unreviewed install scripts.
- e6b48ee: `2d-topdown` and `2d-sidescroller` projects no longer hand the tilemap's collision data to its collider in `src/main.ts`: the collider reads the `Tilemap` beside it.
  
  Their `assets/level.tilemap.json` files no longer carry an objects layer; the player, props, shrine and coins were already entities in the scene file.
  
  Their still sprites name their frame in `SpriteRenderer.frameName`, so `src/scripts/sprite-frame.ts` is gone and an editor shows each prop's frame without running a script.
- e165e9a: `3d-third-person` projects open in the ignifx editor: `pnpm dev` serves the editor's scene view, and the editor can play, pause, step and stop the game. Production builds contain no editor code.
- ea0ff93: `3d-third-person` projects keep their primitive meshes in `assets/meshes/*.mesh.json` files, so the level loads in the ignifx editor with no game code run first.

## 0.9.0

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.0

### Patch Changes

- 2ea5e9e: - Add `ThirdPersonCamera.minDistance` (default 0.5 m): wall collision no longer pulls the boom inside the character when it backs into a corner. Set it to `0` for the old behaviour.
  - Correct the `Environment.blur` documentation: Babylon Lite blurs only the visible skybox, not reflections or lighting.
  - `InstancedMeshRenderer` documents that `lod` needs `gpuCulling`, and logs `IGX-0727` once when a LOD partner is declared with culling off, because that partner never draws.
  - The devtools overlay has a close button at the end of its tab strip, and a side-docked overlay leaves 40 pixels of the page uncovered; the inspector's header buttons wrap instead of being cut off.
  - 2d-sidescroller: falling into a pit no longer loops forever; the respawn point is saved only where there is ground under the character's centre.
  - 3d-first-person: the touch crouch button sits above interact, so it no longer overlaps the move stick on a phone.
  - 3d-third-person: the camera widens its field of view on a portrait screen, and the `?static=1&hud=1` HUD shows the companion's real starting distance.
  - The touch controls in all four templates have localized accessible names instead of control ids.
- 3193dd0: Fix the 2D side-scroller template so down and jump on solid ground is a normal jump instead of dropping the player into the floor; it still drops through one-way planks.

## 0.6.1

No changes in this release.

## 0.6.0

### Patch Changes

- fb398ca: The scaffolded templates no longer call `.retain()` on an asset handle before assigning it to a component field. A field takes no reference of its own, so those extra references were never released; the templates now assign the handle directly and keep the handles they create for the game's lifetime.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- 6e1eed7: - Add `@ignifx/terrain`: `Terrain` loads a `.terrain.json` with a 16-bit `.r16` heightmap, a PNG heightmap, or seeded noise, and draws it as chunked geomipmapped meshes with skirts, one level of detail per chunk, chosen and frustum-culled every frame.
  - Blend up to eight texture layers with RGBA control maps or height and slope rules through one PBR material and a surface shader, so shadows, image-based lighting and fog stay intact. Per-layer roughness is not available.
  - Query the terrain without physics: `heightAt`, `normalAt`, `raycast`, `bounds`, `worldToSample` and `sampleToWorld`. `colliderInit()` returns the init a `HeightfieldCollider` from `@ignifx/physics` accepts, and `setHeights` sculpts at runtime and raises `onHeightsChanged`.
  - Add `TerrainScatter`, which places grass and trees on chosen layers, slopes and heights with a seed, and draws them through `InstancedMeshRenderer` with GPU culling, an LOD mesh and the `foliageMaterialDefinition` wind shader.
  - An 8-bit heightmap loads with a terracing warning (`IGX-1603`). Convert 16-bit PNGs with the new `ignifx import heightmap in.png out.r16` command in `@ignifx/cli`.
  - The `ignifx` umbrella re-exports the package.

### Patch Changes

- be82465: Clarify API documentation and starter-template comments, and update the README's setup instructions.

## 0.2.1

No changes in this release.

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
