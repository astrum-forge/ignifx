# Scripts

Plain Node ESM helpers that ship with the skill. No dependencies beyond the Node standard library,
no build step; run them with Node 24 from anywhere in a project. Both accept `--help` and print
their usage.

| Script             | Command                                                   | What it does                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-webgpu.mjs` | `node check-webgpu.mjs`                                   | Reports whether the current runtime exposes WebGPU, then prints the supported browser matrix and the Chromium flags headless WebGPU tests need. Informational: it always exits 0. Under Node the answer is always "no" — that is what `createApp({ headless: true })` is for. |
| `new-script.mjs`   | `node new-script.mjs <Name> [--namespace ns] [--dir dir]` | Scaffolds `<dir>/<kebab-name>.ts` with a `Script.define({ speed: f32(1) })` class, `static typeId = "<namespace>/<Name>"`, and an `update(dt)` stub. Defaults: `--namespace mygame`, `--dir src/scripts`. Refuses to overwrite an existing file (exit 1).                     |

Example:

```sh
node new-script.mjs PlayerController --namespace mygame --dir src/scripts
# Created …/src/scripts/player-controller.ts
#   typeId: mygame/PlayerController
#   Next: register it — app.registerComponents([PlayerController]);
```

The generated file compiles against `@ignifx/core` as it stands (plain `static` on the statics, no
`override` keyword,
`implements ScriptCallbacks` for signature checking, no non-null assertions); see
`../references/concepts/scripting.md` for the field kinds to add to its schema.
