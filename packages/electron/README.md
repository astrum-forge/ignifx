# @ignifx/electron

ignifx Electron support: a hardened main-process window factory with the WebGPU switches, the `ignifx://` protocol, a typed preload bridge, and file-system storage. One renderer bundle serves both the browser build and the desktop build.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add -D @ignifx/electron electron
```

`@ignifx/core` is a required peer; `electron` is an optional peer, needed only for the desktop build. The entry points are `@ignifx/electron` (renderer), `@ignifx/electron/main` and `@ignifx/electron/preload`.
The umbrella re-exports the renderer entry. The quickest start is a desktop scaffold from `@ignifx/cli` (`create-ignifx <dir> --desktop`).

## Documentation

The package ships its guide as an agent skill: `skills/electron/SKILL.md` (`node_modules/@ignifx/electron/skills/electron/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
