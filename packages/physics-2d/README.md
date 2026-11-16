# @ignifx/physics-2d

ignifx 2D physics on Rapier 2D: `Rigidbody2D`, 2D colliders, `CharacterController2D` and queries, stepped by the engine's fixed loop. It runs headless under Node, and the WebAssembly is inlined, so nothing has to be served.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/physics-2d @ignifx/core
```

`@ignifx/2d` is an optional peer, needed only for tilemap colliders. A world uses either this package or `@ignifx/physics`, not both.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/physics-2d/SKILL.md` (`node_modules/@ignifx/physics-2d/skills/physics-2d/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
