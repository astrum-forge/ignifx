# Recipes

One recipe is one task, one directory, and one `main.ts` that compiles against the built packages.
`pnpm docs:recipes` turns each of them into `skills/ignifx/references/recipes/<name>.md`, and
`pnpm docs:harness` type-checks the code block it produced — so a recipe can never describe an API
that does not exist (`docs/architecture/16-docs-harness-and-skill.md` §3).

## Writing one

```
examples/recipes/<name>/
  main.ts               the recipe: a leading /** … */ comment, then the code
  <fixture>.json        any file the code loads, kept tiny
```

- The **first block comment** in `main.ts` is the prose. Its first line is the page title; the rest
  is the body, rendered above the code.
- Everything after that comment is the recipe, emitted as one fenced `ts` block. The cap is **80
  lines** (`16-docs-harness-and-skill.md` §5); a longer recipe is two recipes.
- Import from the published entry points only — `@ignifx/core`, `@ignifx/2d`, … — never from a
  relative path inside the repository, because the block is compiled outside it.
- These directories are not workspace packages and are not built or served; they are compiled as
  documentation. An example you can run lives in `examples/<name>/` instead.

## The recipes

| Recipe                                     | Task                                                               |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [`load-a-model`](load-a-model/main.ts)     | Load a `.glb` and show it with a `Model` component                 |
| [`spawn-a-prefab`](spawn-a-prefab/main.ts) | Load a `.prefab.json` as a `SceneAsset` and stamp copies of it out |
