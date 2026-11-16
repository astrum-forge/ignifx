# @ignifx/input

ignifx input: action maps and bindings over keyboard, mouse, pointer, gamepad and touch, with pointer lock and runtime rebinding. Game code reads actions such as `"move"` and `"jump"`, never key codes, and tests drive the same pipeline headless.

Part of [ignifx](https://ignifx.com), a code-first TypeScript game engine for WebGPU-capable browsers and Electron. The engine is pre-1.0: minor releases may include breaking changes.

## Install

```sh
pnpm add @ignifx/input @ignifx/core
```

The `ignifx` umbrella package re-exports this package.

## Documentation

The package ships its guide as an agent skill: `skills/input/SKILL.md` (`node_modules/@ignifx/input/skills/input/SKILL.md` once installed). It covers setup, the main APIs, recipes and gotchas.

## License

Apache-2.0 © Astrum Forge Studios
