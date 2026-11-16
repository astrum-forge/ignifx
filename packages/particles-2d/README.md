# @ignifx/particles-2d

ignifx 2D particles: `ParticleSystem2D` plays a `.particles.json` effect as sprites on a sorting layer, so particles sort, blend and pan with everything else `@ignifx/2d` draws. It shares its definitions with `@ignifx/particles`.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/particles-2d @ignifx/particles @ignifx/2d @ignifx/core
```

`@ignifx/2d` and `@ignifx/particles` are required peers; register all three extensions.
`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/particles-2d/SKILL.md` (`node_modules/@ignifx/particles-2d/skills/particles-2d/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
