# Editor protocol: method reference

What each method of the editor protocol takes, answers and refuses, beyond the tables in
[`../SKILL.md`](../SKILL.md). The scene view and the play view are separate hosts with separate
method sets; a host lists what it supports in the `capabilities` of its `ready` answer, and a method
it does not have answers `methodNotFound`.

## Scene view: the document

**An op's build problems come back with its command.** `applyOps` answers
`{ applied, failures, warnings }`. `warnings` holds `{ code, message }` issues, as `openScene`'s
does, for everything the subtrees its ops built or rebuilt reported: an override that names
nothing in the prefab, or a reference that resolves nowhere in the document. The op still
applies. Each issue is also a `log` warning for the Console. The answer is the record tied to the
command. A host from before this field sends no `warnings`.

**A schema says what its class requires and what it extends.** A component's `getSchemas` entry
carries `requires` (the type ids `addComponent` adds when missing) and `extends` (the registered
classes its class derives from, nearest first; `[]` when none). The engine counts a component
whose class extends a required one as present, so a required id is present on an entity when a
component has that id or lists it in `extends`. A host from before `extends` sends no such member.

**Settings over the protocol.** `describeSettings` answers `{ sections, values }`: core's
`describeSettings(app)` with each section's `settingsJsonSchema` entry as `propsSchema`, and the
values the app resolved, in the settings form (`{ x, y, z }`, `{ r, g, b, a }`). No notification
announces settings; ask again after the project's settings change.

**A changed asset reloads in place, not the view.** The scene view's page hands every
`ignifx:asset-changed` event to `host.assetChanged`, which calls `app.assets.reload(address)` for an
asset the app has loaded, of type `scene` (a scene or prefab), `model`, `mesh`, `material`,
`spriteatlas` or `shader`. A changed prefab rebuilds the document's instances of it, directly or
through another prefab, with their uids, transforms, overrides and document children; `readBack`
then writes the new prefab's hash. An override the new prefab no longer has, like any problem
building an op's subtree, is a `log` warning worded as a reopen's (an op's problems also come back
in `applyOps`' `warnings`). A rebuilt subtree resolves its
references, the ones its overrides hold included, against the whole document, as a reopen does,
and so do the references into it from the rest of the document, other instances' overrides
included. The host sends `assetReloaded { address, type, entities }` (the rebuilt instance
roots) once the new value is in. A texture, a removed file and the open document's own file are
left alone and send nothing.

## Scene view: picking and the view

**A `pick` carries the camera ray, hit or miss.** On a canvas the answer adds
`ray: { origin, direction }` (world space, from the editor camera's `screenToRay` at the converted
backing pixel) and, when the ray crosses `z = 0` ahead of the camera, `plane: [x, y, 0]`. A 3D
editor drops an asset where `ray` meets `y = 0`; a 2D one uses `plane`.

**Box selection is `pickRect`.** `pickRect { x0, y0, x1, y1, unit, mode? }` takes two opposite
corners in `pick`'s unit and answers `{ entities, truncated }`: the document entities whose drawn
bounds (each visible mesh's 8 bounds corners projected through the editor camera; sprites and
tilemaps too in 2D view mode) overlap the rectangle, or with `mode: "contain"` lie wholly inside
it and in front of the camera, in document order. A prefab member counts for its instance root,
as with `pick`; an entity that draws nothing (a light, an empty) is never listed.

**The 2D view mode needs a canvas, not a dependency.** On a canvas the host lists `viewMode2d` and
`pick2d`. `openScene` and `sceneOpened` report `viewMode`: `"2d"` for `twoD.mode: "sprite"` or a
scene whose cameras are all `Camera2D`. `setViewMode { mode: "2d" }` enables the host's own
`Camera2D` (priority 1 000 000) and makes the 3D editor camera orthographic over the same
rectangle; the level's `Camera2D` is never changed. In 2D mode `frame` fits sprite quads and
tilemaps, and `pick` and clicks use `app.twoD.pickAt` (unpickable sprites included): a hit's
`point` is on `z = 0` and its `distance` is `null`. The host finds `app.twoD` and the 2D classes
by name, so a project without `@ignifx/2d` still gets an orthographic 2D view of its meshes.

**The grid.** With a canvas the scene host lists the `grid` capability and draws a grid: a
ground grid at `y = 0` in 3D view mode (depth-tested, centred under the eye, coarser the higher
the eye, faded out before its edge) and a faint grid over the 2D view (one line per layer pixel
from zoom 8). `setGrid { visible?, size?, overlay?, height? }` sets the whole grid each call; a field left out takes
its default (`visible: true`, `size: 1` metre, 0.001 to 1000). The grid starts visible at every
load, so re-send the editor's state after `ready`. It is never picked or saved, and never in the
play view; `screenshot` includes it while it is visible. With the `gridOverlay` capability,
`setGrid` also takes `overlay` (default `false`: the 3D grid draws over the scene, fainter, so a
floor mesh does not hide it) and `height` (default `0`: the 3D grid plane's world y, -100 000 to
100 000 metres); an older host ignores both.

**Editor lines.** With a canvas the scene host lists `editorLines` and draws the editor's own
line sets over the view in 3D and 2D: `setEditorLines { id, lines, color? }` (six numbers a
segment, world metres, as `getColliderOutlines` answers; `color` `[r, g, b, a?]`) replaces the
set `id`, `clearEditorLines { id? }` removes one or all. At most 64 sets of 100 000 segments;
never picked, saved or drawn in the game view; re-send them after `ready`.

**Materials and collider gizmos.** `setAnimateMaterials { enabled }` sets
`app.renderer.animateMaterialsInEditMode` (on at every start, so re-send it after `ready`).
`getColliderOutlines { entities }` answers `{ outlines }`: per enabled collider of each open
entity, its uid, the component's uid, `isTrigger`, and world-space `lines` (six numbers a
segment), read from `app.physics` / `app.physics2d` by shape, plus `truncated` when the request
passed 256 entities or the lines 600 000 numbers. Edit mode keeps physics bodies on the
transforms the editor moves without stepping, so the outlines and physics queries follow.

## Scene view: posing and painting

**A pose on demand.** `sampleAnimation { entity, state, normalizedTime, parameters? }` calls
`Animator.sample` on the entity's `Animator` and answers `{ posed }`; the edit-mode view keeps
the pose until the next sample. `posed` is `false` while the clips load, when the model lacks a clip the state names, and
always headless. Names are capped at 256 characters and `parameters` at 64 values. An
entity without an `Animator`, or an engine refusal such as an unknown state (`data.code`
`IGX-1202`), is `invalidParams`. The host finds `ignifx/Animator` by type id, so a project
without `@ignifx/3d` simply has none.

**A sprite frame on demand.** Every scene host lists the `spriteAnimation` capability and answers
`sampleSpriteAnimation { entity, clip, frame }` or `{ entity, clip, time }` (exactly one of the
two; `time` in seconds) with `{ posed }`: it calls `SpriteAnimator.sample(clip, frame)` or
`sampleTime(clip, time)` from `@ignifx/2d`, which writes the frame onto the entity's
`SpriteRenderer` and stops playback there. `posed` is `false` while the animation document or the
atlas loads. An entity without a `SpriteAnimator`, or an unknown clip (`data.code` `IGX-1108`), is
`invalidParams`. The host finds `ignifx/SpriteAnimator` by type id, as it does the `Animator`.

**Live tilemap painting.** With a canvas the scene host lists `tilemapCells` and answers
`setTilemapCells { asset, layer, cells }`: `cells` are flat `[index, tile, …]` pairs in the
`.tilemap.json` file's order (row-major, top row first), `layer` a layer name or index. Every
loaded `Tilemap` of the open scene whose `map` is `asset` is written with `Tilemap.setCells`, so
the view shows the paint at once; the answer is `{ tilemaps, changed }`. The file is not
written: save it, or a reopen shows the file's cells again.

## Play view

**The play view's `screenshot` needs a running game.** It takes the scene view's parameters and
answers the same `{ dataUrl, width, height }` from the game's canvas, paused or not. While the
frame loop does not run (before Play, after `stop` or `step`) it answers `notPlaying`, and before
the first frame `notReady`. Only a game with a canvas lists `screenshot` in `ready`; an older or
headless play view answers `methodNotFound`.

**The play view's `queryRuntime` reads one live entity.** `{ entity: uid, components?: typeId[] }`
answers the entity as `serializeEntity` writes it (serialized props only, no expressions), with at
most 64 components, prop strings clipped to 64 Ki, objects cut to 256 keys, keys and names
clipped to 256 characters (`omittedEntries` counts the keys, items and tags left out), and the
whole answer within 262,144 characters of JSON: components past the budget, in order, are counted
in `omittedComponents`. An
unknown uid answers `unknownEntity`; a stopped game `notPlaying`. A paused or stepped game
answers, so pause, `step`, `queryRuntime` reads a game frame by frame. Spawned entities get new
uids each run; a scene's own keep their file uids.

**The play view's `sendInput` drives the game's own input.** `{ events }` (1 to 64) of
`{ type: "keydown" | "keyup", control: "w" }` (a `<Keyboard>` control name) and
`{ type: "pointermove" | "pointerdown" | "pointerup", x, y, button? }` (`x`, `y` as 0–1 fractions of
the canvas) go to `app.input.simulateEvent` and resolve on the game's next frame; nothing reaches
the DOM, the editor's window or the OS. A bad event or unknown key answers `invalidParams` and
queues nothing; a stopped game `notPlaying`. A stepped game resolves the events only on its next
`step`, so step after sending. A held key stays down until its `keyup`. Only a game
with `app.input` lists `sendInput`; others answer `methodNotFound`.
