# @ignifx/2d

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
