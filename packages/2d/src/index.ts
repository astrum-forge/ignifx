/**
 * `@ignifx/2d` public barrel: `Camera2D`, `SpriteRenderer`, `SpriteAnimator`, atlases, `Tilemap`,
 * sorting layers, pixel-perfect rendering, parallax, and 2D picking
 * (`docs/architecture/11-2d-toolkit.md`). Explicit named re-exports only — no `export *`
 * (coding standards §4).
 *
 * @packageDocumentation
 */

// Type-only side effect: the module declares `app.twoD` on `@ignifx/core`'s `App`, and naming it
// here is what keeps the augmentation in the bundled declarations. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// animation — the `.spriteanim.json` document, its loader, and the component that plays it.
export { TWO_D_ANIMATION_ORDER, TwoDAnimationSystem } from "./animation/animation-system.js";
export {
  DEFAULT_CLIP_FPS,
  defineSpriteAnimation,
  resolveClipFrames,
  SPRITE_ANIMATION_ASSET_TYPE,
  SPRITE_ANIMATION_FILE_EXTENSIONS,
  SPRITE_ANIMATION_FORMAT,
  SPRITE_ANIMATION_FORMAT_VERSION,
  type SpriteAnimationDefinition,
  type SpriteAnimationEvent,
  type SpriteAnimationInput,
  type SpriteClipDefinition,
} from "./animation/definition.js";
export { importAsepriteAnimations, type AsepriteAnimationImportOptions } from "./animation/importers.js";
export { createSpriteAnimationLoader } from "./animation/loader.js";
export { SpriteAnimationAsset, type SpriteClip } from "./animation/sprite-animation-asset.js";
export { SpriteAnimator, type PlayClipOptions } from "./animation/sprite-animator.js";

// assets — the document-relative reference arithmetic every 2D format uses.
export { normalisePath, resolveRelative } from "./assets/relative.js";

// atlas — the `.atlas.json` document, its importers, its loader, and the sprite it addresses.
export {
  defineSpriteAtlas,
  parseSpriteFragment,
  readVec2,
  SPRITE_ATLAS_ASSET_TYPE,
  SPRITE_ATLAS_FILE_EXTENSIONS,
  SPRITE_ATLAS_FORMAT,
  SPRITE_ATLAS_FORMAT_VERSION,
  SPRITE_FRAME_FRAGMENT_PREFIX,
  type SpriteAtlasDefinition,
  type SpriteAtlasInput,
  type SpriteFrameDefinition,
  type Vec2Json,
} from "./atlas/definition.js";
export {
  asepriteFrameName,
  gridAtlas,
  importAsepriteAtlas,
  importTexturePackerAtlas,
  type AsepriteImportOptions,
  type GridAtlasImportOptions,
  type TexturePackerImportOptions,
} from "./atlas/importers.js";
export { createSpriteAtlasLoader } from "./atlas/loader.js";
export {
  SpriteAtlasAsset,
  type SpriteAsset,
  type SpriteAtlasAssetLiteHandles,
  type SpriteFrameInfo,
} from "./atlas/sprite-atlas-asset.js";

// camera — the 2D camera and the reference follow script.
export { Camera2DFollow } from "./camera/camera-2d-follow.js";
export { Camera2D, DEFAULT_ORTHOGRAPHIC_SIZE, DEFAULT_REFERENCE_RESOLUTION } from "./camera/camera-2d.js";

// errors — the `IGX-11##` codes this package owns.
export { TWO_D_ERROR_MESSAGES, twoDError, TwoDErrorCode, type TwoDErrorOptions } from "./errors.js";

// extension — the factory a game registers.
export { twoD, type TwoDOptions } from "./extension.js";

// file-schemas — the declarative descriptions of the three file formats.
export { spriteAnimationFileSchema, spriteAtlasFileSchema, tilemapFileSchema } from "./file-schemas.js";

// lite — the unstable escape-hatch types the `.lite` accessors name.
export { SPRITE_BLEND_MODES, type SpriteBlendName } from "./lite/sprite-layer.js";
export type {
  LiteAtlasTexture,
  LiteBounds2D,
  LiteSprite2DHandle,
  LiteSprite2DLayer,
  LiteSprite2DView,
  LiteSpriteAtlas,
  LiteSpriteBlendMode,
  LiteSpriteFrame,
  LiteSpritePickInfo,
  LiteSpriteRenderer,
  LiteSpriteSampling,
} from "./lite/types.js";

// math — the world-to-pixel conversion every other module goes through.
export {
  DEFAULT_PIXELS_PER_UNIT,
  pivotedPositionToRef,
  pixelsToWorldToRef,
  sizeForZoom,
  snapPixel,
  snapZoomToInteger,
  spriteRotationFromLite,
  spriteRotationToLite,
  viewRotationToLite,
  worldToPixelsToRef,
  zoomForSize,
} from "./math/coords.js";

// schemas — what `pnpm docs:schemas` reads.
export {
  describeSchemas,
  describeSpriteAnimationFormat,
  describeSpriteAtlasFormat,
  describeTilemapFormat,
  describeTwoDSchemas,
  spriteAnimationJsonSchema,
  spriteAtlasJsonSchema,
  tilemapJsonSchema,
} from "./schemas.js";

// service — `app.twoD`, the layer pool, the sorting-layer table, and the sync system.
export { spriteLayerKey, SpriteLayerRegistry, type SpriteLayerEntry } from "./service/layer-registry.js";
export { DEFAULT_SORTING_LAYER, SORTING_LAYER_ORDER_STEP, SortingLayerTable } from "./service/sorting-layers.js";
export { selectCamera, TWO_D_SYNC_ORDER, TwoDSyncSystem } from "./service/sync-system.js";
export {
  TwoDService,
  type TileObjectContext,
  type TileObjectFactory,
  type TwoDPick,
  type WorldBox,
} from "./service/two-d-service.js";
export type { TwoDLiteHandles } from "./service/runtime.js";

// settings — the `twoD` project section, which a scene file's `settings.twoD` overrides.
export {
  defaultTwoDSettings,
  TWO_D_MODES,
  TWO_D_SETTINGS_SECTION,
  twoDSettingsSchema,
  type TwoDMode,
  type TwoDSettings,
} from "./settings.js";

// sprite — the components that put a sprite on the screen.
export { ParallaxLayer } from "./sprite/parallax-layer.js";
export {
  SPRITE_EFFECT_KINDS,
  SpriteLayerEffect,
  TINT_EFFECT_WGSL,
  type SpriteEffectKind,
} from "./sprite/sprite-layer-effect.js";
export { SpriteRenderer, type SpriteLayerKey } from "./sprite/sprite-renderer.js";

// tilemap — the `.tilemap.json` document, its importers, the grid, and the collision contract.
export type { AnimatedTilemapSink } from "./tilemap/animated-tiles.js";
export type {
  TileCollisionInfo,
  TileCollisionShape,
  TilemapCollisionChunk,
  TilemapCollisionData,
} from "./tilemap/collision-data.js";
export { isFullCellSolid, mergeTileCollisions, type CollisionMergeOptions } from "./tilemap/collision-merge.js";
export {
  decodeTileRle,
  defineTilemap,
  EMPTY_TILE_ID,
  encodeTileRle,
  findTileset,
  tileCollisionInfo,
  tileFrameName,
  TILEMAP_ASSET_TYPE,
  TILEMAP_FILE_EXTENSIONS,
  TILEMAP_FORMAT,
  TILEMAP_FORMAT_VERSION,
  type TileAnimationFrame,
  type TileColliderDefinition,
  type TileDefinition,
  type TilemapDefinition,
  type TilemapInput,
  type TilemapLayerDefinition,
  type TilemapLayerInput,
  type TilemapObjectDefinition,
  type TileRleData,
  type TilesetDefinition,
} from "./tilemap/definition.js";
export {
  fieldInstancesToRecord,
  importLdtkLevel,
  LDTK_DEFAULT_INTGRID_COLLIDERS,
  LDTK_INTGRID_TILESET_NAME,
  type LdtkImportOptions,
} from "./tilemap/importers/ldtk.js";
export { importTiledMap, tiledPropertiesToRecord, type TiledImportOptions } from "./tilemap/importers/tiled.js";
export { spawnTilemapObjects } from "./tilemap/spawn-objects.js";
export { createTilemapLoader, TilemapAsset } from "./tilemap/tilemap-asset.js";
export { TilemapRenderer } from "./tilemap/tilemap-renderer.js";
export { DEFAULT_CHUNK_SIZE, Tilemap, type TileChange } from "./tilemap/tilemap.js";

// version — the package's own release line.
export { VERSION } from "./version.js";
