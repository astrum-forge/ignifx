import { isAbsoluteReference, resolveRelative } from "../assets/relative.js";
import { TwoDErrorCode } from "../errors.js";
import { buildAtlas } from "../lite/atlas.js";
import { loadAtlasTexture, releaseAtlasTexture } from "../lite/gpu/texture.js";
import {
  defineSpriteAtlas,
  parseSpriteFragment,
  readVec2,
  SPRITE_ATLAS_ASSET_TYPE,
  SPRITE_ATLAS_FILE_EXTENSIONS,
} from "./definition.js";
import { SpriteAtlasAsset } from "./sprite-atlas-asset.js";
import type { SpriteAtlasDefinition, SpriteAtlasInput } from "./definition.js";
import type { SpriteAsset } from "./sprite-atlas-asset.js";
import type { FrameRect } from "../lite/atlas.js";
import type { AssetLoader, LoaderContext, Logger, Vec2Like } from "@ignifx/core";

/**
 * The `spriteatlas` asset loader (`docs/architecture/05-assets-and-loading.md` §5,
 * `11-2d-toolkit.md` §2.3).
 *
 * The loader fetches the `.atlas.json` document, uploads the image it names, and builds Lite's
 * `SpriteAtlas` from the pixel rectangles. Under a headless app it stops after parsing: the frames
 * are all queryable, nothing is uploaded, and `asset.lite.atlas` is `null`
 * (`docs/architecture/07-rendering.md` §6).
 *
 * `parseFragment` is what makes `"2d/hero.atlas.json#frame:idle_0"` work: the base document is
 * loaded once and shared, and the fragment handle resolves to a {@link SpriteAsset} naming one
 * frame of it.
 */

/**
 * The centre pivot a frame that declares none uses.
 */
const CENTRE_PIVOT: Vec2Like = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * Converts the document's frame rectangles into the adapter's shape.
 *
 * @param definition - The parsed document.
 * @returns The rectangles, in index order.
 */
function toRects(definition: SpriteAtlasDefinition): readonly FrameRect[] {
  const rects: FrameRect[] = [];
  for (let index = 0; index < definition.frames.length; index += 1) {
    const frame = definition.frames[index];
    if (frame === undefined) {
      continue;
    }
    rects.push({
      name: frame.name,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      pivotX: readVec2(frame.pivot, CENTRE_PIVOT).x,
      pivotY: readVec2(frame.pivot, CENTRE_PIVOT).y,
      sourceW: readVec2(frame.sourceSize, { x: frame.w, y: frame.h }).x,
      sourceH: readVec2(frame.sourceSize, { x: frame.w, y: frame.h }).y,
    });
  }
  return rects;
}

/**
 * Warns about frames that a pixel-perfect camera will bleed.
 *
 * @remarks
 * `docs/architecture/11-2d-toolkit.md` §4 asks importers to warn when a frame lacks a one-pixel
 * extruded border. The loader cannot see the image's pixels — it only has rectangles — so it checks
 * the thing it *can* see and that causes the bleed: a frame whose rectangle touches another frame's
 * rectangle, or the image edge, with no gap. Two frames packed flush against each other are exactly
 * the case where a `nearest` sample at a frame boundary can pick up the neighbour.
 *
 * This is a log, not a throw (`IGX-1102`): a game that never turns on `pixelPerfect` is unaffected,
 * and the remedy — repacking with padding — belongs to the art pipeline.
 *
 * @param definition - The parsed document.
 * @param address - The atlas address, for the message.
 * @param log - Where to report.
 *
 * @internal
 */
export function warnUnextrudedFrames(definition: SpriteAtlasDefinition, address: string, log: Logger): void {
  const frames = definition.frames;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) {
      continue;
    }
    let touches = false;
    for (let other = 0; other < frames.length && !touches; other += 1) {
      const neighbour = frames[other];
      if (neighbour === undefined || other === index) {
        continue;
      }
      const gapX = Math.max(frame.x - (neighbour.x + neighbour.w), neighbour.x - (frame.x + frame.w));
      const gapY = Math.max(frame.y - (neighbour.y + neighbour.h), neighbour.y - (frame.y + frame.h));
      touches = gapX === 0 || gapY === 0;
    }
    if (touches) {
      log.warnOnce(
        `${address}#${frame.name}`,
        `${TwoDErrorCode.atlasFrameNotExtruded}: atlas frame ${frame.name} has no 1-px extruded border.`,
        {
          atlas: address,
          frame: frame.name,
          hint: "Repack with at least 1 px of padding, or a pixel-perfect camera can sample the neighbouring frame.",
        },
      );
    }
  }
}

/** The one thing the image resolution needs from `app.assets`. */
export interface AtlasImageUrlResolver {
  /** Resolves an address to the URL the asset service would fetch. */
  resolveUrl(address: string): string;
}

/**
 * Resolves an atlas document's `image` reference to the URL to fetch.
 *
 * @remarks
 * A relative reference is an **address** relative to the atlas document's own address and goes
 * through the asset manifest (`assets.resolveUrl`), so a production build that content-hashes the
 * asset root still finds the image. A root-relative (`/sheet.png`) or absolute (`https://…`,
 * `blob:`, `data:`) reference is a URL and is fetched verbatim — the shape a file in Vite's `public/`
 * directory has. Resolving against the document's *URL* instead broke hashed builds (Phase 6).
 *
 * @param assets - The app's asset service, or anything with its `resolveUrl`.
 * @param atlasAddress - The address of the atlas document.
 * @param image - The `image` reference as written in the document.
 * @returns The URL to load the sheet from.
 *
 * @internal
 */
export function resolveAtlasImageUrl(assets: AtlasImageUrlResolver, atlasAddress: string, image: string): string {
  const reference = resolveRelative(atlasAddress, image);
  return isAbsoluteReference(reference) ? reference : assets.resolveUrl(reference);
}

/**
 * Builds the loader for `.atlas.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createSpriteAtlasLoader());
 * ```
 *
 * @public
 */
export function createSpriteAtlasLoader(): AssetLoader<SpriteAtlasAsset> {
  return {
    type: SPRITE_ATLAS_ASSET_TYPE,
    extensions: SPRITE_ATLAS_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<SpriteAtlasAsset> {
      const raw = await ctx.fetchJson<SpriteAtlasInput>();
      const definition = defineSpriteAtlas(raw, ctx.address);
      warnUnextrudedFrames(definition, ctx.address, ctx.app.log);
      if (ctx.app.isHeadless) {
        // §6: a loader must tolerate the null engine and return CPU-only data.
        return new SpriteAtlasAsset(ctx.address, definition, null, null);
      }
      ctx.reportProgress(0);
      const url = resolveAtlasImageUrl(ctx.app.assets, ctx.address, definition.image);
      const texture = await loadAtlasTexture(ctx.lite.engine, url, definition.sampling, definition.premultipliedAlpha);
      ctx.reportProgress(1);
      const atlas = buildAtlas(
        texture,
        texture.width,
        texture.height,
        toRects(definition),
        definition.premultipliedAlpha,
      );
      return new SpriteAtlasAsset(ctx.address, definition, atlas, (): void => {
        releaseAtlasTexture(texture);
      });
    },
    unload(value: SpriteAtlasAsset): void {
      value.releaseGpu();
    },
    parseFragment(fragment: string, value: SpriteAtlasAsset): unknown {
      const name = parseSpriteFragment(fragment);
      if (name === null) {
        const first = value.frame(0);
        return first === null ? null : ({ atlas: value, frame: 0, name: first.name } satisfies SpriteAsset);
      }
      const index = value.requireFrame(name);
      return { atlas: value, frame: index, name } satisfies SpriteAsset;
    },
  };
}
