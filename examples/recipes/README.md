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
- A recipe whose **first line after the comment is `// docs:run`** is emitted as a `ts run` block, so
  the harness `examples-run` check executes it under Node as well as type-checking it. Tag one only
  when it is headless and self-contained: a block that loads an asset over `fetch`, or needs a DOM or
  a GPU, has nothing to run against. The directive is consumed by the generator — it never reaches
  the page and does not count against the 80-line cap.
- Import from the published entry points only — `@ignifx/core`, `@ignifx/2d`, … — never from a
  relative path inside the repository, because the block is compiled outside it.
- Log through `app.log`, never `console`, and pass structured extras as arguments
  (`app.log.info("hero z:", z)`): a log message is not a format string, so `{placeholder}` tokens are
  printed verbatim.
- These directories are not workspace packages and are not built or served; they are compiled as
  documentation. An example you can run lives in `examples/<name>/` instead.
- A new recipe needs a row in `skills/ignifx/references/recipes/README.md`, which
  `pnpm docs:recipes` enforces.

## The tsconfig, and why it needs `pnpm build`

`tsconfig.json` here maps `@ignifx/*` and `ignifx` onto `packages/*/dist/index.d.ts`, exactly as the
documentation harness does when it type-checks the generated pages
(`scripts/lib/check-examples.ts`). Run `pnpm exec tsc --build examples/recipes/tsconfig.json` after
`pnpm build` and it is clean; without a build it reports missing modules, which is the honest
answer — a recipe compiles against the published surface, not against the sources.

It points at the built declarations, not at `packages/*/src/index.ts`: every extension declares its
`app.<service>` through a `declare module "@ignifx/core"` augmentation, so a program that holds both
core's sources and an extension's sources sees core's own `AppImpl` fail to satisfy the widened
`App`. A `.d.ts` carries the augmentation without carrying the implementation, which is what a
consumer sees.

This project is not part of `tsc --build tsconfig.json` or `pnpm typecheck`; it exists so an editor
and `oxlint --type-aware` resolve these files the same way the harness does.

## The recipes

The index is `skills/ignifx/references/recipes/README.md`, which `pnpm docs:recipes` checks against
the directories here: every `examples/recipes/<name>/` has a row there.
