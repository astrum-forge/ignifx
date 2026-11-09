import { INSTANCE_PATH_SEPARATOR } from "./instance-paths.js";
import type { SceneFile, SceneFileComponent, SceneFileEntity } from "./scene-file.js";

/**
 * Reads a prefab (or any scene) file by the address an `instance` entry names, for
 * {@link resolveInstancePath} and {@link enumerateInstanceTargets}.
 *
 * @remarks
 * The address is passed exactly as the entry's `scene.$asset` holds it. Return `null` or
 * `undefined` for a file that is not available; the walk then stops there, as the loader stops at
 * a scene that is not loaded.
 *
 * @param address - The instanced scene's address.
 * @returns The parsed file, or `null`/`undefined` when it cannot be read.
 *
 * @public
 */
export type PrefabReader = (address: string) => SceneFile | null | undefined;

/**
 * One entity or component inside a prefab instance of a scene file, named by its instance path
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @public
 */
export interface InstanceTarget {
  /** What the path names: an `$entity` or a `$component` reference target. */
  readonly kind: "entity" | "component";
  /**
   * The instance path, `"<carrierUid>/…/<uid>"`: what a `{ "$entity" | "$component": … }`
   * reference in the scene writes to reach the target.
   */
  readonly path: string;
  /** The uid of the scene entity carrying the `instance` entry: the path's first segment. */
  readonly carrier: string;
  /** The address of the prefab file that declares the target, as its `instance` entry names it. */
  readonly address: string;
  /** The target's record in that file, or for a component the record of the entity holding it. */
  readonly entity: SceneFileEntity;
  /** The component's record, or `null` for an entity. */
  readonly component: SceneFileComponent | null;
  /**
   * The display names from the carrier down to {@link InstanceTarget.entity}: the carrier's name
   * first, then each entity's. A prefab's single root merges into the entity instancing it, so it
   * adds no name. A label reads `labels.join(" › ")`, plus the component type for a component.
   */
  readonly labels: readonly string[];
  /**
   * The prefix of an override path on the carrier's `instance` entry that addresses the target:
   * `"<entityUid>/components/<componentPath>"` for a component (append `/props/<field>` or
   * `/enabled`), where the component path is an instance path when the component sits in a nested
   * prefab, and `"<entityUid>"` for an entity of the instanced file itself. `null` for an entity
   * inside a nested prefab, which overrides do not reach.
   */
  readonly overridePath: string | null;
}

/** How many nested files the walk follows, as a guard against pathological files. */
const DEPTH_LIMIT = 16;

/** One file of a frame: a prefab whose content lands on one carrier. */
interface FrameFile {
  /** The address the file was read by. */
  readonly address: string;
  /** The file. */
  readonly file: SceneFile;
  /** The uid of its single root, which merges into the carrier, or `null` for several roots. */
  readonly mergedRoot: string | null;
  /**
   * The instance path, in the outermost instanced file's uids, that override component segments
   * for this file's components start with; `null` for the outermost instanced file itself.
   */
  readonly overrideSegments: readonly string[] | null;
}

/**
 * The prefabs whose content one carrier holds: the one its `instance` entry names, then, while the
 * file has a single root that itself instances a scene (a variant), that scene too. The loader's
 * instance path resolver tries them in this order.
 */
interface Frame {
  /** The files, outermost first. */
  readonly files: readonly FrameFile[];
  /** The names from the scene's carrier down to this frame's carrier. */
  readonly labels: readonly string[];
  /** Every address read on the way here, for the cycle guard. */
  readonly seen: readonly string[];
}

/**
 * Finds the entity or component an instance path names inside a scene file's prefab instances,
 * without loading anything: the rules the loader resolves `$entity` and `$component` references
 * by.
 *
 * @remarks
 * A pure function over files. The path's first segment is the uid of an entity of `scene` that
 * carries an `instance` entry; each later segment but the last names an entity of the prefab
 * reached so far that itself instances a prefab; the last names the target by the uid its own file
 * gives it. A prefab's single root merges into the entity instancing it, so a prefab that root
 * instances is searched at the same level, with no extra segment.
 *
 * @param scene - The scene file holding the path.
 * @param path - The instance path, `"<carrierUid>/…/<uid>"`.
 * @param readScene - Reads the prefab files the path walks through.
 * @param kind - What the reference expects: `"entity"` for `$entity`, `"component"` for
 * `$component`. Omitted, an entity is looked for first, then a component.
 * @returns The target, or `null` when the path is a plain uid or names nothing.
 *
 * @example
 * ```ts
 * const target = resolveInstancePath(sceneFile, "01J…CRATE/01J…LID", (address) => files.get(address));
 * ```
 *
 * @public
 */
export function resolveInstancePath(
  scene: SceneFile,
  path: string,
  readScene: PrefabReader,
  kind?: "entity" | "component",
): InstanceTarget | null {
  const segments = path.split(INSTANCE_PATH_SEPARATOR);
  const head = scene.entities.find((entity) => entity.uid === segments[0]);
  if (segments.length < 2 || head?.instance === undefined) {
    return null;
  }
  let frame = frameOf(head, [head.name], null, readScene, []);
  for (let index = 1; index < segments.length - 1; index += 1) {
    const found = findEntity(frame, segments[index] ?? "");
    if (found === null) {
      return null;
    }
    if (found.entity.uid !== found.file.mergedRoot) {
      frame = frameOf(
        found.entity,
        labelsOf(frame, found.file, found.entity),
        nextSegments(found.file, found.entity.uid),
        readScene,
        frame.seen,
      );
    }
  }
  const last = segments[segments.length - 1] ?? "";
  if (kind !== "component") {
    const found = findEntity(frame, last);
    if (found !== null) {
      return entityTarget(path, head.uid, frame, found.file, found.entity);
    }
  }
  if (kind !== "entity") {
    for (const file of frame.files) {
      for (const entity of file.file.entities) {
        const component = entity.components?.find((candidate) => candidate.uid === last);
        if (component !== undefined) {
          return componentTarget(path, head.uid, frame, file, entity, component);
        }
      }
    }
  }
  return null;
}

/**
 * Lists every entity and component an instance path can reach inside a scene file's prefab
 * instances, with the path, a label chain, and the override path that addresses it.
 *
 * @remarks
 * A pure function over files, for tools such as an editor's reference picker. Each path is the
 * shortest form {@link resolveInstancePath} resolves. A prefab's single root is not listed as an
 * entity: it merges into the carrier, which the scene names by its plain uid; its components are
 * listed. Components an override `add`s are not listed: they keep no uid from a prefab file. The
 * walk stops at a file `readScene` cannot read, at a prefab that would instance itself, and 16
 * files deep.
 *
 * @param scene - The scene file.
 * @param readScene - Reads the prefab files.
 * @returns The targets, in scene order of their carriers, then depth first in file order.
 *
 * @example
 * ```ts
 * const components = enumerateInstanceTargets(sceneFile, (address) => files.get(address)).filter(
 *   (target) => target.kind === "component",
 * );
 * ```
 *
 * @public
 */
export function enumerateInstanceTargets(scene: SceneFile, readScene: PrefabReader): InstanceTarget[] {
  const targets: InstanceTarget[] = [];
  for (const carrier of scene.entities) {
    if (carrier.instance !== undefined) {
      const frame = frameOf(carrier, [carrier.name], null, readScene, []);
      walkFrame(frame, 0, carrier.uid, carrier.uid, readScene, targets);
    }
  }
  return targets;
}

/**
 * Lists the targets of one frame file and, depth first, of the frames below it.
 *
 * @param frame - The frame.
 * @param at - The index of the file to walk.
 * @param prefix - The instance path to the frame's carrier.
 * @param carrier - The scene carrier's uid.
 * @param readScene - Reads nested files.
 * @param into - Collects the targets.
 */
function walkFrame(
  frame: Frame,
  at: number,
  prefix: string,
  carrier: string,
  readScene: PrefabReader,
  into: InstanceTarget[],
): void {
  const file = frame.files[at];
  if (file === undefined) {
    return;
  }
  for (const entity of file.file.entities) {
    const merged = entity.uid === file.mergedRoot;
    if (!merged) {
      into.push(entityTarget(`${prefix}/${entity.uid}`, carrier, frame, file, entity));
    }
    for (const component of entity.components ?? []) {
      into.push(componentTarget(`${prefix}/${component.uid}`, carrier, frame, file, entity, component));
    }
    if (entity.instance === undefined) {
      continue;
    }
    if (merged) {
      walkFrame(frame, at + 1, prefix, carrier, readScene, into);
      continue;
    }
    const nested = frameOf(
      entity,
      labelsOf(frame, file, entity),
      nextSegments(file, entity.uid),
      readScene,
      frame.seen,
    );
    walkFrame(nested, 0, `${prefix}/${entity.uid}`, carrier, readScene, into);
  }
}

/**
 * Reads the frame an entity carrying an `instance` entry holds.
 *
 * @param carrier - The entity.
 * @param labels - The names down to and including the carrier.
 * @param overrideSegments - The override component path prefix for the first file.
 * @param readScene - Reads the files.
 * @param seen - The addresses read on the way here.
 * @returns The frame; empty when the first file cannot be read or would nest itself.
 */
function frameOf(
  carrier: SceneFileEntity,
  labels: readonly string[],
  overrideSegments: readonly string[] | null,
  readScene: PrefabReader,
  seen: readonly string[],
): Frame {
  const files: FrameFile[] = [];
  const addresses = [...seen];
  let current: SceneFileEntity | null = carrier;
  let segments = overrideSegments;
  while (current?.instance !== undefined && addresses.length < DEPTH_LIMIT) {
    const address = current.instance.scene.$asset;
    const file = addresses.includes(address) ? null : readScene(address);
    if (file === null || file === undefined) {
      break;
    }
    addresses.push(address);
    const root = singleRootOf(file);
    files.push({ address, file, mergedRoot: root?.uid ?? null, overrideSegments: segments });
    // The next file merges into the same carrier through this file's root.
    segments ??= root === null ? null : [root.uid];
    current = root;
  }
  return { files, labels, seen: addresses };
}

/**
 * The override component path prefix for the files a non-merged entity of `file` instances.
 *
 * @param file - The frame file declaring the entity.
 * @param uid - The entity's uid.
 * @returns The segments.
 */
function nextSegments(file: FrameFile, uid: string): readonly string[] {
  return file.overrideSegments === null ? [uid] : [...file.overrideSegments, uid];
}

/**
 * Finds an entity of a frame by the uid its file gives it, in the frame's file order.
 *
 * @param frame - The frame.
 * @param uid - The uid.
 * @returns The entity and its file, or `null`.
 */
function findEntity(frame: Frame, uid: string): { readonly file: FrameFile; readonly entity: SceneFileEntity } | null {
  for (const file of frame.files) {
    const entity = file.file.entities.find((candidate) => candidate.uid === uid);
    if (entity !== undefined) {
      return { file, entity };
    }
  }
  return null;
}

/**
 * Builds an entity target.
 *
 * @param path - Its instance path.
 * @param carrier - The scene carrier's uid.
 * @param frame - The frame it was found in.
 * @param file - The frame file declaring it.
 * @param entity - Its record.
 * @returns The target.
 */
function entityTarget(
  path: string,
  carrier: string,
  frame: Frame,
  file: FrameFile,
  entity: SceneFileEntity,
): InstanceTarget {
  return {
    kind: "entity",
    path,
    carrier,
    address: file.address,
    entity,
    component: null,
    labels: labelsOf(frame, file, entity),
    overridePath: file.overrideSegments === null ? entity.uid : null,
  };
}

/**
 * Builds a component target.
 *
 * @param path - Its instance path.
 * @param carrier - The scene carrier's uid.
 * @param frame - The frame it was found in.
 * @param file - The frame file declaring it.
 * @param entity - The record holding it.
 * @param component - Its record.
 * @returns The target.
 */
function componentTarget(
  path: string,
  carrier: string,
  frame: Frame,
  file: FrameFile,
  entity: SceneFileEntity,
  component: SceneFileComponent,
): InstanceTarget {
  const segments = file.overrideSegments;
  return {
    kind: "component",
    path,
    carrier,
    address: file.address,
    entity,
    component,
    labels: labelsOf(frame, file, entity),
    overridePath:
      segments === null
        ? `${entity.uid}/components/${component.uid}`
        : `${segments[0] ?? ""}/components/${[...segments, component.uid].join(INSTANCE_PATH_SEPARATOR)}`,
  };
}

/**
 * The label chain of an entity of a frame file: the frame's names, then the names from the file's
 * root (or, for a single-root file, from below the merged root) down to the entity.
 *
 * @param frame - The frame.
 * @param file - The file declaring the entity.
 * @param entity - The entity.
 * @returns The names, outermost first.
 */
function labelsOf(frame: Frame, file: FrameFile, entity: SceneFileEntity): string[] {
  const names: string[] = [];
  let current: SceneFileEntity | undefined = entity;
  for (let guard = 0; current !== undefined && guard < file.file.entities.length; guard += 1) {
    if (current.uid === file.mergedRoot) {
      break;
    }
    names.unshift(current.name);
    const parent: string | null = current.parent;
    current = parent === null ? undefined : file.file.entities.find((candidate) => candidate.uid === parent);
  }
  return [...frame.labels, ...names];
}

/**
 * The record of a file's only root.
 *
 * @param file - The file.
 * @returns The root, or `null` when the file has none or several.
 */
function singleRootOf(file: SceneFile): SceneFileEntity | null {
  let found: SceneFileEntity | null = null;
  for (const entity of file.entities) {
    if (entity.parent !== null) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    found = entity;
  }
  return found;
}
