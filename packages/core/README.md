# @ignifx/core

The ignifx core: the app and frame loop, world, entities, transforms, components, scripts, schemas, signals, rendering, assets, the scene and prefab format, storage, and the Babylon Lite adapter boundary. Every other `@ignifx/*` package is an extension registered on a core app.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/core
```

`@babylonjs/lite` is a dependency, pinned to one exact version. The `ignifx` umbrella package re-exports core together with the standard extensions.
`@ignifx/core/prefab` is a second entry point for tools that edit prefab overrides.

## Documentation

This package ships no skill of its own. The engine guide is the `ignifx` agent skill in the umbrella package: `skills/ignifx/SKILL.md` (`node_modules/ignifx/skills/ignifx/SKILL.md` once `ignifx` is installed). It covers setup, concepts, API references, file formats, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
