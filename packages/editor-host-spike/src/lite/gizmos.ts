// THROWAWAY spike S0.2 — not for merge. The ONLY module of the editor host that imports Babylon Lite
// (CONSTITUTION.md §3.4: Lite only under src/lite/**). Everything else talks to it through the small
// functions exported here, which take and return plain data and opaque handles.
//
// What it builds: one utility layer over the app's render scene; Lite's position / rotation / scale
// gizmos; a selection outline (a 12-edge line box fitted to the selection's world AABB, or Lite's
// bounding-box gizmo when asked for); and the 3D grid (createGridMaterial on a large ground).
import {
  addToScene,
  attachBoundingBoxGizmoToNode,
  attachPositionGizmoToNode,
  attachRotationGizmoToNode,
  attachScaleGizmoToNode,
  createBoundingBoxGizmo,
  createGridMaterial,
  createGround,
  createLines,
  createPositionGizmo,
  createRotationGizmo,
  createScaleGizmo,
  createGpuPicker,
  createUtilityLayer,
  isGizmoDragging,
  isGizmoInteracting,
  isGizmoPickPending,
  onBeforeRender,
  pickAsync,
  registerUtilityLayer,
} from "@babylonjs/lite";
import type {
  BoundingBoxGizmo,
  EngineContext,
  Mesh,
  PointerDrag,
  PositionGizmo,
  RotationGizmo,
  ScaleGizmo,
  SceneContext,
  SceneNode,
  UtilityLayer,
} from "@babylonjs/lite";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoAxis = "x" | "y" | "z" | "uniform";

export interface GizmoDragInfo {
  readonly mode: GizmoMode;
  readonly axis: GizmoAxis;
}

export interface GizmoPointerState {
  /** A collider is hovered or a drag is active (`isGizmoInteracting`, index.d.ts 7482). */
  readonly interacting: boolean;
  /** A drag is active (`isGizmoDragging`, index.d.ts 7476). */
  readonly dragging: boolean;
  /** A pointer-down GPU pick is still in flight (`isGizmoPickPending`, index.d.ts 7488). */
  readonly pickPending: boolean;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface EditorGizmos {
  /** Registers the utility layer; call after `app.start()` registered the render scene. */
  register(): Promise<RegistrationReport>;
  setMode(mode: GizmoMode): void;
  readonly mode: GizmoMode;
  /** Attaches the active gizmo (and the outline) to a node, or detaches with `null`. */
  attach(node: unknown): void;
  onDragStart(listener: (info: GizmoDragInfo) => void): void;
  onDrag(listener: (info: GizmoDragInfo) => void): void;
  onDragEnd(listener: (info: GizmoDragInfo) => void): void;
  pointerState(): GizmoPointerState;
  /** A world point on the given handle of the active gizmo, for tests to aim a synthetic pointer at. */
  handlePoint(axis: GizmoAxis, towards: Point3): Point3 | null;
  /** The world AABB of a node's renderable subtree, or `null` when it has none. */
  worldBounds(node: unknown): { min: Point3; max: Point3 } | null;
  /** How many utility-layer meshes exist (for the frame-cost note). */
  readonly meshCount: number;
}

export interface RegistrationReport {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly workaround: boolean;
  readonly msaaSamples: number;
  readonly mainTasks: unknown[];
  readonly layerTasks: unknown[];
}

export interface EditorGizmoOptions {
  /** false: register the layer plainly (reproduces the black render scene). */
  readonly overlayWorkaround?: boolean;
  /** "lines" (default): a 12-edge line box. "bbox": Lite's interactive BoundingBoxGizmo. */
  readonly outline?: "lines" | "bbox" | "none";
}

const AXES: readonly ("x" | "y" | "z")[] = ["x", "y", "z"];

/** The engine/scene come from `app.lite` (types.ts AppLiteHandles); typed loosely so callers need no Lite types. */
export function createEditorGizmos(engineHandle: unknown, sceneHandle: unknown, options: EditorGizmoOptions = {}): EditorGizmos {
  const engine = engineHandle as EngineContext;
  const mainScene = sceneHandle as SceneContext;
  const canvas = (engine as unknown as { canvas: HTMLCanvasElement }).canvas;
  const layer: UtilityLayer = createUtilityLayer(engine, mainScene);
  const position: PositionGizmo = createPositionGizmo(engine, layer);
  const rotation: RotationGizmo = createRotationGizmo(engine, layer);
  const scale: ScaleGizmo = createScaleGizmo(engine, layer);

  const startListeners: ((info: GizmoDragInfo) => void)[] = [];
  const dragListeners: ((info: GizmoDragInfo) => void)[] = [];
  const endListeners: ((info: GizmoDragInfo) => void)[] = [];
  let mode: GizmoMode = "translate";
  let target: SceneNode | null = null;

  function wire(drag: PointerDrag, info: GizmoDragInfo): void {
    drag.onDragStart.add(() => {
      for (const listener of startListeners) listener(info);
    });
    drag.onDrag.add(() => {
      for (const listener of dragListeners) listener(info);
    });
    drag.onDragEnd.add(() => {
      for (const listener of endListeners) listener(info);
    });
  }
  for (const axis of AXES) {
    wire(position[`${axis}Gizmo`].drag, { mode: "translate", axis });
    wire(rotation[`${axis}Gizmo`].drag, { mode: "rotate", axis });
    wire(scale[`${axis}Gizmo`].drag, { mode: "scale", axis });
  }
  wire(scale.uniformScaleGizmo.drag, { mode: "scale", axis: "uniform" });

  // A detached Lite gizmo keeps its meshes in the utility scene at their last pose and scale — detaching
  // only clears `attachedNode` and disables the drag (axis-drag-gizmo.js attachAxisDragGizmoToNode).
  // There is no public hide, and `setSubtreeVisible(root, true)` would also show the invisible
  // colliders, so a hidden sub-gizmo is collapsed to zero scale. `attachFollowTarget` restores the
  // scale on the next frame after re-attachment.
  const roots = {
    translate: AXES.map((axis) => position[`${axis}Gizmo`].root),
    rotate: AXES.map((axis) => rotation[`${axis}Gizmo`].root),
    scale: [...AXES.map((axis) => scale[`${axis}Gizmo`].root), scale.uniformScaleGizmo.root],
  };
  function collapse(which: GizmoMode): void {
    for (const root of roots[which]) root.scaling.set(0, 0, 0);
  }

  // Outline.
  const outlineMode = options.outline ?? "lines";
  let bbox: BoundingBoxGizmo | null = null;
  let outlineBox: Mesh | null = null;
  if (outlineMode === "bbox") {
    bbox = createBoundingBoxGizmo(engine, layer, { color: [1, 0.6, 0.1] });
  } else if (outlineMode === "lines") {
    const c = [
      { x: -0.5, y: -0.5, z: -0.5 },
      { x: 0.5, y: -0.5, z: -0.5 },
      { x: 0.5, y: -0.5, z: 0.5 },
      { x: -0.5, y: -0.5, z: 0.5 },
      { x: -0.5, y: 0.5, z: -0.5 },
      { x: 0.5, y: 0.5, z: -0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: -0.5, y: 0.5, z: 0.5 },
    ];
    // One polyline that walks all 12 edges (three are walked twice).
    const path = [0, 1, 2, 3, 0, 4, 5, 1, 5, 6, 2, 6, 7, 3, 7, 4].map((index) => c[index] ?? c[0]!);
    outlineBox = createLines(engine, { name: "editor-outline", points: path, color: { r: 1, g: 0.6, b: 0.1, a: 1 } });
    outlineBox.visible = false;
    outlineBox.pickable = false;
    addToScene(layer.scene, outlineBox);
    onBeforeRender(layer.scene, () => {
      if (outlineBox === null) return;
      const bounds = target === null ? null : computeWorldBounds(target, mainScene);
      if (bounds === null) {
        outlineBox.visible = false;
        return;
      }
      outlineBox.visible = true;
      outlineBox.position.set((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2);
      outlineBox.scaling.set(
        Math.max(1e-3, bounds.max.x - bounds.min.x),
        Math.max(1e-3, bounds.max.y - bounds.min.y),
        Math.max(1e-3, bounds.max.z - bounds.min.z),
      );
    });
  }

  function applyAttachment(): void {
    attachPositionGizmoToNode(position, mode === "translate" ? target : null);
    attachRotationGizmoToNode(rotation, mode === "rotate" ? target : null);
    attachScaleGizmoToNode(scale, mode === "scale" ? target : null);
    for (const which of ["translate", "rotate", "scale"] as const) {
      if (which !== mode || target === null) collapse(which);
    }
    if (bbox !== null) attachBoundingBoxGizmoToNode(bbox, target);
  }
  applyAttachment();

  return {
    async register(): Promise<RegistrationReport> {
      // Lite configures an overlay scene against the LAST registered rendering context
      // (scene/swapchain-overlay.js configureSwapchainOverlayScene: `baseScene =
      // surface._renderingContexts[length - 1]`, which must have a frame graph). After `app.start()`
      // ignifx has already registered other contexts behind the render scene (@ignifx/ui's
      // TextRenderer, @ignifx/2d's SpriteRenderer), so a plain registerUtilityLayer finds a context
      // with no frame graph, keeps its own clear, and wipes the render scene to transparent black.
      // Spike workaround on PRIVATE Lite state: detach every context after the render scene,
      // register (so the render scene is the base and the layer draws right after it), re-append.
      const surface = (mainScene as unknown as { surface: { _renderingContexts: unknown[] } }).surface;
      const contexts = surface._renderingContexts;
      const describe = (c: unknown): string =>
        (c as { name?: string }).name ?? ((c as { _frameGraph?: unknown })._frameGraph === undefined ? "context (no frame graph)" : "scene");
      const before = contexts.map(describe);
      const at = contexts.indexOf(mainScene);
      const workaround = options.overlayWorkaround !== false && at >= 0 && at < contexts.length - 1;
      const tail = workaround ? contexts.splice(at + 1) : [];
      await registerUtilityLayer(layer);
      contexts.push(...tail);
      const sc = (surface as unknown as { scRT: unknown; msaaSamples: number }).scRT;
      const tasks = (scene: unknown): unknown[] =>
        ((scene as { _frameGraph?: { _tasks: { name?: string; enabled?: boolean; _config?: { rt?: unknown; rst?: unknown; clr?: boolean } }[] } })._frameGraph?._tasks ?? []).map((t) => ({
          name: t.name ?? null,
          enabled: t.enabled ?? null,
          rtIsSwapchain: t._config?.rt === sc,
          rstIsSwapchain: t._config?.rst === sc,
          clear: t._config?.clr ?? null,
        }));
      return {
        before,
        after: contexts.map(describe),
        workaround,
        msaaSamples: (surface as unknown as { msaaSamples: number }).msaaSamples,
        mainTasks: tasks(mainScene),
        layerTasks: tasks(layer.scene),
      };
    },
    get mode(): GizmoMode {
      return mode;
    },
    setMode(next: GizmoMode): void {
      mode = next;
      applyAttachment();
    },
    attach(node: unknown): void {
      target = (node ?? null) as SceneNode | null;
      applyAttachment();
    },
    onDragStart(listener): void {
      startListeners.push(listener);
    },
    onDrag(listener): void {
      dragListeners.push(listener);
    },
    onDragEnd(listener): void {
      endListeners.push(listener);
    },
    pointerState(): GizmoPointerState {
      return {
        interacting: isGizmoInteracting(canvas),
        dragging: isGizmoDragging(canvas),
        pickPending: isGizmoPickPending(canvas),
      };
    },
    handlePoint(axis: GizmoAxis, towards: Point3): Point3 | null {
      if (target === null) return null;
      const root =
        mode === "translate"
          ? axis === "uniform"
            ? null
            : position[`${axis}Gizmo`].root
          : mode === "rotate"
            ? axis === "uniform"
              ? null
              : rotation[`${axis}Gizmo`].root
            : axis === "uniform"
              ? scale.uniformScaleGizmo.root
              : scale[`${axis}Gizmo`].root;
      if (root === null) return null;
      const s = root.scaling.x;
      const o = root.position;
      if (mode === "rotate") {
        // The ring (torus, diameter 0.6 in root space) lies in the plane normal to the axis. Take the
        // ring point nearest the camera so the press does not land behind the target.
        const candidates =
          axis === "x"
            ? [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: 0, y: -1, z: 0 }]
            : axis === "y"
              ? [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }]
              : [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }];
        let best: Point3 | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const dir of candidates) {
          const p = { x: o.x + dir.x * 0.3 * s, y: o.y + dir.y * 0.3 * s, z: o.z + dir.z * 0.3 * s };
          const distance = Math.hypot(p.x - towards.x, p.y - towards.y, p.z - towards.z);
          if (distance < bestDistance) {
            best = p;
            bestDistance = distance;
          }
        }
        return best;
      }
      if (axis === "uniform") return { x: o.x, y: o.y, z: o.z };
      // Arrow shaft (0..0.275) and head (0.3) run along the axis in root space; aim at the shaft middle-high.
      const along = mode === "scale" ? 0.3 : 0.22;
      const dir = axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      return { x: o.x + dir.x * along * s, y: o.y + dir.y * along * s, z: o.z + dir.z * along * s };
    },
    worldBounds(node: unknown): { min: Point3; max: Point3 } | null {
      return computeWorldBounds(node as SceneNode, mainScene);
    },
    get meshCount(): number {
      return layer.scene.meshes.length;
    },
  };
}

/**
 * World AABB of every mesh under a node, from each mesh's object-local `boundMin`/`boundMax`
 * (index.d.ts, `Mesh` interface, 8191 + 72–73) and its world matrix. Walking `node.children` is not
 * enough: ignifx's Model parents the cloned glTF root with a bare `root.parent = entityNode`
 * (core/src/lite/gpu/gltf.ts:174), which does not append to the parent's `children`, so the entity
 * node looks childless. Like Lite's own bounding-box gizmo (bounding-box-gizmo.js
 * computeBoundsRecursive, `extraCandidates = layer.mainScene.meshes`), the scene's meshes are scanned
 * and kept when their parent chain reaches the node.
 */
function computeWorldBounds(root: SceneNode, scene: SceneContext): { min: Point3; max: Point3 } | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const isUnder = (node: SceneNode): boolean => {
    let p: SceneNode | null = node;
    while (p !== null) {
      if (p === root) return true;
      p = (p.parent ?? null) as SceneNode | null;
    }
    return false;
  };
  for (const mesh of scene.meshes as Mesh[]) {
    if (mesh.boundMin === undefined || mesh.boundMax === undefined || mesh.visible === false || !isUnder(mesh)) continue;
    const m = mesh.worldMatrix;
    const lo = mesh.boundMin;
    const hi = mesh.boundMax;
    for (let corner = 0; corner < 8; corner += 1) {
      const x = corner & 1 ? hi[0] : lo[0];
      const y = corner & 2 ? hi[1] : lo[1];
      const z = corner & 4 ? hi[2] : lo[2];
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * The 3D grid: `createGridMaterial` (index.d.ts 3116) on a 200 m `createGround` (3126), added to the
 * render scene itself so it depth-tests against the level (the utility layer clears depth and would
 * draw it over everything). Unpickable so `app.renderer.pickAsync` sees through it. Call it before
 * `app.start()` so the mesh joins the scene's deferred build.
 */
export function addEditorGrid(engineHandle: unknown, sceneHandle: unknown): { setVisible(visible: boolean): void } {
  const engine = engineHandle as EngineContext;
  const scene = sceneHandle as SceneContext;
  const ground = createGround(engine, { width: 200, height: 200 });
  ground.name = "editor-grid";
  ground.material = createGridMaterial({
    mainColor: [0.16, 0.17, 0.19],
    lineColor: [0.45, 0.48, 0.55],
    gridRatio: 1,
    majorUnitFrequency: 10,
    minorUnitVisibility: 0.45,
    opacity: 0.85,
    backFaceCulling: false,
  });
  ground.pickable = false;
  addToScene(scene, ground);
  return {
    setVisible(visible: boolean): void {
      ground.visible = visible;
    },
  };
}

/** Is this the very object `Transform.localPosition` returns? (Direction-of-truth probe.) */
export function nodeTrs(node: unknown): { position: unknown; rotation: unknown; scaling: unknown } {
  const n = node as SceneNode;
  return { position: n.position, rotation: n.rotationQuaternion, scaling: n.scaling };
}

/** Diagnostic: the node subtree as Lite sees it (names, bounds, tags). */
export function describeSubtree(node: unknown, depth = 4): unknown {
  const n = node as SceneNode & Partial<Mesh>;
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  return {
    name: n.name ?? null,
    isMesh: (n as { _gpu?: unknown })._gpu !== undefined,
    boundMin: n.boundMin ?? null,
    boundMax: n.boundMax ?? null,
    visible: n.visible ?? null,
    tag: meta["ignifx"] ?? null,
    children: depth <= 0 ? (n.children?.length ?? 0) : (n.children ?? []).map((c) => describeSubtree(c, depth - 1)),
  };
}

let rawPicker: ReturnType<typeof createGpuPicker> | null = null;
/** Diagnostic: Lite's own GPU pick on the render scene at CSS px, without ignifx's resolvePick. */
export async function rawPick(sceneHandle: unknown, x: number, y: number): Promise<unknown> {
  rawPicker ??= createGpuPicker(sceneHandle as SceneContext);
  const info = await pickAsync(rawPicker, x, y);
  const chain: unknown[] = [];
  let node: SceneNode | null = info.pickedMesh as SceneNode | null;
  while (node !== null && chain.length < 8) {
    chain.push({ name: node.name ?? null, tag: (node.metadata as Record<string, unknown> | undefined)?.["ignifx"] ?? null });
    node = (node.parent ?? null) as SceneNode | null;
  }
  // How E3 should resolve: the nearest ancestor carrying ignifx's tag.
  const tagged = chain.find((c) => (c as { tag: unknown }).tag !== null) as { tag: { entity: number } } | undefined;
  return { hit: info.hit, distance: info.distance, chain, entityHandle: tagged?.tag.entity ?? null };
}
