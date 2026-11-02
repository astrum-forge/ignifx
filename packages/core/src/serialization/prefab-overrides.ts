import { canonicalizeNumber } from "../schema/encode.js";
import { asJsonArray, asJsonObject } from "./json-view.js";
import { applyOverrides, overrideOp, parseOverridePath } from "./overrides.js";
import { computeSceneHash } from "./scene-asset.js";
import type { MutableSceneEntity, OverridePath, OverrideTarget } from "./overrides.js";
import type {
  SceneFile,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileInstance,
  SceneFileOverride,
} from "./scene-file.js";

/**
 * Which overrides of an instance {@link applyOverridesToAsset} and {@link revertOverrides} act on.
 *
 * @public
 */
export interface PrefabOverrideSelection {
  /**
   * Override paths to act on. A path selects every override at that path or below it, so
   * `"<entityUid>"` selects everything on that entity and `"<entityUid>/components/<componentUid>"`
   * selects a component's removal, its `enabled` flag, and its props. An `add` to
   * `<entityUid>/components` sits at `<entityUid>/components/<addedUid>`. Omitted, every override
   * is selected.
   */
  readonly paths?: readonly string[];
}

/**
 * An override {@link applyOverridesToAsset} left on the instance, and why.
 *
 * @public
 */
export interface PrefabOverrideSkip {
  /** The override, as the instance entry holds it. */
  readonly override: SceneFileOverride;
  /** Why it could not be written into the prefab file. */
  readonly reason: string;
}

/**
 * What {@link applyOverridesToAsset} returns.
 *
 * @public
 */
export interface PrefabApplyResult {
  /** The new prefab file, with the applied overrides written into it. */
  readonly asset: SceneFile;
  /** The content hash of {@link PrefabApplyResult.asset}, as {@link computeSceneHash} writes it. */
  readonly hash: string;
  /**
   * The instance entry without the applied overrides, recording {@link PrefabApplyResult.hash}. It
   * expands to the same values it did before the apply; a component an applied `add` brought now
   * comes from the prefab, so like every prefab component it gets a fresh uid per instance.
   */
  readonly instance: SceneFileInstance;
  /** The overrides written into the prefab, in instance order. */
  readonly applied: readonly SceneFileOverride[];
  /** The selected overrides that stay on the instance, in instance order. */
  readonly skipped: readonly PrefabOverrideSkip[];
}

/**
 * Writes an instance's overrides into the prefab file it instances, so every instance of the prefab
 * gets them — Unity's "Apply to prefab" (ADR-0005).
 *
 * @remarks
 * A pure function over the two files: nothing is loaded, and the same input always gives
 * byte-identical output through {@link stringifySceneFile}. The rules:
 *
 * - Property, `enabled`, transform, and entity-field overrides change the prefab's record. An `add`
 *   appends the component, keeping its uid; a `remove` deletes the component.
 * - On a prefab with exactly one root, the instance root's own `name`, `transform`, and other entity
 *   fields are its placement, not prefab content, so overrides of the root's entity fields and
 *   transform are skipped.
 * - Overrides reach only the prefab's own entities. Content of a scene the prefab itself instances
 *   is not addressable by an override path, so a nested prefab is never edited: an override that
 *   names something the prefab file does not hold is skipped.
 * - An override is skipped when an earlier override that stays on the instance overlaps its path, so
 *   the instance keeps the value it had.
 * - A skipped override stays on the returned instance. The instance's own `components` are not
 *   overrides and are not touched.
 * - Other instances of the prefab keep their overrides, which still win over the new prefab values
 *   at the same path. Record {@link PrefabApplyResult.hash} on them, or loading them logs `IGX-0604`.
 * - References inside added components (`$entity`, `$component`) are copied unchanged.
 *
 * @param instance - The instance entry whose overrides to apply; its `scene` should name `asset`.
 * @param asset - The prefab file the entry instances.
 * @param selection - Which overrides to apply; all of them by default.
 * @returns The new prefab file and its hash, the instance entry without the applied overrides, and
 * what was applied or skipped.
 * @throws IgnifxError with code `IGX-0609` when a selected override path is outside the grammar.
 *
 * @example
 * ```ts
 * const result = await applyOverridesToAsset(spawn.instance, prefabFile);
 * await app.storage.write("prefabs/enemy.prefab.json", stringifySceneFile(result.asset));
 * ```
 *
 * @public
 */
export async function applyOverridesToAsset(
  instance: SceneFileInstance,
  asset: SceneFile,
  selection?: PrefabOverrideSelection,
): Promise<PrefabApplyResult> {
  const overrides = instance.overrides ?? [];
  const records = new Map<string, MutableSceneEntity>();
  const lookup = new Map<string, OverrideTarget>();
  const uids = new Set<string>();
  for (const entity of asset.entities) {
    const data = mutableEntity(entity);
    records.set(entity.uid, data);
    lookup.set(entity.uid, { data, components: new Map<string, string>() });
    uids.add(entity.uid);
    for (const component of entity.components ?? []) {
      uids.add(component.uid);
    }
  }
  const singleRootUid = singleRootOf(asset);
  const touched = new Set<string>();
  const applied: SceneFileOverride[] = [];
  const skipped: PrefabOverrideSkip[] = [];
  const remaining: SceneFileOverride[] = [];
  for (const override of overrides) {
    if (!isSelected(override, selection)) {
      remaining.push(override);
      continue;
    }
    const parsed = parseOverridePath(override.path);
    let reason = precheck(override, parsed, singleRootUid, uids) ?? shadowedBy(override, remaining);
    if (reason === null) {
      applyOverrides([override], lookup, (message) => {
        reason ??= message;
      });
    }
    if (reason !== null) {
      skipped.push({ override, reason });
      remaining.push(override);
      continue;
    }
    touched.add(parsed.entity);
    const added = addedComponentUid(override);
    if (added !== null) {
      uids.add(added);
    }
    applied.push(override);
  }
  const next: SceneFile =
    applied.length === 0
      ? asset
      : {
          ...asset,
          entities: asset.entities.map((entity) => {
            const data = records.get(entity.uid);
            return data === undefined || !touched.has(entity.uid) ? entity : canonicalEntity(data);
          }),
        };
  const hash = await computeSceneHash(next);
  return { asset: next, hash, instance: withOverrides(instance, remaining, hash), applied, skipped };
}

/**
 * Drops an instance's overrides so it follows its prefab again — Unity's "Revert".
 *
 * @remarks
 * A pure function: the entry's `scene` and `hash` are kept, and `overrides` is omitted when none
 * remain. Reverting an `add` also reverts the overrides below the added component when the
 * selection path covers them (`<entityUid>/components/<addedUid>` does).
 *
 * @param instance - The instance entry.
 * @param selection - Which overrides to drop; all of them by default.
 * @returns The entry without the selected overrides, or `instance` itself when none was selected.
 *
 * @example
 * ```ts
 * const reverted = revertOverrides(spawn.instance, { paths: [`${rootUid}/components/${aiUid}`] });
 * ```
 *
 * @public
 */
export function revertOverrides(instance: SceneFileInstance, selection?: PrefabOverrideSelection): SceneFileInstance {
  const overrides = instance.overrides ?? [];
  const remaining = overrides.filter((override) => !isSelected(override, selection));
  if (remaining.length === overrides.length) {
    return instance;
  }
  return withOverrides(instance, remaining, instance.hash);
}

/**
 * Whether a selection covers an override.
 *
 * @param override - The override.
 * @param selection - The selection; absent or without `paths`, everything.
 * @returns `true` when the override's target is a selected path or lies below one.
 */
function isSelected(override: SceneFileOverride, selection: PrefabOverrideSelection | undefined): boolean {
  const paths = selection?.paths;
  if (paths === undefined) {
    return true;
  }
  const target = targetPath(override);
  return paths.some((path) => target === path || target.startsWith(`${path}/`));
}

/**
 * The path an override acts on: its own path, or for an `add` to a component list the path of the
 * component it adds, so a selection can name one added component.
 *
 * @param override - The override.
 * @returns The path.
 */
function targetPath(override: SceneFileOverride): string {
  const added = addedComponentUid(override);
  return added === null ? override.path : `${override.path}/${added}`;
}

/**
 * The uid of the component an `add` override appends to a component list.
 *
 * @param override - The override.
 * @returns The uid, or `null` when the override is not such an `add` or names no uid.
 */
function addedComponentUid(override: SceneFileOverride): string | null {
  if (overrideOp(override) !== "add") {
    return null;
  }
  const segments = override.path.split("/");
  if (segments.length !== 2 || segments[1] !== "components") {
    return null;
  }
  const uid = asJsonObject(override.value)?.["uid"];
  return typeof uid === "string" ? uid : null;
}

/**
 * Checks what the override patcher itself accepts silently but a prefab file must not take.
 *
 * @param override - The override.
 * @param parsed - Its parsed path.
 * @param singleRootUid - The prefab's only root, or `null`.
 * @param uids - Every uid the prefab file already uses.
 * @returns Why the override cannot be applied, or `null`.
 */
function precheck(
  override: SceneFileOverride,
  parsed: OverridePath,
  singleRootUid: string | null,
  uids: ReadonlySet<string>,
): string | null {
  if (parsed.entity === singleRootUid && (parsed.kind === "entityField" || parsed.kind === "transform")) {
    return `"${override.path}" sets the instance root's own ${parsed.kind === "transform" ? "transform" : parsed.field}, which is its placement, not prefab content.`;
  }
  if (parsed.kind === "transform") {
    const numbers = asJsonArray(override.value);
    const length = parsed.channel === "rotation" ? 4 : 3;
    if (
      numbers === null ||
      numbers.length !== length ||
      !numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ) {
      return `"${override.path}" needs ${String(length)} finite numbers.`;
    }
  }
  const added = addedComponentUid(override);
  if (added !== null && uids.has(added)) {
    return `"${override.path}" adds component ${added}, a uid the prefab file already uses.`;
  }
  return null;
}

/**
 * Why an override must stay on the instance: an earlier override that stays there overlaps it, and
 * once baked into the prefab the applied one would run first and lose to it.
 *
 * @param override - The selected override.
 * @param remaining - The earlier overrides that stay on the instance.
 * @returns Why the override cannot be applied, or `null`.
 */
function shadowedBy(override: SceneFileOverride, remaining: readonly SceneFileOverride[]): string | null {
  const key = overlapKey(override);
  const earlier = remaining.find((candidate) => {
    const other = overlapKey(candidate);
    return (
      addedComponentUid(candidate) === null &&
      (key === other || key.startsWith(`${other}/`) || other.startsWith(`${key}/`))
    );
  });
  return earlier === undefined
    ? null
    : `"${override.path}" follows "${earlier.path}", which stays on the instance and overlaps it.`;
}

/**
 * The part of an override's path that decides overlap: cut at the prop field, so array index shifts
 * inside one field count.
 *
 * @param override - The override.
 * @returns The key.
 */
function overlapKey(override: SceneFileOverride): string {
  return override.path.split("/").slice(0, 5).join("/");
}

/**
 * The uid of a scene file's only root.
 *
 * @param file - The file.
 * @returns The uid, or `null` when the file has no root or several.
 */
function singleRootOf(file: SceneFile): string | null {
  const roots = file.entities.filter((entity) => entity.parent === null);
  return roots.length === 1 ? (roots[0]?.uid ?? null) : null;
}

/**
 * Copies a file record into the mutable shape the override patcher edits.
 *
 * @param entity - The record.
 * @returns A copy that shares nothing the patcher mutates.
 */
function mutableEntity(entity: SceneFileEntity): MutableSceneEntity {
  return {
    uid: entity.uid,
    name: entity.name,
    parent: entity.parent,
    ...(entity.active === undefined ? {} : { active: entity.active }),
    ...(entity.static === undefined ? {} : { static: entity.static }),
    ...(entity.layer === undefined ? {} : { layer: entity.layer }),
    ...(entity.tags === undefined ? {} : { tags: [...entity.tags] }),
    transform: {
      position: [...entity.transform.position],
      rotation: [...entity.transform.rotation],
      scale: [...entity.transform.scale],
    },
    ...(entity.instance === undefined ? {} : { instance: entity.instance }),
    components: [...(entity.components ?? [])],
  };
}

/**
 * Writes a patched record back in the serializer's canonical form: its key order, defaults omitted,
 * tags sorted and unique, numbers canonicalized.
 *
 * @param data - The patched record.
 * @returns The file record.
 */
function canonicalEntity(data: MutableSceneEntity): SceneFileEntity {
  const tags = [...new Set(data.tags ?? [])].toSorted();
  return {
    uid: data.uid,
    name: data.name,
    parent: data.parent,
    ...(data.active === false ? { active: false } : {}),
    ...(data.static === true ? { static: true } : {}),
    ...(data.layer === undefined || data.layer === "Default" ? {} : { layer: data.layer }),
    ...(tags.length === 0 ? {} : { tags }),
    transform: {
      position: triple(data.transform.position),
      rotation: [
        canonicalNumberAt(data.transform.rotation, 0),
        canonicalNumberAt(data.transform.rotation, 1),
        canonicalNumberAt(data.transform.rotation, 2),
        canonicalNumberAt(data.transform.rotation, 3),
      ],
      scale: triple(data.transform.scale),
    },
    ...(data.instance === undefined ? {} : { instance: data.instance }),
    ...(data.components.length === 0 ? {} : { components: data.components.map(canonicalComponent) }),
  };
}

/**
 * Writes a component record in the serializer's key order, `enabled` omitted when `true`.
 *
 * @param component - The record.
 * @returns The canonical record.
 */
function canonicalComponent(component: SceneFileComponent): SceneFileComponent {
  return {
    uid: component.uid,
    type: component.type,
    ...(component.enabled === false ? { enabled: false } : {}),
    ...(component.schemaVersion === undefined ? {} : { schemaVersion: component.schemaVersion }),
    ...(component.props === undefined ? {} : { props: component.props }),
  };
}

/**
 * Reads a three-number transform channel.
 *
 * @param values - The channel.
 * @returns The canonical triple.
 */
function triple(values: readonly number[]): [number, number, number] {
  return [canonicalNumberAt(values, 0), canonicalNumberAt(values, 1), canonicalNumberAt(values, 2)];
}

/**
 * Reads one canonical number from a transform channel.
 *
 * @param values - The channel.
 * @param index - Which entry.
 * @returns The canonical number; `0` when the entry is missing.
 */
function canonicalNumberAt(values: readonly number[], index: number): number {
  return canonicalizeNumber(values[index] ?? 0);
}

/**
 * Rebuilds an instance entry with a new override list and hash.
 *
 * @param instance - The entry.
 * @param overrides - The overrides to keep.
 * @param hash - The hash to record, or `undefined` for none.
 * @returns The entry, in the serializer's key order, `overrides` omitted when empty.
 */
function withOverrides(
  instance: SceneFileInstance,
  overrides: readonly SceneFileOverride[],
  hash: string | undefined,
): SceneFileInstance {
  return {
    scene: instance.scene,
    ...(hash === undefined ? {} : { hash }),
    ...(overrides.length === 0 ? {} : { overrides }),
  };
}
