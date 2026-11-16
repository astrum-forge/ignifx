# @ignifx/terrain

ignifx terrain: heightmap and procedural ground with chunked level of detail, blended texture layers, height and raycast queries, a heightfield collider, runtime sculpting and seeded foliage scatter.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/terrain @ignifx/core
```

`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/terrain/SKILL.md` (`node_modules/@ignifx/terrain/skills/terrain/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
