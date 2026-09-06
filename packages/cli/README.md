# @ignifx/cli

The `create-ignifx` scaffolder: it copies a template directory into a new project directory.

```sh
npx @ignifx/cli my-game --template 2d-topdown
```

```
create-ignifx <target-dir> [--template <name>] [--overwrite] [--desktop]
```

- `--template` defaults to `2d-topdown`.
- `--overwrite` allows writing into a directory that already has contents; without it a non-empty
  target fails with `IGX-1401`.
- `--desktop` is parsed but rejected: Electron variants arrive in Phase 9 of the engineering plan.

## Templates

`2d-topdown` and `2d-sidescroller` ship today; `3d-third-person` and `3d-first-person` arrive in
Phase 7. The published tarball carries them at `<package>/templates/<name>`, written by `prepack`
from the repository's `templates/` (`scripts/copy-templates.ts`); in a checkout the executable falls
back to that same `templates/` directory, so `node packages/cli/dist/bin.js my-game` works without a
pack. An unknown name fails with `IGX-1402`.

Two dependency specifiers are rewritten so that a generated project installs from the registry:

| In the template                 | In the generated project | Rewritten by                     |
| ------------------------------- | ------------------------ | -------------------------------- |
| `"@ignifx/core": "workspace:*"` | `"^<version>"`           | `copyTemplate`, at scaffold time |

The copied `package.json` is named after the target directory (lower-cased, with anything npm would reject replaced by `-`); pass `projectName` to `copyTemplate` to choose the name, or `null` to keep the template's own.
| `"vite": "catalog:"` | the range `pnpm-workspace.yaml` names | `scripts/copy-templates.ts`, at pack time |

The catalog half happens at pack time because only the repository has a catalog to read, so a
project scaffolded from a **checkout** still carries `catalog:` and is meant for testing the copy,
not for installing.

The package is also a library. `copyTemplate`, `parseArgs`, `resolveTemplateDir`, and `runCreate` are
exported from `@ignifx/cli` so the scaffolding step can be driven from a script or a test; the public
surface is recorded in `api/cli.api.md`.
