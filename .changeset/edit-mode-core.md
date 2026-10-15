---
"@ignifx/core": minor
---

Add edit mode for editors: `createApp({ editMode: true })` shows a scene without playing it.

- No script gets a callback unless its class sets `static runInEditMode = true`; the fixed loop and physics do not run; `app.isEditMode` reports the mode.
- `startCoroutine` throws `IGX-0111` in edit mode for a script that does not run in edit mode.
- `registerSystem` takes `editMode: "run" | "hold" | "skip"` (default `"run"`) to say what a system does in edit mode; a held system sees `ctx.dt === 0` and `ctx.isClockHeld === true`.
- In edit mode `entity.isStatic` stays writable, the shader `time` uniforms hold still, and a hot-reload patch that changes `runInEditMode` re-creates the instances.

### Breaking

`SystemContext` has a new required `isClockHeld` field. Code that builds a `SystemContext` by hand, usually a test, must add `isClockHeld: false`.
