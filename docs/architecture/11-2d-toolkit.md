# 11 · 2D Toolkit

**Status:** Design standard (pre-1.0) · **Packages:** `@ignifx/2d`, `@ignifx/physics-2d` · **Related:** `07-rendering.md`, `09-physics.md` §10, ADR-0006 · **Inspiration:** Unity 2D (sorting layers, PPU, Pixel Perfect Camera), Godot 2D (Y-sort, TileMapLayer, Camera2D limits)

2D is first-class (`CONSTITUTION.md` §3.10). It uses the same entities, transforms, scripts, assets, and phases as 3D; only rendering, camera, and physics differ. Lite API names verified against `@babylonjs/lite@1.27.0`.

---

## 1. Rendering path

Babylon Lite provides a dedicated 2D pipeline: `SpriteRenderer` (a rendering context registered on the surface) draws ordered `Sprite2DLayer`s, each backed by one `SpriteAtlas`, in **pixel space with +Y down**, with a per-layer `Sprite2DView` camera (`positionPx`, `zoom`, `rotation`), blend modes, per-sprite frame/color/flip/rotation/size, Y-sort (`enableSprite2DYSort`), custom fragment shaders, and CPU picking (`pickSprite2D`). Depth-hosted layers (`addDepthHostedSpriteLayer`) let sprites depth-test against 3D meshes in the render scene.

ignifx maps its 2D world (metres, **+Y up**, Z ignored for drawing) onto this. One Lite constraint shapes the whole mapping: a `Sprite2DLayer` has **one pivot for the entire layer**, read from its uniform block, and the per-frame `SpriteFrame.pivot` is consumed only by Lite's _billboard_ family, never by the 2D pipeline (verified in `@babylonjs/lite@1.27.0`, `lib/sprite/sprite-pipeline.js` lines 25 and 264–265 against `lib/sprite/billboard-sprite.js` lines 166–167). ignifx therefore pins every layer to the centre pivot and offsets each sprite's `positionPx` instead, which is what makes a per-frame pivot and `SpriteRenderer.pivotOverride` work at all.

- **Pixels per unit (PPU)**, default 100 (`ignifx.config.ts` → `twoD.pixelsPerUnit`). World `(x, y)` → layer pixels `(x·PPU, −y·PPU)`; sprite size in pixels = frame size × `entity.lossyScale` (a 32-px sprite at PPU 100 is 0.32 units wide).
- **Sorting layers** (`ignifx.config.ts` → `sortingLayers`, ordered) → one Lite `Sprite2DLayer` per (sorting layer × atlas × blend mode × screen-space), with `order` derived from the sorting layer index. Screen-space is part of the key because a HUD layer keeps the identity view while a world layer takes the camera's, and a `Sprite2DView` belongs to a layer. **Order in layer** is applied as a Y-sort bias (`setSprite2DYSortHandleBias`) when Y-sort is on, or as sub-ordering by insertion when off — Lite's bias setter throws on a layer with no Y-sort state, so it is only written to a layer that is sorting. **Y-sort** is a per-sorting-layer setting (`ySort: true` for top-down games).
- **Camera2D** drives every world layer's `Sprite2DView` (same pan/zoom/rotation), so all layers move together; UI/HUD layers keep an identity view.
- Lite draws rendering contexts in registration order; the 2D extension registers its `SpriteRenderer` (and `@ignifx/ui` its `TextRenderer`) after the render scene so 2D layers composite on top, with `clear: false` in `"mixed"` mode.
- Depth-hosted mode (`twoD.mode: "mixed"`) is for 2.5D games that mix sprites and meshes; pure 2D games (`"sprite"`, the default) skip the 3D scene pass entirely, which is cheaper.

## 2. Components

### 2.1 `Camera2D`

| Field                                                              | Default        | Notes                                                                                                  |
| ------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `orthographicSize` (half-height, units)                            | 5              | zoom = viewportHeightPx / (2·size·PPU)                                                                 |
| `pixelPerfect`                                                     | false          | snaps zoom to integers and camera position to whole pixels; sets `SpriteSampling: "nearest"` per atlas |
| `referenceResolution` `[w, h]`                                     | `[640, 360]`   | with `pixelPerfect`, chooses the integer zoom that fits                                                |
| `bounds` `{ min, max }` \| null                                    | null           | camera limits (Godot `limit_*`)                                                                        |
| `follow` (entity ref), `followDamping`, `followOffset`, `deadZone` | —              | smooth follow with dead zone (a built-in script, `Camera2DFollow`, is the reference implementation)    |
| `clearColor`                                                       | scene settings | `SpriteRendererOptions.clearValue`                                                                     |
| `priority`                                                         | 0              | highest enabled wins                                                                                   |

`screenToWorld(x, y)` / `worldToScreen(point)` use `sprite2DScreenToWorldToRef`/`sprite2DWorldToScreenToRef` plus the PPU conversion. `Camera2D` also configures the surface `maxDevicePixelRatio` for pixel-art (integer DPR).

### 2.2 `SpriteRenderer`

```ts
class SpriteRenderer extends Component.define({
  sprite: asset(SpriteAsset), // "sprites/hero.atlas.json#frame:idle_0" or an image address (single-frame atlas)
  color: color("#ffffffff"),
  flipX: bool(false),
  flipY: bool(false),
  sortingLayer: str("Default"),
  orderInLayer: i32(0),
  blend: enumOf(["alpha", "premultiplied", "additive", "multiply", "opaque"] as const, "alpha"),
  pivotOverride: optional(vec2()), // defaults to the frame's pivot
}) {}
```

- One Lite sprite handle (`addSprite2D`) in the layer matching (sortingLayer, atlas, blend, screenSpace). The 2D sync system (`PreRender`, order **−450** — `@ignifx/audio`'s spatial pump already holds −400, and equal orders are broken by extension-registration order, which would make the frame order depend on a game's argument list) writes `positionPx`, `rotation` (from `rotation2D`), `sizePx` (from scale), `frame`, `color`, `flipX/Y`, `visible` for sprites whose `worldMatrixVersion`, fields, or effective enabled state changed since the last frame. Static entities (`entity.isStatic`) are synced once.
- Changing `sortingLayer`/`blend`/atlas moves the sprite to another layer (remove + add; the handle is replaced).

### 2.3 Sprite assets and atlases

- `.atlas.json` (`ignifx.spriteatlas`): a `format`/`formatVersion` header like every other ignifx document, then image address (an address resolved **relative to the atlas document's address** and then through the asset manifest, so hashed builds work; a root-relative `/sheet.png` or absolute URL is fetched verbatim, as every packer emits it), sampling, premultiplied flag, and frames `{ name, x, y, w, h, pivot, sourceSize? }` in pixels (top-left origin). A pivot may be written `[x, y]` or `{ x, y }`. Importers convert **TexturePacker JSON (hash/array)**, **Aseprite JSON**, and **grid** definitions into this format (`ignifx import atlas`). At load the loader builds Lite's `SpriteAtlas` data directly (`{ texture, textureSizePx, frames: [{ uvMin, uvMax, sourceSizePx, pivot, name }] }`) from the image. The texture is uploaded with `loadTexture2D` and `invertY: false` — Lite's `Texture2DOptions.invertY` defaults to **`true`** (`index.d.ts` 12923), so it has to be turned off or every frame is upside down — plus `mipMaps: false` and `clamp-to-edge` addressing, the same set Lite's own `loadSpriteAtlas` chooses. Note that `LoadAtlasOptions` carries no `invertY` of its own: it nests a `textureOptions` block instead. `createGridSpriteAtlas` builds grid atlases, and its frames carry no names.
- A bare image address used as a sprite becomes a one-frame atlas (pivot 0.5, 0.5).
- Runtime packing (`createSpriteAtlasFromFrames`, `appendSpriteAtlasFrames`) is exposed for procedural content.
- Atlases are **not** released with `disposeSpriteAtlas`: it calls `atlas.texture.texture.destroy()` unconditionally, is documented as not idempotent, and says an atlas over an externally-owned texture should be freed by whoever owns that texture. ignifx's asset layer owns it, so the loader releases the texture through Lite's reference-counted pool with `releaseTexture` — the same call `TextureAsset` makes.

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

With `Camera2D.pixelPerfect`: the zoom is a whole-number scaling of `referenceResolution` (so `orthographicSize` is ignored while the flag is on, exactly as Unity's Pixel Perfect Camera behaves), and the camera's position is snapped to the pixel grid at sync time while scripts keep their sub-pixel positions.

The flag **cannot** change an atlas's sampling. A `Texture2D`'s sampler is fixed when the image is uploaded, so `nearest` is a property of the `.atlas.json` document (`"sampling": "nearest"`), not something a camera can retarget after the fact; a pixel-art project sets it in the atlas. Padding and extrusion are checked at load rather than at import: the loader can only see frame rectangles, so it warns (`IGX-1102`, logged) when a frame is packed flush against a neighbour or the image edge, which is the case that actually bleeds under `nearest` sampling.

## 5. Picking and input

`app.twoD.pickAt(x, y)` → `pickSprite2D` resolved to entities; `SpriteRenderer.bounds` (world AABB) for coarse queries; pointer actions from `@ignifx/input` are converted with `Camera2D.screenToWorld`.

Two details of Lite's picker are load-bearing and are not in its declaration. It compares the point against each sprite's stored `positionPx` and **never applies the layer's view** (`lib/sprite/picking/pick-sprite-2d.js` lines 26–27), so a viewport pixel has to be unprojected with `sprite2DScreenToWorldToRef` _per layer_ — a world layer and a screen-space layer do not share a view. And a hit reports a dense `spriteIndex`, while removal is a swap of the last sprite into the freed slot, so the index-to-component map has to apply the same swap rule. A tilemap's tiles carry no component and are therefore not pickable; `Tilemap.worldToCell` answers exactly and for free.

## 6. Lighting and effects

Lite's 2D path has no lighting model. MVP: per-layer custom shaders (`createSprite2DCustomShader`) exposed as `SpriteLayerEffect` for tints, dissolve, water and similar; 2D normal-mapped lighting is post-1.0. Particles: `ParticleEmitter2D` bridges Lite's node-particle → Sprite2D bridge (`createParticleSprite2DBridge`) in Phase 6b.

## 7. Scene settings for 2D

`settings.twoD: { mode: "sprite" | "mixed", pixelsPerUnit, ySort: { "Default": true } }` inside the scene file, validated by the extension. Templates `2d-topdown` and `2d-sidescroller` set these.

`@ignifx/core` carries a scene's `settings` block through to `SceneInstance.settings` as raw JSON and fires `world.onSceneLoaded` once it is populated, but there is no _validated_ per-scene settings mechanism — no schema hook and no `IGX-0408` path. The extension therefore decodes its own block against the same schema `registerSettings` uses, overrides only the keys the block actually wrote (`decodeProps` fills absent fields with schema defaults, which would otherwise silently reset the project's values), and reports an invalid block to `app.onError` rather than failing the scene load. The hook is installed from `System.onWorldCreated`, not from the extension's `onStart`, because `onStart` runs only when a game calls `app.start()` and a headless tool may load a scene without ever starting a loop.

## 8. 2D physics (`@ignifx/physics-2d`, ADR-0006)

- Backend: Rapier 2D (`@dimforge/rapier2d-compat`, Apache-2.0, WASM, ships a kinematic character controller with slopes, autostep and snap-to-ground). The extension follows the stepping model in `09-physics.md` §1 (fixed step from the ignifx loop; Rapier is stepped directly, no Lite involvement) and the same interpolation scheme. **Determinism is same-machine only.** Phase 6's spike S6.2 corrected the "deterministic across platforms" claim this line used to make: `@dimforge/rapier2d-compat` is Rapier's _main_ build, whose README says it "does **not** guarantee cross-platform determinism of the physics simulation (but it is still locally deterministic, on the same machine)"; `@dimforge/rapier2d-deterministic-compat` is the build that does (ADR-0006 Validation).
- Components: `Rigidbody2D { bodyType, mass, gravityScale, linearDamping, angularDamping, freezeRotation, interpolation, collisionEvents }`, `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, `CharacterController2D { shape, move(delta), isGrounded, slopeLimit, stepOffset, snapToGround, onOneWayPlatforms, interpolation }`. There is no separate `PhysicsMaterial2D` **document**: 2D physics reads the same `ignifx.physicsmaterial` file 3D physics defines (`09-physics.md` §2.4), ignoring `staticFriction` because Rapier has one friction coefficient, and the friction/restitution _combine rules_ are collider fields rather than asset fields. `PhysicsMaterial2D` is the loaded class.
- `CharacterController2D.shape` (`"capsule" | "box"`, default `"capsule"`) is an addition to the list above. Measured against `@dimforge/rapier2d-compat@0.20.0`, autostep clears a 0.3 m step with a box character and refuses a 0.5 m one, but with a capsule of radius 0.2 it clears about 0.15 m and no more — so `stepOffset` is only usable with a box.
- Queries: `app.physics2d.raycast`, `raycastAll`, `overlapCircle/Box`, `shapeCast`. All are shape-accurate and report the collider that was hit; none of the bounds-index approximations `09-physics.md` §5 records for Havok apply here.
- Events: the callbacks are the **3D names** — `onCollisionEnter`, `onCollisionStay`, `onCollisionExit`, `onTriggerEnter`, `onTriggerExit` — carrying `Collision2D` and `TriggerEvent2D` payloads. They are _not_ suffixed `2D` as this section used to say: the kernel's `PhysicsCallbackName` union has exactly five members and no `2D` variants (`packages/core/src/lifecycle/callbacks.ts`), and a world runs one physics extension, so no name can be ambiguous. Rapier reports both colliders, so both identities are always present and there is no upstream gap.
- Layers: the project collision matrix maps onto Rapier's `InteractionGroups`, which packs membership and filter into **16 bits each** (`geometry/interaction_groups.d.ts`). Only the project's first sixteen layers can be filtered by; a collider on layer 16 or above reports `IGX-1152` and falls back to layer 0.
- Diagnostic codes: `@ignifx/2d` owns `IGX-1101`–`IGX-1149` and `@ignifx/physics-2d` owns `IGX-1150` upwards — except `IGX-1101` itself, which only the physics extension can detect and therefore registers. An app's error-code registry refuses a duplicate registration, so `@ignifx/2d` must not declare it.
- Units: metres and seconds; PPU affects only rendering.
- A world uses either `physics()` or `physics2d()`; registering both throws `IGX-1101` in the MVP.

## 9. Templates

- **2d-topdown:** Y-sorted `Default` layer, `Camera2D` with dead-zone follow, `CharacterController2D`, Tiled map with collision layer, `SpriteAnimator` 8-direction clips.
- **2d-sidescroller:** pixel-perfect camera with bounds, one-way platforms, parallax background, coyote-time jump in the reference controller script.
