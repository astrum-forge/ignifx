# @ignifx/audio

ignifx audio: a mixer tree of named buses, an `AudioSource` component, an `AudioListener`, `AudioClip` assets, a crossfading `MusicPlayer` and browser unlock handling. Playback is simulated under Node, so audio code is testable headless.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/audio @ignifx/core
```

`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/audio/SKILL.md` (`node_modules/@ignifx/audio/skills/audio/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
