---
"@ignifx/cli": patch
---

Desktop projects from `create-ignifx --desktop` now depend on `@types/node`, so `pnpm typecheck` no longer fails with `TS2688: Cannot find type definition file for 'node'`.
