# @ignifx/2d

## 0.10.0

### Minor Changes

- 5de1886: - Add `filter`, `ignore` and `includeUnpickable` options to `app.twoD.pickAt`; a rejected sprite no longer hides the sprites under it in its sorting layer.
  - Add `app.twoD.pickAllAt`, which returns the sprites under a point, topmost first, up to 64 unless `limit` says otherwise.
  - Add `Tilemap.setCells` for batched tile writes; `setTile` and `setCells` now update the drawn tilemap on the next frame, rebuilding only the chunks they touched.
- f5dac24: - Add `SpriteAnimator.sample(clip, frameIndex)`: it shows one frame of a clip without playing it and fires no event; `resume()` plays on from there.
  - In an edit-mode app, sprite clips and animated tiles do not play.
- 254b63c: - Add `SpriteRenderer.frameName`, a saved field that names the frame a sprite draws, so a scene file can choose a still sprite's frame. Setting `frame`, as `SpriteAnimator` does, still takes over until `frameName` is set again.
  - An unknown `frameName` reports `IGX-1106` once and draws the first frame.
  - A `#frame:` address in `SpriteRenderer.sprite` now reports `IGX-1118` once and draws nothing, instead of throwing in the 2D sync every frame. Name the atlas in `sprite` and the frame in `frameName`.
- 3a8e47b: ### Breaking
  
  A tilemap's objects layer no longer spawns entities when a scene loads (ADR-0030). `app.twoD.registerTileObjectFactory`, `unregisterTileObjectFactory`, `spawnTilemapObjects`, `TileObjectFactory` and `TileObjectContext` are removed, and `IGX-1110` is retired. Move the objects into your scene file once with `ignifx import tilemap <map.tilemap.json> <scene.scene.json>`, or, for a level built in code, create the entities from `tilemap.definition.objects` after the map has loaded.

### Patch Changes

- fd0afe5: - `create-ignifx` now pins a new project's `@ignifx/*` dependencies to its own release (for example `^0.9.1`) instead of `^0.0.0`, which installed the empty 0.0.0 packages.
  - `VERSION`, `app.version`, each extension's `version` and the `engineVersion` written into saved scenes now report the installed release instead of `"0.0.0"` (or `"0.2.1"`). `VERSION` is typed `string` instead of a fixed literal.
- 3c02fb1: `Tilemap.collisionData` read before the map finished loading no longer stays empty: the next read after the load builds the collision surface.
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
- Updated dependencies [738f68d]
- Updated dependencies [fd0afe5]
- Updated dependencies [63d4e86]
  - @ignifx/core@0.10.0

## 0.9.0

### Minor Changes

- 2c61694: ### Breaking
  
  ignifx now runs on Babylon Lite 1.34.0. `@babylonjs/lite` is pinned exactly, so install `@babylonjs/lite@1.34.0` alongside ignifx; the packages that declare it as a peer dependency accept no other version.
  
  - `app.start()` now runs one extra renderable rebuild before the first frame, so that turning a shadow-casting light on or off and adding the first skinned or morph-target model after start keep rendering on Lite 1.34.

### Patch Changes

- Updated dependencies [2c61694]
  - @ignifx/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [874d49b]
  - @ignifx/core@0.8.0

## 0.7.0

### Patch Changes

- f0f3f4f: Fix `CharacterController.isGrounded` reading false on any slope steeper than about 5°, a `HeightfieldCollider` included: a character now stands, and can jump, on every slope up to its `slopeLimit`.
  
  Fix tilemap chunk culling drawing only the first chunk column once the camera scrolled, when a `ParallaxLayer` band sorted first; `app.twoD.visibleWorldBounds` had the same fault.
  
  Fix a press and release that both land between two frames being lost: a quick click or a phone tap now resolves as a one-frame press, and its release in the frame after.
- Updated dependencies [2ea5e9e]
- Updated dependencies [a837a3e]
  - @ignifx/core@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [d843b2e]
  - @ignifx/core@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [3a8b165]
- Updated dependencies [41450fb]
- Updated dependencies [e198c1c]
- Updated dependencies [96cdf34]
- Updated dependencies [946e837]
- Updated dependencies [09ef95f]
  - @ignifx/core@0.6.0

## 0.5.0

### Minor Changes

- 6175ff5: The clear colour now presents exactly as authored. `rendering.clearColor`, `Camera.clearColor` and `Environment.clearColor` used to present much darker than their sRGB value (an sRGB `0.5` showed as byte `55` instead of `128`), with or without tone mapping or bloom, and in both 2D modes.
  
  ### Breaking
  
  Backgrounds get brighter wherever a clear colour is not pure black or white. If you wrapped a clear colour in `Color.linearToSrgb(...)` or brightened it by hand to make up for this, remove that compensation and write the sRGB colour you want.

### Patch Changes

- d617f2c: Fix API and skill examples that called `.retain()` on an asset handle before assigning it to a component field. A field takes no reference of its own, so that extra reference was never released. The examples now assign the handle directly and release it when it is no longer used.
- Updated dependencies [d617f2c]
- Updated dependencies [6175ff5]
- Updated dependencies [ee4f87b]
  - @ignifx/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [097d60b]
- Updated dependencies [1f45e2f]
  - @ignifx/core@0.4.0

## 0.3.1

### Patch Changes

- @ignifx/core@0.3.1

## 0.3.0

### Minor Changes

- 6e1eed7: - Add `app.twoD.createSpriteBatch({ atlas, capacity, sortingLayer, blend })` (beta): a fixed number of sprite slots on one sorting layer written directly with `write(index, x, y, width, height, frame, rotation, r, g, b, a)`, with no entity per sprite. Use it for bullets, debris and 2D particles.
  - `count` hides the tail of the batch, `hide(index)` hides one slot, and `dispose()` returns the slots. Slots are centred on their position and a batch does not Y-sort against other sprites.
  - New codes: `IGX-1114` bad capacity, `IGX-1115` index or count outside the slots, `IGX-1116` write after `dispose()`, `IGX-1117` atlas not loaded.

### Patch Changes

- Updated dependencies [be82465]
- Updated dependencies [6e1eed7]
  - @ignifx/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [388b0f6]
  - @ignifx/core@0.2.1

## 0.2.0

### Patch Changes

- c8fb925: `"sprite"` mode clears the frame to `rendering.clearColor`, and a `Camera2D`-only world stops logging `IGX-0706`
  
  A `"sprite"`-mode sprite pass opens its own swapchain pass and clears it, so nothing the render scene
  did survives underneath and the whole of the 3D clear-colour precedence
  (`docs/architecture/07-rendering.md` §2.1) never reached the screen in a 2D game. The extension
  passed a hard-coded black to `createSpriteRenderer`, so every 2D scene had a black sky and both 2D
  templates' configured `rendering.clearColor` did nothing. It now clears to the resolved setting,
  decoded from sRGB exactly as `RendererImpl.applyClearColor` decodes it — a browser test measures the
  same three bytes out of a `"sprite"` frame and a `"mixed"` frame with the same setting, so one
  setting means one colour whichever mode a game is in. Neither `Camera.clearColor` nor
  `Environment.clearColor` applies in `"sprite"` mode: there is no such component in a 2D scene, and
  `Camera2D` has no `clearColor` field of its own. Measured on 2026-09-08 (macOS arm64, SwiftShader):
  the surface is not an sRGB-encoding format, so a channel is presented at `srgbToLinear(value) * 255`
  rather than `value * 255` — `{ r: 0.6, g: 0.2, b: 0.9 }` reads back as bytes `81, 8, 201`, and a
  literal `#14181F` is almost black. The 2D skill's Gotchas now say so.
  
  The extension also registers a camera source with the rendering service, so core's `IGX-0706` ("this
  world has no enabled camera, so nothing is drawn") is no longer logged at a scene whose only camera
  is an enabled `Camera2D` — a warning on a correct scene. It still fires for a world with no camera
  of either kind, and again if the last `Camera2D` goes away.
  
  No public API change: the two additions are `@internal`.
- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0

## 0.1.0

### Minor Changes

- a0625fb: Phase 6: 2D toolkit
  
  `@ignifx/2d` ships the subsystem `docs/architecture/11-2d-toolkit.md` §1–§7 describes. Registering `twoD()` gives a game `app.twoD`, seven components plus the `Camera2DFollow` script, three asset types with their loaders and importers, the `twoD` settings section, and two systems: sprite and camera synchronisation in `PreRender` (order `-450`) and sprite animation in `PostUpdate` (order `0`).
  
  **Rendering.** A second Babylon Lite rendering context — a `SpriteRenderer` — is created on the app's surface and registered *after* the render scene, so 2D composites on top. One `Sprite2DLayer` exists per (sorting layer × atlas × blend mode × screen-space) tuple, because Lite binds a layer to one atlas and one blend mode for its life. `twoD.mode: "mixed"` passes `clear: false` so a 2.5D game keeps its 3D frame underneath; the default `"sprite"` mode owns the frame.
  
  **Coordinates.** The world stays metres with +Y up (ADR-0011); the adapter is the only place that flips into Lite's +Y-down pixel space, at `twoD.pixelsPerUnit` (default 100). A sprite's rotation is negated on the way in and a camera's view rotation is not — the two flips cancel for a view and do not for a quad.
  
  **Sorting.** `SortingLayerTable` resolves the core `sortingLayers` section into Lite draw orders. `orderInLayer` becomes a Y-sort bias on a Y-sorted layer and falls back to insertion order on one that is not, which is what §1 specifies.
  
  **Components.** `Camera2D` (orthographic half-height, pixel-perfect integer zoom against a reference resolution, travel bounds, follow fields), `SpriteRenderer` (atlas frame, tint, flip, sorting, blend, pivot override, screen-space, pickable, world AABB), `SpriteAnimator` (clips on ignifx's clock, so `timeScale`, `pause()` and frame events behave as they do for 3D), `Tilemap` and `TilemapRenderer` (chunked rendering that materialises only the chunks the camera sees, animated tiles, runtime edits, and the merged collision surface `@ignifx/physics-2d` consumes), `ParallaxLayer`, and `SpriteLayerEffect` (a per-layer WGSL fragment shader with an `fx.params` vec4, plus a built-in `tint`).
  
  **Assets.** `ignifx.spriteatlas` (`.atlas.json`), `ignifx.spriteanimation` (`.spriteanim.json`) and `ignifx.tilemap` (`.tilemap.json`), each with a loader that tolerates the null engine. `"sprites/hero.atlas.json#frame:idle_0"` addresses one frame of a shared atlas. Importers for TexturePacker, Aseprite (atlas and tags), a uniform grid, Tiled `.tmj` and LDtk `.ldtk` are pure functions a build step or a test can call with no app.
  
  **Picking.** `app.twoD.pickAt(x, y)` resolves a viewport pixel to the `SpriteRenderer` that drew it, on the CPU with no readback and no frame of latency.
  
  New diagnostic codes: `IGX-1102` an atlas frame with no 1-px extruded border (logged, not thrown), `IGX-1103`/`IGX-1104`/`IGX-1105` an unreadable atlas, animation or tilemap document, `IGX-1106` an unknown frame, `IGX-1107` an undeclared sorting layer, `IGX-1108` an unknown clip, `IGX-1109` an unsupported import, `IGX-1110` a duplicate tile-object factory, `IGX-1111` a cell outside its layer, `IGX-1112` a second `twoD()` on one app, `IGX-1113` a custom `SpriteLayerEffect` with no WGSL body. `IGX-1101` is left to `@ignifx/physics-2d`.

### Patch Changes

- d349254: Sprite animation freezes while the app is paused
  
  `app.pause()` now stops `SpriteAnimator` clips and animated tiles. Systems keep running while the app is paused and their `dt` is not zeroed — only scripts are filtered by `updateWhenPaused` — so the 2D animation system checks `time.paused` itself. The existing test missed this because its pause lasted a whole number of clip periods.
- 7ca9efe: A sprite clip's `from`/`to` is documented as the atlas **index** range it is
  
  `from`/`to` resolves both endpoints to atlas indices and plays every index between them, so a range
  whose endpoints are not adjacent in the sheet plays whatever the packer put in between — and `to`
  before `from` plays the range backwards. The TSDoc, the `ignifx.spriteanimation` schema descriptions
  (and therefore the generated format page), and the 2D skill now say so, and point at the explicit
  `frames` list for a run that is not contiguous. The generated page also lists the per-clip and
  per-frame fields, which it previously showed only as `array`. No behaviour changed; a unit test now
  pins the resolution rules.
- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0
