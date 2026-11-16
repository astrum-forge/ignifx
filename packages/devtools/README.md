# @ignifx/devtools

ignifx devtools: a debug overlay over the canvas with frame statistics, the entity tree, a live component inspector, asset, input, audio and physics panels, the log, and script hot reload. It is a development tool; do not ship it in a production bundle.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add -D @ignifx/devtools
```

`@ignifx/core` is a required peer. `@ignifx/ui`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics` and `@ignifx/physics-2d` are optional peers: a panel whose extension is not registered says so.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/devtools/SKILL.md` (`node_modules/@ignifx/devtools/skills/devtools/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
