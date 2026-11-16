# @ignifx/physics

ignifx 3D physics on Havok through Babylon Lite: rigidbodies, colliders, triggers, a character controller and queries, stepped by the engine's fixed loop. It runs headless under Node with no GPU.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/physics @ignifx/core
```

`@babylonjs/lite` (at the version `@ignifx/core` pins) and `@babylonjs/havok` are peer dependencies; pnpm and npm install them for you. With `@ignifx/vite-plugin`, list `@ignifx/physics` in the project's own `package.json` so the plugin copies `HavokPhysics.wasm`.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/physics/SKILL.md` (`node_modules/@ignifx/physics/skills/physics/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
