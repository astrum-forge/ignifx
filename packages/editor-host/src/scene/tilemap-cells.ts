/**
 * `setTilemapCells`: a tilemap editor's painting, written into the open scene's live `Tilemap`s so
 * it shows at once. The host reaches `Tilemap` by type id and its members by shape, as
 * `./view-2d.ts` does, so it does not depend on `@ignifx/2d`.
 */

import { InvalidParamsError } from "../channel.js";
import { componentTypeOf, TILEMAP_TYPE } from "./view-2d.js";
import type { SetTilemapCellsParams, SetTilemapCellsResult } from "../protocol/index.js";
import type { App, Component, Entity } from "@ignifx/core";

/** A tilemap document's layer, as the host reads it. */
export interface TileLayerShape {
  /** The layer's name. */
  readonly name: string;
  /** Width in cells. */
  readonly width: number;
  /** Height in cells. */
  readonly height: number;
}

/** One cell write, as `Tilemap.setCells` takes it: `y` counts from the bottom row. */
export interface TileWriteShape {
  /** The layer's index. */
  readonly layer: number;
  /** The column, `0` at the left. */
  readonly x: number;
  /** The row, `0` at the bottom. */
  readonly y: number;
  /** The tile id, `0` to clear. */
  readonly tileId: number;
}

/** What the host needs of a `Tilemap`. */
interface TilemapLike {
  /** The tilemap document's handle. */
  readonly map: { readonly address: string } | null;
  /** The parsed document, or `null` while it loads. */
  readonly definition: { readonly layers: readonly TileLayerShape[] } | null;
  /** Writes cells as one change; answers how many changed. */
  setCells(cells: readonly TileWriteShape[]): number;
}

/**
 * Turns the file-ordered `[index, tile, …]` pairs of `setTilemapCells` into `Tilemap.setCells`
 * writes, whose rows count from the bottom.
 *
 * @param layers - The document's layers.
 * @param layer - The layer's name or index.
 * @param cells - The flat pairs, the index row-major with the top row first.
 * @returns The writes, or why the request does not fit the document.
 */
export function planTileWrites(
  layers: readonly TileLayerShape[],
  layer: string | number,
  cells: readonly number[],
): readonly TileWriteShape[] | string {
  const index = typeof layer === "number" ? layer : layers.findIndex((candidate) => candidate.name === layer);
  const declared = layers[index];
  if (declared === undefined) {
    return `The tilemap has no layer ${JSON.stringify(layer)}.`;
  }
  const { width, height } = declared;
  const writes: TileWriteShape[] = [];
  for (let at = 0; at + 1 < cells.length; at += 2) {
    const cell = cells[at] ?? 0;
    if (cell >= width * height) {
      return `Cell ${String(cell)} is outside layer ${JSON.stringify(declared.name)} (${String(width)}×${String(height)}).`;
    }
    const row = Math.floor(cell / width);
    writes.push({ layer: index, x: cell % width, y: height - 1 - row, tileId: cells[at + 1] ?? 0 });
  }
  return writes;
}

/**
 * Tells whether a component has the `Tilemap` members the host uses.
 *
 * @param component - The component.
 * @returns True for a `map`, a `definition` and a `setCells` method.
 */
function isTilemapLike(component: Component): component is Component & TilemapLike {
  return (
    Reflect.has(component, "map") &&
    Reflect.has(component, "definition") &&
    typeof Reflect.get(component, "setCells") === "function"
  );
}

/**
 * Writes the cells into every `Tilemap` under the roots whose `map` is the asset and has loaded.
 * Every tilemap's writes are checked before any is made.
 *
 * @param app - The scene view's app.
 * @param roots - The open scene's root entities.
 * @param params - The request.
 * @returns How many tilemaps were written and how many cells changed.
 * @throws InvalidParamsError when the layer or a cell does not fit a tilemap's document.
 */
export function setTilemapCells(
  app: App,
  roots: readonly Entity[],
  params: SetTilemapCellsParams,
): SetTilemapCellsResult {
  const type = componentTypeOf(app, TILEMAP_TYPE);
  if (type === null) {
    return { tilemaps: 0, changed: 0 };
  }
  const planned: (readonly [TilemapLike, readonly TileWriteShape[]])[] = [];
  for (const root of roots) {
    for (const component of root.getComponentsInChildren(type, true)) {
      const layers = isTilemapLike(component) ? component.definition?.layers : undefined;
      if (!isTilemapLike(component) || component.map?.address !== params.asset || layers === undefined) {
        continue;
      }
      const writes = planTileWrites(layers, params.layer, params.cells);
      if (typeof writes === "string") {
        throw new InvalidParamsError(`setTilemapCells: ${params.asset}: ${writes}`);
      }
      planned.push([component, writes]);
    }
  }
  let changed = 0;
  for (const [tilemap, writes] of planned) {
    changed += tilemap.setCells(writes);
  }
  return { tilemaps: planned.length, changed };
}
