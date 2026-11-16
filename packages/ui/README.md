# @ignifx/ui

ignifx UI: a DOM overlay over the canvas with named layers for menus, HUDs and dialogs in any web framework, focus routing, and GPU-drawn world and HUD text for the cases the DOM cannot cover.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/ui @ignifx/core
```

`@ignifx/input` is an optional peer, needed only for the virtual joystick and button.
`@babylonjs/lite` is a peer dependency at the version `@ignifx/core` pins; pnpm and npm install it for you.
The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/ui/SKILL.md` (`node_modules/@ignifx/ui/skills/ui/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
