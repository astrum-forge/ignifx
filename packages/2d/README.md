# @ignifx/2d

The ignifx 2D toolkit: `Camera2D`, sprites, sprite animation, atlases, tilemaps, sorting layers, pixel-perfect rendering and parallax. It uses the same entities, scripts, assets and frame phases as 3D; pair it with `@ignifx/physics-2d` for collision.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/2d @ignifx/core
```

`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/2d/SKILL.md` (`node_modules/@ignifx/2d/skills/2d/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
