---
"@ignifx/cli": patch
---

`create-ignifx --desktop` now writes a `pnpm-workspace.yaml` with `allowBuilds`, so `pnpm install` no longer fails on the install scripts of `esbuild` and `electron-winstaller`.
