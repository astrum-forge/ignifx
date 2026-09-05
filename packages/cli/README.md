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

The real templates (`2d-topdown`, `2d-sidescroller`, `3d-third-person`, `3d-first-person`) arrive in
Phases 6 and 7. Until then the command resolves its templates root, finds nothing, and fails cleanly
with `IGX-1402`.

The package is also a library. `copyTemplate`, `parseArgs`, `resolveTemplateDir`, and `runCreate` are
exported from `@ignifx/cli` so the scaffolding step can be driven from a script or a test; the public
surface is recorded in `api/cli.api.md`.
