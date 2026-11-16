# ignifx

The ignifx umbrella package: it re-exports `@ignifx/core` and the standard runtime extensions (2D, 3D, input, audio, UI, 3D and 2D physics, particles, terrain, Electron and devtools) from one entry point, and ships the ignifx agent skill.

[ignifx](https://ignifx.com) is a code-first TypeScript game engine for WebGPU-capable browsers and Electron, built on Babylon Lite. There is no WebGL fallback. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add ignifx
```

Register the extensions a game needs when it creates the app; importing them has no side effects. A game can depend on individual `@ignifx/*` packages instead.
With `@ignifx/vite-plugin`, also list `@ignifx/core` and `@ignifx/physics` in the project's own `package.json` when the game loads compressed textures or models, or uses 3D physics: the plugin copies an extension's static files only for packages installed directly.
To start from a playable template, use the `create-ignifx` scaffolder in `@ignifx/cli`.

## Documentation

The package ships the engine guide as an agent skill: `skills/ignifx/SKILL.md` (`node_modules/ignifx/skills/ignifx/SKILL.md` once installed). It covers setup, concepts, API references, file formats, recipes and gotchas, and names the skill of each subsystem package.

## License

Apache-2.0 © Astrum Forge Studios
