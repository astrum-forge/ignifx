# 11 · 2D Toolkit

**Status:** Design standard (pre-1.0) · **Packages:** `@ignifx/2d`, `@ignifx/physics-2d` · **Related:** `07-rendering.md`, `09-physics.md` §10, ADR-0006 · **Inspiration:** Unity 2D (sorting layers, PPU, Pixel Perfect Camera), Godot 2D (Y-sort, TileMapLayer, Camera2D limits)

2D is first-class (`CONSTITUTION.md` §3.10). It uses the same entities, transforms, scripts, assets, and phases as 3D; only rendering, camera, and physics differ. Lite API names verified against `@babylonjs/lite@1.27.0`.

---

## 1. Rendering path

Babylon Lite provides a dedicated 2D pipeline: `SpriteRenderer` (a rendering context registered on the surface) draws ordered `Sprite2DLayer`s, each backed by one `SpriteAtlas`, in **pixel space with +Y down**, with a per-layer `Sprite2DView` camera (`positionPx`, `zoom`, `rotation`), blend modes, per-sprite frame/color/flip/rotation/size, Y-sort (`enableSprite2DYSort`), custom fragment shaders, and CPU picking (`pickSprite2D`). Depth-hosted layers (`addDepthHostedSpriteLayer`) let sprites depth-test against 3D meshes in the render scene.

ignifx maps its 2D world (metres, **+Y up**, Z ignored for drawing) onto this:

- **Pixels per unit (PPU)**, default 100 (`ignifx.config.ts` → `twoD.pixelsPerUnit`). World `(x, y)` → layer pixels `(x·PPU, −y·PPU)`; sprite size in pixels = frame size × `entity.lossyScale` (a 32-px sprite at PPU 100 is 0.32 units wide).
- **Sorting layers** (`ignifx.config.ts` → `sortingLayers`, ordered) → one Lite `Sprite2DLayer` per (sorting layer × atlas × blend mode), with `order` derived from the sorting layer index. **Order in layer** is applied as a Y-sort bias (`setSprite2DYSortBias`) when Y-sort is on, or as sub-ordering by insertion when off. **Y-sort** is a per-sorting-layer setting (`ySort: true` for top-down games).
- **Camera2D** drives every world layer's `Sprite2DView` (same pan/zoom/rotation), so all layers move together; UI/HUD layers keep an identity view.
- Lite draws rendering contexts in registration order; the 2D extension registers its `SpriteRenderer` (and `@ignifx/ui` its `TextRenderer`) after the render scene so 2D layers composite on top, with `clear: false` in `"mixed"` mode.
- Depth-hosted mode (`twoD.mode: "mixed"`) is for 2.5D games that mix sprites and meshes; pure 2D games (`"sprite"`, the default) skip the 3D scene pass entirely, which is cheaper.

## 2. Components

### 2.1 `Camera2D`

| Field | Default | Notes |
|---|---|---|
| `orthographicSize` (half-height, units) | 5 | zoom = viewportHeightPx / (2·size·PPU) |
| `pixelPerfect` | false | snaps zoom to integers and camera position to whole pixels; sets `SpriteSampling: "nearest"` per atlas |
| `referenceResolution` `[w, h]` | `[640, 360]` | with `pixelPerfect`, chooses the integer zoom that fits |
| `bounds` `{ min, max }` \| null | null | camera limits (Godot `limit_*`) |
| `follow` (entity ref), `followDamping`, `followOffset`, `deadZone` | — | smooth follow with dead zone (a built-in script, `Camera2DFollow`, is the reference implementation) |
| `clearColor` | scene settings | `SpriteRendererOptions.clearValue` |
| `priority` | 0 | highest enabled wins |

`screenToWorld(x, y)` / `worldToScreen(point)` use `sprite2DScreenToWorldToRef`/`sprite2DWorldToScreenToRef` plus the PPU conversion. `Camera2D` also configures the surface `maxDevicePixelRatio` for pixel-art (integer DPR).

### 2.2 `SpriteRenderer`

```ts
class SpriteRenderer extends Component.define({
  sprite: asset(SpriteAsset),             // "sprites/hero.atlas.json#frame:idle_0" or an image address (single-frame atlas)
  color: color("#ffffffff"),
  flipX: bool(false), flipY: bool(false),
  sortingLayer: str("Default"), orderInLayer: i32(0),
  blend: enumOf(["alpha", "premultiplied", "additive", "multiply", "opaque"] as const, "alpha"),
  pivotOverride: optional(vec2()),         // defaults to the frame's pivot
}) {}
```

- One Lite sprite handle (`addSprite2D`) in the layer matching (sortingLayer, atlas, blend). The 2D sync system (`PreRender`, order −400) writes `positionPx`, `rotation` (from `rotation2D`), `sizePx` (from scale), `frame`, `color`, `flipX/Y`, `visible` for sprites whose `worldMatrixVersion` or fields changed since the last frame. Static entities (`entity.isStatic`) are synced once.
- Changing `sortingLayer`/`blend`/atlas moves the sprite to another layer (remove + add; the handle is replaced).

### 2.3 Sprite assets and atlases

- `.atlas.json` (`ignifx.spriteatlas`): image address, sampling, premultiplied flag, and frames `{ name, x, y, w, h, pivot, sourceSize? }` in pixels (top-left origin). Importers convert **TexturePacker JSON (hash/array)**, **Aseprite JSON**, and **grid** definitions into this format (`ignifx import atlas`). At load the loader builds Lite's `SpriteAtlas` data directly (`{ texture, textureSizePx, frames: [{ uvMin, uvMax, sourceSizePx, pivot, name }] }`) from the image (`loadTexture2D` with `invertY: false`), or with `createGridSpriteAtlas` for grid atlases.
- A bare image address used as a sprite becomes a one-frame atlas (pivot 0.5, 0.5).
- Runtime packing (`createSpriteAtlasFromFrames`, `appendSpriteAtlasFrames`) is exposed as `SpriteAtlas.pack(frames)` for procedural content.

### 2.4 `SpriteAnimator`

- `.spriteanim.json` (`ignifx.spriteanimation`): clips `{ name, frames: ["idle_0", …] | range, fps, loop, events: [{ frame, name }] }`. Aseprite tags import directly.
- Component fields: `animations: asset(SpriteAnimationAsset)`, `defaultClip`, `playOnAwake`, `speed`. Methods: `play(clip, { restart })`, `stop()`, `pause()`, `frame`, `isPlaying`, `onClipEnded: Signal<string>`, `onEvent: Signal<string>`.
- Implemented on ignifx's animation clock (advanced in `PostUpdate`), writing `setSprite2DFrame`, rather than Lite's `SpriteAnimationManager`, so that `timeScale`, pause, and frame events work uniformly with 3D animation.

### 2.5 `Tilemap`, `TilemapRenderer`, `TilemapCollider2D`

- `.tilemap.json` (`ignifx.tilemap`): tile size, layers (`{ name, sortingLayer, orderInLayer, tiles: RLE or dense array of tile ids, opacity, parallax?, collision? }`), tilesets (`{ atlas, firstId, tiles: [{ id, frame, collider?: polygon|box|none, properties }] }`), objects layer (`{ name, type, x, y, w, h, properties }` → entities spawned via a registered `TileObjectFactory`). Importers for **Tiled** (`.tmj`, orthogonal; isometric post-MVP) and **LDtk** (`.ldtk`).
- `TilemapRenderer` draws tiles as sprites in chunked Lite layers (`chunkSize` 32×32 tiles), creating sprites only for chunks intersecting the camera bounds (`getSprite2DVisibleBoundsToRef`) and marking chunks static. Animated tiles use the animation clock.
- `TilemapCollider2D` merges tile collision shapes per chunk into polygons for `@ignifx/physics-2d`; one-way platforms and slopes are properties on tiles.
- `Tilemap` exposes `getTile(layer, x, y)`, `setTile(...)`, `worldToCell`, `cellToWorld`, and `onTileChanged` for runtime edits.

### 2.6 `ParallaxLayer`

Per-layer view multiplier: the 2D sync system offsets the layer's `Sprite2DView.positionPx` by `camera.positionPx × (1 − factor)`; `repeatX/Y` tiles the sprite across the camera bounds.

### 2.7 Text in 2D

`@ignifx/ui` provides `HudText` (Lite `TextLayer` on a `TextRenderer`, pixel-space HUD) and `WorldText2D` (a text layer following a world position through the `Camera2D` view); fonts load with `loadFont`. See `13-ui.md`.

## 3. Coordinate rules

- World +Y up, +X right; `rotation2D` is degrees counter-clockwise about +Z; the adapter negates Y and rotation for Lite. `Transform.position2D`/`rotation2D`/`localScale2D` are the ergonomic accessors.
- Z is never used for drawing order in `"sprite"` mode (sorting layers and order in layer are). In `"mixed"` mode, depth-hosted sprites take `z` from the entity's world Z via `Sprite2DProps.z` (NDC depth computed from the 3D camera).

## 4. Pixel-perfect rendering

With `Camera2D.pixelPerfect`: integer zoom, positions snapped to the pixel grid at sync time (scripts keep sub-pixel positions), `nearest` sampling on all world atlases, `maxDevicePixelRatio` set to 1 or to an integer that keeps the reference resolution, and padding/extrusion validated at atlas import (importers warn when frames lack a 1-px extruded border).

## 5. Picking and input

`app.twoD.pickAt(x, y)` → `pickSprite2D(layers, xPx, yPx)` resolved to entities; `SpriteRenderer.bounds` (world AABB) for coarse queries; pointer actions from `@ignifx/input` are converted with `Camera2D.screenToWorld`.

## 6. Lighting and effects

Lite's 2D path has no lighting model. MVP: per-layer custom shaders (`createSprite2DCustomShader`) exposed as `SpriteLayerEffect` for tints, dissolve, water and similar; 2D normal-mapped lighting is post-1.0. Particles: `ParticleEmitter2D` bridges Lite's node-particle → Sprite2D bridge (`createParticleSprite2DBridge`) in Phase 6b.

## 7. Scene settings for 2D

`settings.twoD: { mode: "sprite" | "mixed", pixelsPerUnit, ySort: { "Default": true } }` inside the scene file, validated by the extension. Templates `2d-topdown` and `2d-sidescroller` set these.

## 8. 2D physics (`@ignifx/physics-2d`, ADR-0006)

- Backend: Rapier 2D (`@dimforge/rapier2d-compat`, Apache-2.0, WASM, deterministic across platforms, ships a kinematic character controller with slopes, autostep and snap-to-ground). The extension follows the stepping model in `09-physics.md` §1 (fixed step from the ignifx loop; Rapier is stepped directly, no Lite involvement) and the same interpolation scheme.
- Components: `Rigidbody2D { bodyType, mass, gravityScale, linearDamping, angularDamping, freezeRotation, interpolation, collisionEvents }`, `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, `CharacterController2D { move(delta), isGrounded, slopeLimit, stepOffset, snapToGround, onOneWayPlatforms, interpolation }`, `PhysicsMaterial2D`.
- Queries: `app.physics2d.raycast`, `raycastAll`, `overlapCircle/Box`, `shapeCast`. Events: `onCollisionEnter2D/Stay/Exit`, `onTriggerEnter2D/Exit` (Rapier reports both colliders, so no upstream gap here).
- Units: metres and seconds; PPU affects only rendering.
- A world uses either `physics()` or `physics2d()`; registering both throws `IGX-1101` in the MVP.

## 9. Templates

- **2d-topdown:** Y-sorted `Default` layer, `Camera2D` with dead-zone follow, `CharacterController2D`, Tiled map with collision layer, `SpriteAnimator` 8-direction clips.
- **2d-sidescroller:** pixel-perfect camera with bounds, one-way platforms, parallax background, coyote-time jump in the reference controller script.
