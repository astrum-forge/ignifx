/**
 * The play view's `queryRuntime` (engine ask E48): one entity of the running game, as the scene
 * format writes it, read through core's `serializeEntity`, each value capped and the whole answer
 * kept within `QUERY_RUNTIME_MAX_JSON_LENGTH`.
 */

import { serializeEntity } from "@ignifx/core";
import { clipHostText } from "./app-reports.js";
import { InvalidParamsError, RpcFailure } from "./channel.js";
import {
  HOST_LIST_MAX_LENGTH,
  isQueryRuntimeParams,
  QUERY_RUNTIME_MAX_COMPONENTS,
  QUERY_RUNTIME_MAX_JSON_LENGTH,
  QUERY_RUNTIME_MAX_KEYS,
  RpcErrorCode,
} from "./protocol/index.js";
import type { JsonObject, JsonValue, QueryRuntimeResult, SceneFileComponent } from "./protocol/index.js";
import type { App } from "@ignifx/core";

/** How deep a capped JSON value may nest; deeper values become `null`, as `isJsonValue` allows 256. */
const MAX_JSON_DEPTH = 256;

/** The key an object cut to `QUERY_RUNTIME_MAX_KEYS` keys gets, with how many it lost. */
const OMITTED_KEY = "$omitted";

/** What `"components":[],` and a count of up to 64 omitted components add to an answer's JSON. */
const COMPONENTS_OVERHEAD = 32;

/** Thrown out of a copy once it is sure to pass its budget. */
class OverBudget extends Error {}

/**
 * Counts, while a component is copied, a lower bound of its JSON length, so a copy that cannot fit
 * stops early instead of building the whole oversized value.
 */
class Meter {
  #used = 0;
  readonly #limit: number;

  /**
   * Creates the meter.
   *
   * @param limit - The JSON length the copy may take.
   */
  constructor(limit: number) {
    this.#limit = limit;
  }

  /**
   * Counts part of the copy.
   *
   * @param length - At most as many UTF-16 code units as that part takes as JSON.
   * @throws OverBudget once the count passes the limit.
   */
  charge(length: number): void {
    this.#used += length;
    if (this.#used > this.#limit) {
      throw new OverBudget();
    }
  }
}

/**
 * Clips a string to a length, never splitting a surrogate pair.
 *
 * @param text - The string.
 * @param max - The longest it may be.
 * @returns It, or its start.
 */
function clipTo(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd8_00 && last <= 0xdb_ff ? max - 1 : max);
}

/**
 * Copies a value within the caps of `QueryRuntimeResult.entity`, counting it on the meter.
 *
 * @param value - The value, which a custom codec may have made something other than JSON.
 * @param depth - How deep it sits.
 * @param meter - The component's budget.
 * @returns The capped copy; `null` for anything that is not JSON or sits too deep.
 * @throws OverBudget when the copy cannot fit.
 */
function capJson(value: unknown, depth: number, meter: Meter): JsonValue {
  if (typeof value === "string") {
    const clipped = clipHostText(value);
    meter.charge(clipped.length + 2);
    return clipped;
  }
  meter.charge(1);
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  if (typeof value !== "object" || value === null || depth >= MAX_JSON_DEPTH) {
    // NaN, a function, `undefined`: none survives `postMessage` or the editor's guard as itself.
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, HOST_LIST_MAX_LENGTH).map((item: unknown) => capJson(item, depth + 1, meter));
  }
  return capJsonObject(value, depth, meter);
}

/**
 * {@link capJson} for an object: at most `QUERY_RUNTIME_MAX_KEYS` keys, each clipped as long.
 *
 * @param value - The object.
 * @param depth - How deep it sits.
 * @param meter - The component's budget.
 * @returns The capped copy, keys in the same order, with `"$omitted"` when keys were cut.
 * @throws OverBudget when the copy cannot fit.
 */
function capJsonObject(value: object, depth: number, meter: Meter): JsonObject {
  const out: Record<string, JsonValue> = {};
  const entries = Object.entries(value);
  for (const [key, item] of entries.slice(0, QUERY_RUNTIME_MAX_KEYS)) {
    const clipped = clipTo(key, QUERY_RUNTIME_MAX_KEYS);
    meter.charge(clipped.length + 3);
    out[clipped] = capJson(item, depth + 1, meter);
  }
  if (entries.length > QUERY_RUNTIME_MAX_KEYS) {
    meter.charge(OMITTED_KEY.length + 4);
    out[OMITTED_KEY] = entries.length - QUERY_RUNTIME_MAX_KEYS;
  }
  return out;
}

/**
 * Copies one component record within the caps, if it fits.
 *
 * @param component - The record `serializeEntity` wrote.
 * @param room - The JSON length still free in the answer.
 * @returns The capped record and its JSON length, or `null` when it does not fit.
 */
function fitComponent(
  component: SceneFileComponent,
  room: number,
): { readonly record: SceneFileComponent; readonly length: number } | null {
  try {
    const meter = new Meter(room);
    const record: SceneFileComponent = {
      ...component,
      type: clipTo(component.type, QUERY_RUNTIME_MAX_KEYS),
      ...(component.props === undefined ? {} : { props: capJsonObject(component.props, 0, meter) }),
    };
    // The meter counts a lower bound (escapes are longer); the text is what the budget is about.
    const length = JSON.stringify(record).length + 1;
    return length <= room ? { record, length } : null;
  } catch (error) {
    if (error instanceof OverBudget) {
      return null;
    }
    throw error;
  }
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
  const answer: QueryRuntimeResult = {
    entity: {
      ...fields,
      name: clipTo(fields.name, QUERY_RUNTIME_MAX_KEYS),
      ...(fields.layer === undefined ? {} : { layer: clipTo(fields.layer, QUERY_RUNTIME_MAX_KEYS) }),
      ...(fields.tags === undefined
        ? {}
        : { tags: fields.tags.slice(0, QUERY_RUNTIME_MAX_KEYS).map((tag) => clipTo(tag, QUERY_RUNTIME_MAX_KEYS)) }),
    },
    omittedComponents: matching.length,
    frameCount: app.time.frameCount,
    time: app.time.time,
  };
  // Room for the components: what the rest takes, plus `"components":[]` and a longer count.
  let room = QUERY_RUNTIME_MAX_JSON_LENGTH - JSON.stringify(answer).length - COMPONENTS_OVERHEAD;
  const kept: SceneFileComponent[] = [];
  for (const component of matching.slice(0, QUERY_RUNTIME_MAX_COMPONENTS)) {
    const fitted = fitComponent(component, room);
    if (fitted === null) {
      break;
    }
    kept.push(fitted.record);
    room -= fitted.length;
  }
  return {
    ...answer,
    entity: { ...answer.entity, ...(kept.length === 0 ? {} : { components: kept }) },
    omittedComponents: matching.length - kept.length,
  };
}
