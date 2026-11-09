import { canonicalizeNumber } from "../schema/encode.js";
import { resolveInstancePath } from "./instance-targets.js";
import { asJsonArray, asJsonObject } from "./json-view.js";
import { applyOverrides, isNestedComponentPath, overrideOp, parseOverridePath } from "./overrides.js";
import { computeSceneHash } from "./scene-asset.js";
import type { PrefabReader } from "./instance-targets.js";
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
   * `<entityUid>/components` sits at `<entityUid>/components/<addedUid>`. A component of a nested
   * prefab is selected by its instance path the same way:
   * `"<nestedInstanceUid>/components/<nestedInstanceUid>/<componentUid>"`. Omitted, every override
   * is selected.
   */
  readonly paths?: readonly string[];
}

/**
 * What {@link applyOverridesToAsset} acts on: the selected overrides and, optionally, the components
 * the instance root carries itself.
 *
 * @public
 */
export interface PrefabApplyOptions extends PrefabOverrideSelection {
  /**
   * The components the instance root carries itself: the `components` of the scene-file entity that
   * holds the `instance` entry. They are not overrides (the serializer writes a component added on
   * a single-root instance's root there), so they can only be applied when passed here. Each one
   * that `paths` selects, at `<prefabRootUid>/components/<componentUid>`, is appended to the
   * prefab's root after its own components, which is the order the instance already has them in.
   * Omitted, none is applied.
   */
  readonly rootComponents?: readonly SceneFileComponent[];
  /**
   * Reads the prefabs the prefab file itself instances, by the address its `instance` entries name.
   * An override of a nested prefab's component (an instance path in its component segment) is
   * applied by moving it onto the nested `instance` entry of the prefab file, which needs the
   * nested file to find the entity holding the component. Omitted, such overrides are skipped.
   */
  readonly readScene?: PrefabReader;
}

/**
 * A component of the instance root that {@link applyOverridesToAsset} left on the instance, and why.
 *
 * @public
 */
export interface PrefabComponentSkip {
  /** The component, as the instance root holds it. */
  readonly component: SceneFileComponent;
  /** Why it could not be written into the prefab file. */
  readonly reason: string;
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
  /**
   * The {@link PrefabApplyOptions.rootComponents} written into the prefab's root. Remove them from
   * the instance root: the prefab brings them now.
   */
  readonly appliedComponents: readonly SceneFileComponent[];
  /**
   * The {@link PrefabApplyOptions.rootComponents} that stay on the instance root, in their order:
   * the unselected ones and the skipped ones.
   */
  readonly rootComponents: readonly SceneFileComponent[];
  /** The selected {@link PrefabApplyOptions.rootComponents} that stay on the instance root, and why. */
  readonly skippedComponents: readonly PrefabComponentSkip[];
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
 * - A nested prefab is never edited. An override of a nested prefab's component, whose component
 *   segment is an instance path (`"<nestedInstanceUid>/<componentUid>"`), moves onto the prefab
 *   file's nested `instance` entry instead, rewritten into that entry's own paths, replacing an
 *   override there at the same path and op. It needs {@link PrefabApplyOptions.readScene}; without
 *   it, or when the path names nothing, it is skipped. Any other override that names something the
 *   prefab file does not hold is skipped.
 * - An override is skipped when an earlier override that stays on the instance overlaps its path, so
 *   the instance keeps the value it had.
 * - A skipped override stays on the returned instance.
 * - The instance root's own components are not overrides. Pass them as
 *   {@link PrefabApplyOptions.rootComponents} to apply them too: on a prefab with exactly one root
 *   each selected one is appended to that root, keeping its uid, and reported in
 *   {@link PrefabApplyResult.appliedComponents}; one whose uid the prefab already uses, or any when
 *   the prefab has several roots, is skipped.
 * - Other instances of the prefab keep their overrides, which still win over the new prefab values
 *   at the same path. Record {@link PrefabApplyResult.hash} on them, or loading them logs `IGX-0604`.
 * - References inside added components (`$entity`, `$component`) are copied unchanged.
 * - A component an apply moved into the prefab gets a fresh uid per instance from then on, like every
 *   prefab component; a scene reference to it uses the instance form
 *   `{ "$component": "<instanceRootUid>/<componentUid>" }`.
 *
 * @param instance - The instance entry whose overrides to apply; its `scene` should name `asset`.
 * @param asset - The prefab file the entry instances.
 * @param selection - Which overrides to apply, all of them by default, and the instance root's own
 * components to apply with them.
 * @returns The new prefab file and its hash, the instance entry without the applied overrides, and
 * what was applied or skipped.
 * @throws IgnifxError with code `IGX-0609` when a selected override path is outside the grammar.
 *
 * @example
 * ```ts
 * const result = await applyOverridesToAsset(spawn.instance, prefabFile, { rootComponents: spawn.components });
 * await app.storage.write("prefabs/enemy.prefab.json", stringifySceneFile(result.asset));
 * ```
 *
 * @public
 */
export async function applyOverridesToAsset(
  instance: SceneFileInstance,
  asset: SceneFile,
  selection?: PrefabApplyOptions,
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
  const own = applyRootComponents(selection, singleRootUid, records, uids, touched);
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
    if (reason === null && isNestedPath(parsed)) {
      reason = moveIntoNestedInstance(override, parsed, asset, records, selection?.readScene);
    } else if (reason === null) {
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
    touched.size === 0
      ? asset
      : {
          ...asset,
          entities: asset.entities.map((entity) => {
            const data = records.get(entity.uid);
            return data === undefined || !touched.has(entity.uid) ? entity : canonicalEntity(data);
          }),
        };
  const hash = await computeSceneHash(next);
  return {
    asset: next,
    hash,
    instance: withOverrides(instance, remaining, hash),
    applied,
    skipped,
    appliedComponents: own.applied,
    rootComponents: own.kept,
    skippedComponents: own.skipped,
  };
}

/**
 * Whether a parsed override path addresses a component of a nested prefab.
 *
 * @param parsed - The parsed path.
 * @returns `true` when its component segment is an instance path.
 */
function isNestedPath(parsed: OverridePath): boolean {
  return (
    (parsed.kind === "component" || parsed.kind === "componentField" || parsed.kind === "prop") &&
    isNestedComponentPath(parsed.component)
  );
}

/**
 * Moves an override of a nested prefab's component onto the prefab file's nested `instance` entry,
 * rewritten into the paths of the file that entry instances.
 *
 * @param override - The override.
 * @param parsed - Its parsed path, whose component segment is an instance path.
 * @param asset - The prefab file.
 * @param records - The prefab's mutable records, by uid; the carrier's `instance` is replaced.
 * @param readScene - Reads nested prefab files, if given.
 * @returns Why the override cannot be moved, or `null` once it is.
 */
function moveIntoNestedInstance(
  override: SceneFileOverride,
  parsed: OverridePath,
  asset: SceneFile,
  records: ReadonlyMap<string, MutableSceneEntity>,
  readScene: PrefabReader | undefined,
): string | null {
  if (parsed.kind !== "component" && parsed.kind !== "componentField" && parsed.kind !== "prop") {
    return null;
  }
  if (readScene === undefined) {
    return `"${override.path}" reaches into a nested prefab; pass readScene to apply it.`;
  }
  const head = parsed.component.slice(0, parsed.component.indexOf("/"));
  const carrier = records.get(head);
  const instance = carrier?.instance;
  const target = head === parsed.entity ? resolveInstancePath(asset, parsed.component, readScene, "component") : null;
  const prefix = target?.overridePath ?? null;
  if (carrier === undefined || instance === undefined || prefix === null) {
    return `"${override.path}" names no component of a nested prefab.`;
  }
  const suffix =
    parsed.kind === "prop" ? `/props/${parsed.steps.join("/")}` : parsed.kind === "componentField" ? "/enabled" : "";
  const path = `${prefix}${suffix}`;
  const moved: SceneFileOverride = { ...override, path };
  const op = overrideOp(moved);
  const kept = (instance.overrides ?? []).filter((existing) => existing.path !== path || overrideOp(existing) !== op);
  carrier.instance = withOverrides(instance, [...kept, moved], instance.hash);
  return null;
}

/** What {@link applyRootComponents} did with the instance root's own components. */
interface RootComponentOutcome {
  /** Written into the prefab's root. */
  readonly applied: readonly SceneFileComponent[];
  /** Staying on the instance root. */
  readonly kept: readonly SceneFileComponent[];
  /** Selected but staying on the instance root, and why. */
  readonly skipped: readonly PrefabComponentSkip[];
}

/**
 * Appends the selected components of the instance root to the prefab's single root.
 *
 * @param options - The apply options, holding the components and the selection.
 * @param singleRootUid - The prefab's only root, or `null`.
 * @param records - The prefab's mutable records, by uid.
 * @param uids - Every uid the prefab uses; the appended components are added.
 * @param touched - Filled with the root's uid when anything was appended.
 * @returns What was applied, what stays on the instance root, and why the skipped ones were.
 */
function applyRootComponents(
  options: PrefabApplyOptions | undefined,
  singleRootUid: string | null,
  records: ReadonlyMap<string, MutableSceneEntity>,
  uids: Set<string>,
  touched: Set<string>,
): RootComponentOutcome {
  const applied: SceneFileComponent[] = [];
  const kept: SceneFileComponent[] = [];
  const skipped: PrefabComponentSkip[] = [];
  const root = singleRootUid === null ? undefined : records.get(singleRootUid);
  for (const component of options?.rootComponents ?? []) {
    const selected =
      singleRootUid === null
        ? options?.paths === undefined
        : isPathSelected(`${singleRootUid}/components/${component.uid}`, options);
    if (!selected) {
      kept.push(component);
      continue;
    }
    const reason =
      root === undefined
        ? `The prefab has no single root, so component ${component.uid} of the instance root has nowhere to go.`
        : uids.has(component.uid)
          ? `Component ${component.uid} of the instance root has a uid the prefab file already uses.`
          : null;
    if (root === undefined || reason !== null) {
      skipped.push({ component, reason: reason ?? "" });
      kept.push(component);
      continue;
    }
    root.components.push(component);
    uids.add(component.uid);
    touched.add(root.uid);
    applied.push(component);
  }
  return { applied, kept, skipped };
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
  return isPathSelected(targetPath(override), selection);
}

/**
 * Whether a selection covers a target path.
 *
 * @param target - The path acted on.
 * @param selection - The selection; absent or without `paths`, everything.
 * @returns `true` when the target is a selected path or lies below one.
 */
function isPathSelected(target: string, selection: PrefabOverrideSelection | undefined): boolean {
  const paths = selection?.paths;
  if (paths === undefined) {
    return true;
  }
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
  let parsed: OverridePath;
  try {
    parsed = parseOverridePath(override.path);
  } catch {
    return override.path;
  }
  return parsed.kind === "prop"
    ? `${parsed.entity}/components/${parsed.component}/props/${parsed.steps[0] ?? ""}`
    : override.path;
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
