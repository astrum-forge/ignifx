import type {
  Bounds2D,
  Sprite2DCustomShader,
  Sprite2DHandle,
  Sprite2DLayer,
  Sprite2DView,
  SpriteAtlas,
  SpriteBlendMode,
  SpriteFrame,
  SpritePickInfo,
  SpriteRenderer as LiteSpriteRendererContext,
  SpriteSampling,
  Texture2D,
} from "@babylonjs/lite";

/**
 * The Babylon Lite 2D handle types, re-exported under ignifx names so feature code outside
 * `src/lite/**` can name them without importing `@babylonjs/lite`
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * Every alias here is unstable and excluded from the stability guarantees of
 * `CONSTITUTION.md` Article IV; they exist for the `.lite` escape hatches only.
 */

/**
 * Lite's sprite rendering context — the second rendering context `@ignifx/2d` registers on the
 * app's surface, after the render scene, so 2D composites on top (`index.d.ts` 12215).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteRenderer = LiteSpriteRendererContext;

/**
 * One ordered batch of sprites drawn from a single atlas with a single blend mode
 * (`index.d.ts` 11885).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSprite2DLayer = Sprite2DLayer;

/**
 * A stable identity for one sprite that survives Lite's swap-remove reindexing
 * (`index.d.ts` 11880).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSprite2DHandle = Sprite2DHandle;

/**
 * A layer's 2D camera: pan, zoom, and rotation in Lite's pixel space (`index.d.ts` 11988).
 *
 * @remarks
 * `positionPx` is the layer-pixel point that lands at the **top-left** of the viewport, not the
 * centre — verified against `sprite2DWorldToScreenToRef` in `lib/sprite/sprite-2d-view.js`.
 *
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSprite2DView = Sprite2DView;

/**
 * A loaded atlas: one texture plus the frame rectangles inside it (`index.d.ts` 12041).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteAtlas = SpriteAtlas;

/**
 * One frame of an atlas: UVs in `[0, 1]`, source size in pixels, and a pivot (`index.d.ts` 12156).
 *
 * @remarks
 * The `pivot` field is **stored but not applied** by the `Sprite2DLayer` pipeline; only Lite's
 * billboard family reads it. `@ignifx/2d` applies it itself — see `pivotedPositionToRef`.
 *
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteFrame = SpriteFrame;

/**
 * An opaque blend-mode descriptor (`index.d.ts` 12122).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteBlendMode = SpriteBlendMode;

/**
 * A sprite atlas's min/mag filter (`index.d.ts` 12229).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteSampling = SpriteSampling;

/**
 * A `pickSprite2D` hit: the layer, the dense sprite index, and the within-quad UV
 * (`index.d.ts` 12179).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpritePickInfo = SpritePickInfo;

/**
 * Mutable axis-aligned 2D bounds, the shape `getSprite2DVisibleBoundsToRef` writes
 * (`index.d.ts` 1352).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteBounds2D = Bounds2D;

/**
 * A compiled per-layer fragment shader (`index.d.ts` 11863).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSpriteCustomShader = Sprite2DCustomShader;

/**
 * The GPU texture behind an atlas (`index.d.ts` 12907).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteAtlasTexture = Texture2D;
