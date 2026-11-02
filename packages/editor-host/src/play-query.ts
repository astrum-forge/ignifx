/**
 * The play view's `queryRuntime` (engine ask E48): one entity of the running game, as the scene
 * format writes it, read through core's `serializeEntity` and kept within the editor's caps.
 */

import { serializeEntity } from "@ignifx/core";
import { clipHostText } from "./app-reports.js";
import { InvalidParamsError, RpcFailure } from "./channel.js";
import {
  HOST_LIST_MAX_LENGTH,
  isQueryRuntimeParams,
  QUERY_RUNTIME_MAX_COMPONENTS,
  RpcErrorCode,
} from "./protocol/index.js";
import type { JsonArray, JsonObject, JsonValue, QueryRuntimeResult, SceneFileComponent } from "./protocol/index.js";
import type { App } from "@ignifx/core";

/** How deep a capped JSON value may nest; deeper values become `null`, as `isJsonValue` allows 256. */
const MAX_JSON_DEPTH = 256;

/**
 * Keeps a JSON value within the editor's caps: each string clipped to `HOST_TEXT_MAX_LENGTH`, each
 * list cut to `HOST_LIST_MAX_LENGTH`, and nothing nested deeper than the editor's guard accepts.
 *
 * @param value - The value.
 * @param depth - How deep it sits.
 * @returns The capped copy.
 */
function capJson(value: JsonValue, depth: number): JsonValue {
  if (typeof value === "string") {
    return clipHostText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_JSON_DEPTH) {
    return null;
  }
  if (isJsonArray(value)) {
    return value.slice(0, HOST_LIST_MAX_LENGTH).map((item) => capJson(item, depth + 1));
  }
  return capJsonObject(value, depth);
}

/**
 * Splits a JSON container. `Array.isArray` does not remove a readonly array from a union.
 *
 * @param value - An array or an object.
 * @returns True for the array.
 */
function isJsonArray(value: JsonArray | JsonObject): value is JsonArray {
  return Array.isArray(value);
}

/**
 * {@link capJson} for an object.
 *
 * @param value - The object.
 * @param depth - How deep it sits.
 * @returns The capped copy, with the same keys in the same order.
 */
function capJsonObject(value: JsonObject, depth: number): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = capJson(item, depth + 1);
  }
  return out;
}

/**
 * Keeps one component record within the editor's caps.
 *
 * @param component - The record `serializeEntity` wrote.
 * @returns The capped record.
 */
function capComponent(component: SceneFileComponent): SceneFileComponent {
  return {
    ...component,
    type: clipHostText(component.type),
    ...(component.props === undefined ? {} : { props: capJsonObject(component.props, 0) }),
  };
}

/**
 * Reads the type ids a `queryRuntime` keeps.
 *
 * @param params - The received `params`.
 * @returns The entity's uid and the type-id filter, or `null` for every component.
 * @throws InvalidParamsError when the parameters are not a uid and at most 64 type ids.
 */
function checkQueryRuntimeParams(params: unknown): { uid: string; filter: ReadonlySet<string> | null } {
  if (!isQueryRuntimeParams(params)) {
    throw new InvalidParamsError(
      `queryRuntime needs { entity: uid, components?: typeId[] } with at most ${String(QUERY_RUNTIME_MAX_COMPONENTS)} type ids.`,
    );
  }
  return { uid: params.entity, filter: params.components === undefined ? null : new Set(params.components) };
}

/**
 * `queryRuntime`: one entity of the game as `serializeEntity` writes it from the live world, capped.
 * Changes nothing.
 *
 * @param app - The game's app.
 * @param params - The received `params`.
 * @returns The entity record, how many components did not fit, and when it was read.
 * @throws InvalidParamsError for malformed parameters, and RpcFailure `unknownEntity` when no live
 * entity of the game has the uid.
 */
export function queryRuntime(app: App, params: unknown): QueryRuntimeResult {
  const { uid, filter } = checkQueryRuntimeParams(params);
  const entity = app.world.getEntity(uid);
  if (entity === null || entity.isDestroyed) {
    throw new RpcFailure(
      RpcErrorCode.unknownEntity,
      "No entity of the running game has that uid. Entities a script or a prefab spawns get new uids on every run.",
    );
  }
  const { components, ...fields } = serializeEntity(entity);
  const matching = (components ?? []).filter((component) => filter?.has(component.type) ?? true);
  const kept = matching.slice(0, QUERY_RUNTIME_MAX_COMPONENTS).map(capComponent);
  return {
    entity: {
      ...fields,
      name: clipHostText(fields.name),
      ...(fields.layer === undefined ? {} : { layer: clipHostText(fields.layer) }),
      ...(fields.tags === undefined ? {} : { tags: fields.tags.slice(0, HOST_LIST_MAX_LENGTH).map(clipHostText) }),
      ...(kept.length === 0 ? {} : { components: kept }),
    },
    omittedComponents: matching.length - kept.length,
    frameCount: app.time.frameCount,
    time: app.time.time,
  };
}
