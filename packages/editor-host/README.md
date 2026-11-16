# @ignifx/editor-host

The part of the ignifx editor that lives inside a project: it runs the project's own engine in the editor's scene view and play view, over a versioned protocol. Game code never calls it, and production builds contain none of it.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add -D @ignifx/editor-host
```

Install the same version as the project's `@ignifx/core`: this package is on the engine's version line, not the editor's. `@ignifx/core` and `@babylonjs/lite` are peers; the `@ignifx/editor-host/vite` entry also needs `@ignifx/vite-plugin` and `vite`.
The `ignifx` umbrella package does not include it.

## Documentation

The package ships its guide as an agent skill: `skills/editor-host/SKILL.md` (`node_modules/@ignifx/editor-host/skills/editor-host/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
