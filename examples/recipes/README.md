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
- A new recipe needs a row in the table below **and** in
  `skills/ignifx/references/recipes/README.md`, which `pnpm docs:recipes` enforces.

## The tsconfig, and why it needs `pnpm build`

`tsconfig.json` here maps `@ignifx/*` and `ignifx` onto `packages/*/dist/index.d.ts`, exactly as the
documentation harness does when it type-checks the generated pages
(`scripts/lib/check-examples.ts`). Run `pnpm exec tsc --build examples/recipes/tsconfig.json` after
`pnpm build` and it is clean; without a build it reports missing modules, which is the honest
answer — a recipe compiles against the published surface, not against the sources.

It used to point at `packages/*/src/index.ts`, and that could never be clean: every extension
declares its `app.<service>` through a `declare module "@ignifx/core"` augmentation, so a program
that holds both core's sources and an extension's sources sees core's own `AppImpl` fail to satisfy
the widened `App` — six `TS2420`/`TS2322` errors in files no recipe imports. A `.d.ts` carries the
augmentation without carrying the implementation, which is what a consumer actually sees.

This project is not part of `tsc --build tsconfig.json` or `pnpm typecheck`; it exists so an editor
and `oxlint --type-aware` resolve these files the same way the harness does.

## The recipes

| Recipe                                                                     | Task                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`load-a-model`](load-a-model/main.ts)                                     | Load a `.glb` and show it with a `Model` component                             |
| [`spawn-a-prefab`](spawn-a-prefab/main.ts)                                 | Load a `.prefab.json` as a `SceneAsset` and stamp copies of it out             |
| [`spawn-a-prefab-on-click`](spawn-a-prefab-on-click/main.ts)               | Raycast from the camera on a click and instantiate a physics prefab at the hit |
| [`bind-an-action-and-read-it`](bind-an-action-and-read-it/main.ts)         | Build an action document with two control schemes and read it in `update`      |
| [`rebind-a-key-at-runtime`](rebind-a-key-at-runtime/main.ts)               | Rebind one binding interactively and persist the overrides in `app.storage`    |
| [`character-controller-3d`](character-controller-3d/main.ts)               | Walk and jump a `CharacterController` in `fixedUpdate`, with coyote time       |
| [`raycast-and-trigger-3d`](raycast-and-trigger-3d/main.ts)                 | Poll the physics world with a ray, and react to a trigger volume               |
| [`third-person-camera`](third-person-camera/main.ts)                       | Follow a character with an orbit rig that avoids walls                         |
| [`platformer-controller-2d`](platformer-controller-2d/main.ts)             | Run and jump a `CharacterController2D` with autostep and snap-to-ground        |
| [`animate-a-sprite-from-an-atlas`](animate-a-sprite-from-an-atlas/main.ts) | Play a clip from a `.spriteanim.json` and flip the sprite by direction         |
| [`load-a-tilemap-with-collision`](load-a-tilemap-with-collision/main.ts)   | Draw a `.tilemap.json` and give its tiles Rapier collision shapes              |
| [`play-a-one-shot-and-a-loop`](play-a-one-shot-and-a-loop/main.ts)         | Play a positional one-shot on a bus and fade a music loop with a tween         |
| [`build-a-pause-menu`](build-a-pause-menu/main.ts)                         | Pause the app, swap action maps, and drive a `Dialog` by keyboard and pad      |
| [`tween-a-transform`](tween-a-transform/main.ts)                           | Chain eased tweens on a transform and cancel them on destroy                   |
| [`save-and-load-game-state`](save-and-load-game-state/main.ts)             | Write a versioned save slot to `app.storage` from an autosave coroutine        |
| [`show-diagnostics-in-devtools`](show-diagnostics-in-devtools/main.ts)     | Publish a gameplay counter into `app.diagnostics` and read it back             |
