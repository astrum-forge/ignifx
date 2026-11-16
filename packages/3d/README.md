# @ignifx/3d

The ignifx 3D toolkit: character controllers, camera rigs that avoid walls, the `Animator` state machine for skeletal animation, and navigation. Drawing (`Model`, `MeshRenderer`, `Camera`, `Light`) is `@ignifx/core`; collision is `@ignifx/physics`.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/3d @ignifx/core @ignifx/input @ignifx/physics
```

`@ignifx/physics` and `@ignifx/input` are required peers.
`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/3d/SKILL.md` (`node_modules/@ignifx/3d/skills/3d/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
