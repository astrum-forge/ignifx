# @ignifx/editor-host

## 0.12.0

### Minor Changes

- 3999551: Fix loading a scene file that lists a component before one its class `requires`: the file's own record is used instead of a second, auto-added instance (or an `IGX-0202` error).
  
  `describeRegisteredSchemas` and the editor host's schema descriptions now list each component's `requires` as type ids.
- 8d7f8ef: Fix prefab instances with two overrides of one identity, which a merge conflict can leave: the first had no effect, and an editor that edited or removed the override reached only one of the two.
  
  ### Breaking
  
  `validateSceneFile` and the scene loader now refuse an instance whose overrides repeat an identity (the same `path` and `op`, and for an `add` to `<uid>/components` the same added component uid) with `IGX-0608`, and the editor host refuses such a file at `openScene` and such an entry in `createEntity` or `instantiate`. If a scene fails to load with `IGX-0608` naming `overrides/<n>`, keep one of the two overrides it names.
- 921bc63: Return the build problems of an `applyOps` command, such as an override that names nothing in the prefab, in its result's new optional `warnings`, as `openScene` does; they are still logged as well.
- 9c2b5a3: The editor host clips each string in a `log`, `hostError` or `hotReloaded` report to the new `HOST_TEXT_MAX_LENGTH` (1 MiB, ending `… [clipped]`) and each list to the new `HOST_LIST_MAX_LENGTH` (4096), so the editor no longer drops an oversized report. The wire stays protocol 0.3.
- a7f40bb: Describe each component's ancestry in `getSchemas`: the new optional `extends` lists the type ids of the registered classes the component's class derives from, nearest first, so an editor can tell that a subclass of a required component already satisfies `requires`, as the engine does.

### Patch Changes

- 0a851bb: `editorHostPlugin()` now fails a `vite build`, and removes the copies, when the output holds files from the editor-private `.ignifx/` directory (such as a link under `public/` into it), as `ignifx()` already does, so a config without `ignifx()` cannot ship the editor's MCP token.
- 9b48827: The scene view reports a click whose selection pick fails as a `hostError` instead of an unhandled promise rejection.
- c0f6775: The scene view reports a component that throws while taking a hot-reloaded default as a `hostError`, and still gives the other components their defaults and rebuilds prefab instances.
- 12ffc27: Fix a prefab instance in the scene view drifting from the document after an override edit: a component the instance adds now follows a changed script default, and removing an override that equals the prefab's value no longer fails.
- 863c3ff: The scene view now sends `transformDragging` when a gizmo drag starts and `transformDragged` when every drag ends, even one that ends where it started, so the editor can hold undo until the drag is over.
- 0dbe07f: Fix a prefab instance member's overridden reference into another instance becoming `null` in the scene view when that other instance is rebuilt (an override edit, an asset reload or a changed default); it now points at the rebuilt entity or component, as it does when the scene opens.
  
  A reference that resolves nowhere is no longer reported again each time a reference beside it in the same field is resolved after a rebuild.
  
  The `outsideReferences` documentation of `instantiateScene` now says it also resolves a reference to a component an instance's `remove` override deleted.
- 7de8dda: `openScene` builds a component once when an older editor's `readBack` saved it both as an instance root's own and as an `add` override with the same uid, and warns once with `IGX-0608`, so `readBack` no longer changes after the first rebuild.
- 234534b: Fix a reference that a prefab instance's override holds in the scene view becoming `null` after an override edit, an asset reload or a changed default; it now resolves as it does when the scene opens.
  
  A component added to the root of a one-root prefab instance is no longer built twice when the scene view rebuilds the instance.
  
  `instantiateScene` takes `outsideReferences`, which resolves a reference to a uid the file does not declare.
- fa7049d: The editor host's skill, examples and error hints now name the packaged ignifx editor's origin, `ignifx-editor://app`, instead of a packaged game's `ignifx://app`; a `vite.config.ts` copied from the skill falls back to an origin the editor can frame.
- 9fe45bb: `readBack` now shows changes a `"run"` system or a `runInEditMode` script made outside an op, including right after `openScene`, instead of the document as it was at the last op.
- 18a5f55: Fix the editor's scene mirror check failing for a prefab instance whose overrides are not in the serializer's order (a member's prop override set before its transform override), include one equal to the prefab's value, or were sent as `op: "replace"` or with unrounded transform numbers: `readBack` now returns the instance's override list as the document holds it while its members are unchanged.
- cf1a7e7: A component that an instance's `add` override gives the root of a one-root prefab now follows a default changed by a script's hot reload.
  
  `openScene` keeps an instance root's own component when an `add` on another member reuses its uid, and warns with `IGX-0608` that the file uses the uid twice, instead of dropping the component as an older editor's double form.
- 4089adc: Report the build problems of a scene view op or prefab rebuild, such as an override a hot-reloaded prefab no longer has, as `log` warnings worded as a reopen's, instead of dropping them.
- 4ba8966: Fix `__proto__` keys in the editor host: a settings `map` entry named `__proto__` now reaches the settings panel instead of being dropped, and an `applyOps` path through `__proto__` resolves only when the document holds that key as data; otherwise it fails with `invalidPath`.
- Updated dependencies [8ea4101]
- Updated dependencies [3999551]
- Updated dependencies [8d7f8ef]
- Updated dependencies [0dbe07f]
- Updated dependencies [234534b]
- Updated dependencies [5dcbff1]
- Updated dependencies [a71c607]
- Updated dependencies [1c7878c]
- Updated dependencies [38ddd7a]
- Updated dependencies [51efbc6]
- Updated dependencies [7f5b116]
  - @ignifx/core@0.12.0
  - @ignifx/vite-plugin@0.12.0

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
