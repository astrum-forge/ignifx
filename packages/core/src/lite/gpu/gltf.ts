import { addToScene, cloneTransformNode, loadGltf, removeFromScene } from "@babylonjs/lite";
import type { AnimationGroup, AssetContainer, EngineContext, SceneContext, SceneNode, Skeleton } from "@babylonjs/lite";

/**
 * glTF half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.4): loading a
 * `.glb` into an asset container, and instantiating that container under an entity node.
 *
 * Everything here is `@internal`. `loadGltf` uploads vertex buffers and textures, so the module is
 * GPU-only.
 *
 * ## What a container holds (verified against `@babylonjs/lite@1.27.0`)
 *
 * `loadGltf(engine, source)` (`index.d.ts` 6821) takes a URL, an `ArrayBuffer`, or a `Blob` and
 * resolves to an `AssetContainer` (`index.d.ts` 653) whose `entities` is `[rootTransformNode]` for
 * glTF. The ignifx asset layer fetches the bytes itself — that is where progress reporting and
 * `AbortSignal` support live (`docs/architecture/05-assets-and-loading.md`) — and hands Lite an
 * `ArrayBuffer`, so this adapter never fetches.
 *
 * ## Animation groups are stripped, not ticked
 *
 * `addToScene` pushes a container's `animationGroups` onto the scene and installs a before-render
 * hook that calls `tickAnimation` for each one (`lib/scene/scene-core.js`). ADR-0003 says ignifx
 * owns time, so {@link takeAnimationGroups} removes them from the container *before* it is added:
 * Lite then registers no hook, and ignifx's animation system advances the clips itself.
 *
 * ## Instancing
 *
 * `cloneTransformNode` on the container root deep-clones the transform hierarchy while every mesh
 * in it shares the original's `_gpu` wrapper and bumps its reference count
 * (`lib/scene/transform-node.js`) — so N instances of a model upload one copy of the geometry. Lights
 * inside the subtree are shallow-copied as plain objects rather than cloned; glTF cameras are only
 * present at all when `enableGltfCameras()` ran before the load.
 */

/**
 * The Babylon Lite asset container a `ModelAsset` holds, re-exported under an ignifx name
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteAssetContainer = AssetContainer;

/**
 * A Babylon Lite animation clip, re-exported under an ignifx name. `Model.animations` hands these
 * to `@ignifx/3d`'s animator, which owns advancement (ADR-0003).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @beta
 */
export type LiteAnimationGroup = AnimationGroup;

/**
 * A Babylon Lite skeleton, re-exported under an ignifx name. Present on a container only when
 * `enableBoneControl()` ran before the load (`index.d.ts` 653).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @beta
 */
export type LiteSkeleton = Skeleton;

/** The suffix `cloneTransformNode` appends to every cloned node's name. */
const CLONE_SUFFIX = "_clone";

/**
 * An instantiated model: the cloned subtree, the nodes worth addressing by name, and the clips.
 *
 * @internal
 */
export interface ModelInstance {
  /** The cloned container root, parented under the entity's node. */
  readonly root: SceneNode;
  /** Every named node in the clone, by its glTF node name. Later duplicates of a name are ignored. */
  readonly nodesByName: ReadonlyMap<string, SceneNode>;
}

/**
 * Loads a glTF or GLB asset from bytes already in memory.
 *
 * @param engine - The engine that will own the GPU resources.
 * @param bytes - The `.glb` or `.gltf` bytes, as fetched by the asset layer.
 * @returns The container. Instantiate it with {@link instantiateContainer}.
 *
 * @example
 * ```ts
 * const bytes = await (await fetch(url, { signal })).arrayBuffer();
 * const container = await loadGltfFromBytes(engine, bytes);
 * ```
 *
 * @internal
 */
export function loadGltfFromBytes(engine: EngineContext, bytes: ArrayBuffer): Promise<AssetContainer> {
  return loadGltf(engine, bytes);
}

/**
 * Loads a glTF or GLB asset from a URL, letting Lite do the fetching.
 *
 * @remarks
 * Used only where the asset layer's progress and cancellation are not wanted — benchmarks and
 * tests. Production loading goes through {@link loadGltfFromBytes}.
 *
 * @param engine - The engine that will own the GPU resources.
 * @param url - Where to fetch the asset from.
 * @returns The container.
 *
 * @internal
 */
export function loadGltfFromUrl(engine: EngineContext, url: string): Promise<AssetContainer> {
  return loadGltf(engine, url);
}

/**
 * Removes a container's animation clips so that adding it to a scene does not make Lite tick them.
 *
 * @remarks
 * Call this **before** {@link addContainerToScene} or {@link instantiateContainer}. ADR-0003: ignifx
 * drives every clock, including animation.
 *
 * @param container - The freshly loaded container.
 * @returns The clips that were removed, in load order. Empty when the file declared none.
 *
 * @internal
 */
export function takeAnimationGroups(container: AssetContainer): readonly AnimationGroup[] {
  const groups = container.animationGroups;
  if (groups === undefined || groups.length === 0) {
    return [];
  }
  const taken = groups.slice();
  container.animationGroups = [];
  return taken;
}

/**
 * Clones a container's subtree under an entity node, ready to be added to a scene.
 *
 * @remarks
 * The container itself stays pristine and acts as the template, so the first instance costs a clone
 * just like the tenth and the asset can outlive any one of them. Every mesh in the clone shares the
 * template's GPU buffers.
 *
 * @param container - The loaded container.
 * @param parent - The entity's transform node, or `null` for world space.
 * @returns The cloned root and its named nodes, or `null` when the container has no scene-node
 * root — a file that declared only lights, for instance.
 *
 * @internal
 */
export function instantiateContainer(container: AssetContainer, parent: SceneNode | null): ModelInstance | null {
  const entities = container.entities;
  let template: SceneNode | null = null;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity !== undefined && !("lightType" in entity)) {
      template = entity;
      break;
    }
  }
  if (template === null) {
    return null;
  }
  const root = cloneTransformNode(template);
  root.parent = parent;
  const nodesByName = new Map<string, SceneNode>();
  collectNames(root, nodesByName);
  return { root, nodesByName };
}

/**
 * Adds a whole container to a scene, the simple path for a model with exactly one instance.
 *
 * @param scene - The render scene.
 * @param container - The container to add.
 *
 * @internal
 */
export function addContainerToScene(scene: SceneContext, container: AssetContainer): void {
  addToScene(scene, container);
}

/**
 * Removes a whole container from a scene, releasing every mesh that has left its last scene.
 *
 * @param scene - The render scene.
 * @param container - The container to remove.
 *
 * @internal
 */
export function removeContainerFromScene(scene: SceneContext, container: AssetContainer): void {
  removeFromScene(scene, container);
}

/**
 * Indexes a cloned subtree by node name.
 *
 * @remarks
 * `cloneTransformNode` appends `"_clone"` to every name it copies
 * (`lib/scene/transform-node.js`), so the suffix is stripped here and the map is keyed by the
 * original glTF node names the `Model` component promises.
 *
 * @param node - The subtree root.
 * @param out - The map to fill.
 */
function collectNames(node: SceneNode, out: Map<string, SceneNode>): void {
  const name = node.name.endsWith(CLONE_SUFFIX) ? node.name.slice(0, -CLONE_SUFFIX.length) : node.name;
  if (name.length > 0 && !out.has(name)) {
    out.set(name, node);
  }
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child !== undefined) {
      collectNames(child, out);
    }
  }
}
