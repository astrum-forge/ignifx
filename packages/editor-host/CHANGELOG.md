# @ignifx/editor-host

## 0.11.0

### Minor Changes

- fac8cc9: Add the `ComponentHooks.onValidate(fields)` hook, which the editor host calls after an inspector edit or a hot-reload default changes a component's fields; colliders, rigidbodies and character controllers rebuild their body there.
- 52dcdc8: Add the scene view's `setAnimateMaterials` and `getColliderOutlines` methods, additive in protocol 0.3: the editor's "animate materials" toggle, and world-space collider outlines from the project's physics extensions for its collider gizmos.
- 4b7d654: Add the `sampleAnimation { entity, state, normalizedTime, parameters? }` scene method, which poses an entity's `Animator` through `Animator.sample` and answers `{ posed }`; it is additive within protocol 0.3, and an older host answers `methodNotFound`.

### Patch Changes

- 429d305: `editorHostPlugin()` now answers 404 to requests into the editor-private `.ignifx/` directory under `vite dev` and `vite preview`, by path or through a symbolic link, even in a Vite config without `ignifx()`.
- Updated dependencies [2964d6e]
- Updated dependencies [fac8cc9]
- Updated dependencies [3b5b8ed]
- Updated dependencies [3b5b8ed]
- Updated dependencies [8ee8a2f]
  - @ignifx/core@0.11.0
  - @ignifx/vite-plugin@0.11.0

## 0.10.0

### Minor Changes

- bd8c416: Add a 2D view mode to the scene view: `setViewMode` with `"2d"` shows the level through the host's own `Camera2D`, which pans, zooms and frames sprites, while `pick` and clicks select sprites with `app.twoD.pickAt`.
  `openScene` and `sceneOpened` now report the scene's `viewMode`, so the editor no longer has to guess it from the level's cameras.
- 29a4f46: The scene view reloads a model, mesh, material, sprite atlas, shader or prefab in place when it changes on disk, rebuilding the open scene's instances of a changed prefab with their uids, transforms and overrides, and sends a new `assetReloaded` notification.
  Textures are not reloaded yet; the editor still reloads the view for them.
- c44f1ad: The play controls relay the game's log lines, `app.onError` reports and hot reloads to the editor as `log`, `hostError` and `hotReloaded` play notifications, with the scene view's shapes; what the game reports before the handshake is kept (the newest 256) and sent right after `ready`.
  Both views list the new `logRelay` capability, a `hostError` for an app error carries `AppErrorData` (phase name, entity name, component `typeId`, stack), a `log` line carries the first `Error` it was given as `error: { message, code, stack }`, and each hot-reload error has its `stack`; all additive to protocol 0.3.
- 612ba87: Add `@ignifx/editor-host`, which lets the ignifx editor run a project's own engine. Its Vite plugin (`editorHostPlugin` from `@ignifx/editor-host/vite`) serves the editor's scene view at `/__ignifx_editor__/` from the project's dev server, and adds `virtual:ignifx/editor`, whose `attachEditorPlayControls(app)` lets the editor play, pause, step and stop the game in development and does nothing in a production build.
  
  - The host speaks editor protocol 0.3 over a `MessagePort`: `hello`/`ready`, `ping`, and a heartbeat. Before 1.0 the editor and the host must agree on the protocol's major and minor. It accepts a port only from the editor's origin, and the scene view may be framed only by that origin.
  - `ErrorRange.editorHost` (`"18"`) registers the `IGX-18xx` codes the new package throws.
- d991d76: The scene view's `pick` answer carries the editor camera's ray through the point, and the point where it meets `z = 0`, so the editor can drop an asset on the ground where nothing was hit.
  A new `describeSettings` request answers the project's settings sections and their current values, and the exported protocol types declare it, `PickRay`, and a schema's `allowMultiple` and `package`.
- 44e4121: The play view keeps the editor's first connect message: `virtual:ignifx/editor` listens as soon as it is evaluated, with the new `listenForEditorPlayControls`, and starts the handshake on that port when `main.ts` calls `attachEditorPlayControls(app)` after `await createApp(...)`.
  Under `vite dev` the game's own pages are served with `Content-Security-Policy: frame-ancestors <editorOrigin>`, as the scene view already was.
  The play controls answer a new `playState` request with `{ state, frameCount, time }` and send `playStateChanged` when the game starts playing, pauses or stops; both are additive to protocol 0.3.
- 70f3973: Add `playStats` to the play view: the game's frame rate, frame time, entity count and frame count.
  After a script's hot reload changes a field's default, the scene view now gives that field the new default wherever the open scene leaves it out, and lists `hotReloadDefaults` in `ready`.
- c1e2d80: The scene view mirrors the editor's open scene document (protocol 0.3): it opens the document, applies its edits, reads it back, selects, picks, frames, takes screenshots, reports component schemas and hot reloads, and draws gizmos whose drags the editor records.
  `@babylonjs/lite` is a new peer dependency, and a scene view with a canvas renders at `msaaSamples: 1` so its gizmos are visible.
- 7430ee5: The scene view describes its registered components with `describeRegisteredSchemas`, so the editor gets each component's `allowMultiple` and `package` and each field's inspector options, the project's own scripts included, and gets a new `schemasChanged` after every hot reload.
- 63d4e86: - Add `transformSchema()`, the entity transform (`position`, `rotation` as a quaternion, `scale`) as a schema, so inspectors and their ops can treat it like any component.
  - `describeSchemas()` and `describeRegisteredSchemas()` describe `ignifx/Transform` with those fields and mark it `builtIn`: it is each entity's `transform` block and cannot be added or removed.
  - The editor host's `getSchemas` answer describes `ignifx/Transform` the same way, with its `propsSchema`.
  - A `quat` field's inspector `step` is documented as degrees, because inspectors edit it as Euler angles.

### Patch Changes

- 8294d45: The scene view now runs in edit mode: `startEditorHost` creates its app with `createApp({ editMode: true })`, so the project's scripts get no callbacks unless their class sets `static runInEditMode = true`, and physics does not step. Pass `editMode: false` to run the scene view as a game. The play view is the game's own app and is unchanged.
- e13613d: The scene view's `pick` uses `app.renderer.pickAsync` alone and converts the point to backing-store
  pixels once, so glTF models are picked without the host's own Lite fallback.
- 7a926f4: The protocol types and guards the host exports declare a schema field's `step` and a schema's `builtIn`, as `@ignifx/editor-protocol` 0.3 does.
- 4a61803: The scene view keeps the project's `rendering.msaaSamples`; its gizmos and outline now draw in core's render overlay.
- Updated dependencies [6f197c9]
- Updated dependencies [1804a62]
- Updated dependencies [e0276f8]
- Updated dependencies [4c6e200]
- Updated dependencies [324ce73]
- Updated dependencies [37cf52e]
- Updated dependencies [612ba87]
- Updated dependencies [159ea03]
- Updated dependencies [b0480a0]
- Updated dependencies [1fba2ea]
- Updated dependencies [df7b73f]
- Updated dependencies [dc768d6]
- Updated dependencies [08e4b01]
- Updated dependencies [324ce73]
- Updated dependencies [86218fb]
- Updated dependencies [738f68d]
- Updated dependencies [fd0afe5]
- Updated dependencies [63d4e86]
- Updated dependencies [d6fe3e8]
- Updated dependencies [6573ebf]
  - @ignifx/core@0.10.0
  - @ignifx/vite-plugin@0.10.0
