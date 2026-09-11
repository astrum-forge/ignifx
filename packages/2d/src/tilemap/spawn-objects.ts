import { Tilemap } from "./tilemap.js";
import type { TwoDService } from "../service/two-d-service.js";
import type { App, Entity, SceneInstance } from "@ignifx/core";

/**
 * Run the game's tile-object factories once per scene load, on `world.onSceneLoaded`.
 * `awake` and `onEnable` have finished by then, so factories can use the scene's components.
 */

/**
 * Runs the registered factory for every object in every `Tilemap` in a scene.
 *
 * @remarks
 * An object whose `type` has no registered factory is skipped silently: a map routinely carries
 * markers a given game does not use, and refusing to load the scene over one would make maps and
 * code impossible to version independently. A factory that throws is reported to `app.onError`
 * and the remaining objects still spawn, which is the same containment the frame loop gives a
 * script callback.
 *
 * A `Tilemap` whose document has not finished loading spawns nothing now; the next scene load, or
 * an explicit {@link spawnTilemapObjects} call, does it.
 *
 * @param app - The app.
 * @param service - The 2D service holding the factory registry.
 * @param scene - The scene that just loaded.
 *
 * @internal
 */
export function spawnTileObjects(app: App, service: TwoDService, scene: SceneInstance): void {
  const tilemaps = app.world.components(Tilemap);
  for (let index = 0; index < tilemaps.length; index += 1) {
    const tilemap = tilemaps[index];
    if (tilemap === undefined || tilemap.entity.scene !== scene) {
      continue;
    }
    spawnTilemapObjects(app, service, tilemap);
  }
}

/**
 * Runs the registered factory for every object in one tilemap.
 *
 * @param app - The app.
 * @param service - The 2D service holding the factory registry.
 * @param tilemap - The tilemap whose objects layer to walk.
 * @returns The entities that were created, in document order.
 *
 * @example
 * ```ts
 * app.twoD.registerTileObjectFactory("spawn", ({ world, position }) => {
 *   const player = world.createEntity({ name: "player" });
 *   player.transform.position2D = new Vec2(position.x, position.y);
 *   return player;
 * });
 * ```
 *
 * @public
 */
export function spawnTilemapObjects(app: App, service: TwoDService, tilemap: Tilemap): readonly Entity[] {
  const definition = tilemap.definition;
  if (definition === null) {
    return EMPTY;
  }
  const matrix = tilemap.entity.transform.worldMatrix;
  const originX = matrix[12] ?? 0;
  const originY = matrix[13] ?? 0;
  const spawned: Entity[] = [];
  for (let index = 0; index < definition.objects.length; index += 1) {
    const object = definition.objects[index];
    if (object === undefined) {
      continue;
    }
    const factory = service.tileObjectFactory(object.type);
    if (factory === null) {
      continue;
    }
    try {
      const entity = factory({
        world: app.world,
        name: object.name,
        type: object.type,
        position: { x: originX + object.x, y: originY + object.y },
        size: { x: object.width, y: object.height },
        properties: object.properties,
        tilemap: tilemap.entity,
      });
      if (entity !== null) {
        spawned.push(entity);
      }
    } catch (error: unknown) {
      app.onError.emit({ error, source: "extension", phase: null, entity: tilemap.entity, component: tilemap });
    }
  }
  return spawned;
}

/** The result of spawning from a tilemap with nothing loaded. */
const EMPTY: readonly Entity[] = Object.freeze([]);
