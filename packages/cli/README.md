# @ignifx/cli

The `create-ignifx` scaffolder: it copies a template directory into a new project directory.

```sh
npx --package=@ignifx/cli create-ignifx my-game --template 2d-topdown
# or
pnpm --package=@ignifx/cli dlx create-ignifx my-game --template 2d-topdown
```

Name the executable. The package installs two, `create-ignifx` and `ignifx`, and neither is called
`cli`, so the short form `npx @ignifx/cli my-game` (and `pnpm dlx @ignifx/cli my-game`) stops with
"could not determine executable to run".

```
create-ignifx <target-dir> [--template <name>] [--overwrite] [--desktop]
```

- `--template` defaults to `2d-topdown`.
- `--overwrite` allows writing into a directory that already has contents; without it a non-empty
  target fails with `IGX-1401`.
- `--desktop` also copies the template's Electron variant: its `desktop/` directory,
  `electron.vite.config.ts`, `electron-builder.yml` and `tsconfig.desktop.json`, with the
  `*:desktop` scripts and the `electron` / `electron-vite` / `electron-builder` / `@types/node` dev
  dependencies that go with them. Without it the scaffold is browser-only: those four entries are
  not copied, and the scripts and the four dev dependencies are stripped from the copied
  `package.json` — a browser game should not download an Electron binary it never runs.
  `@ignifx/electron` stays in both, because `src/main.ts` registers its (inert in a browser)
  extension.

## Desktop projects

```sh
npx --package=@ignifx/cli create-ignifx my-game --template 3d-third-person --desktop
cd my-game && pnpm install
```

| Script               | What it does                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:desktop`   | `install-electron && electron-vite dev` — downloads the Electron binary on the first run, then opens the game in an Electron window, with hot reload in the renderer.                    |
| `pnpm build:desktop` | `electron-vite build` — the main, preload, and renderer bundles into `out/`.                                                                                                             |
| `pnpm dist:desktop`  | `electron-builder --dir --config electron-builder.yml` — an **unpacked, unsigned** app in `release/`. Add `--mac`, `--win`, or `--linux` to build an installer for one platform instead. |

A desktop scaffold also gets a `pnpm-workspace.yaml` whose `allowBuilds` lets pnpm run the install
scripts of `esbuild` and `electron` and skip `electron-winstaller`'s; without it, pnpm 11 stops the
install at the first unreviewed install script. A target that already has a `pnpm-workspace.yaml`
keeps its own.

Cross-platform packaging needs the target OS (or a CI runner for it): `electron-builder` can only
produce a macOS `.dmg` on macOS, and a Windows installer needs Windows for anything but the NSIS
target. Code signing and auto-update are documented after 1.0.

## Templates

`2d-topdown`, `2d-sidescroller`, `3d-third-person`, and `3d-first-person` ship. The published tarball carries them at `<package>/templates/<name>`, written by `prepack`
from the repository's `templates/` (`scripts/copy-templates.ts`); in a checkout the executable falls
back to that same `templates/` directory, so `node packages/cli/dist/bin.js my-game` works without a
pack. An unknown name fails with `IGX-1402`.

Two dependency specifiers are rewritten so that a generated project installs from the registry:

| In the template                 | In the generated project              | Rewritten by                              |
| ------------------------------- | ------------------------------------- | ----------------------------------------- |
| `"@ignifx/core": "workspace:*"` | `"^<version>"`                        | `copyTemplate`, at scaffold time          |
| `"vite": "catalog:"`            | the range `pnpm-workspace.yaml` names | `scripts/copy-templates.ts`, at pack time |

The catalog half happens at pack time because only the repository has a catalog to read, so a
project scaffolded from a **checkout** still carries `catalog:` and is meant for testing the copy,
not for installing.

The copied `package.json` is named after the target directory (lower-cased, with anything npm would
reject replaced by `-`); pass `projectName` to `copyTemplate` to choose the name, or `null` to keep
the template's own.

The package is also a library. `copyTemplate`, `parseArgs`, `resolveTemplateDir`, and `runCreate` are
exported from `@ignifx/cli` so the scaffolding step can be driven from a script or a test. The
package's type declarations are the full list of exports.

## The `ignifx` executable

The package also installs `ignifx`, whose commands convert editor files into engine formats. Add
`@ignifx/cli` to a project's dev dependencies and run it as `pnpm exec ignifx …`, or run it once
with `npx --package=@ignifx/cli ignifx …`:

```
ignifx import heightmap <in.png> <out.r16>
ignifx import tilemap <map.tmj> [<out.tilemap.json>] [--pixels-per-unit <n>] [--drop-flips]
ignifx import tilemap <project.ldtk> [<out directory>] [--pixels-per-unit <n>] [--drop-flips]
ignifx import tilemap <map.tilemap.json> <scene.scene.json> [--parent <entity name>]
```

The Tiled and LDtk form writes one `.tilemap.json` per map or level and an `.atlas.json` beside
each tileset image that has none; the last form moves a tilemap's objects layer into a scene file
as entities and removes them from the map, because the runtime never spawns tile objects.

The conversion behind the Tiled and LDtk form is also a pure function, for tools that import maps
themselves: `convertTilemapSource(text, kind, read, options)` from `@ignifx/cli/tilemap` reads the
files a map references through `read` and returns the documents to write and the warnings, with
caps (`DEFAULT_TILEMAP_SOURCE_LIMITS`) that refuse a hostile map before it allocates. The subpath
has no import-time side effects and does not load the scaffolder.

## License

Apache-2.0 © Astrum Forge Studios
