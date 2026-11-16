# @ignifx/particles

ignifx particles: stateless GPU particle systems for fire, smoke, sparks, rain and similar effects, driven by declarative `.particles.json` definitions or the same objects built in code. For sprite games, `@ignifx/particles-2d` plays the same definitions.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/particles @ignifx/core
```

`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/particles/SKILL.md` (`node_modules/@ignifx/particles/skills/particles/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
