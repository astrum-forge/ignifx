/**
 * The scene view's overlay: Babylon Lite's position, rotation and scale gizmos and the selection
 * outline, in core's render overlay over the app's frame, plus a pick that resolves glTF models.
 *
 * This is the only module of the editor host that imports Lite (`CONSTITUTION.md` §3.4). The rest
 * of the host reaches it through {@link createEditorView}, which takes and returns ignifx objects
 * and plain data. Every Lite claim here was read from the pinned `@babylonjs/lite` 1.34
 * `index.d.ts`; the behaviours are the ones spike S0.2 measured (editor repository,
 * `docs/research/spikes/s0.2-gizmos-and-cameras.md`).
 */

import {
  addToScene,
  attachPositionGizmoToNode,
  attachRotationGizmoToNode,
  attachScaleGizmoToNode,
  createGpuPicker,
  createLines,
  createPositionGizmo,
  createRotationGizmo,
  createScaleGizmo,
  isGizmoDragging,
  isGizmoInteracting,
  isGizmoPickPending,
  onBeforeRender,
  pickAsync,
  setPositionGizmoLocalCoordinates,
  setRotationGizmoLocalCoordinates,
  setScaleGizmoLocalCoordinates,
} from "@babylonjs/lite";
import type { GpuPicker, Mesh, PointerDrag, SceneContext, SceneNode, Vec3 } from "@babylonjs/lite";
import type { AppLiteHandles, Entity, RenderOverlay } from "@ignifx/core";

/** What a gizmo drag does. */
export type ViewGizmoMode = "translate" | "rotate" | "scale";

/** Which handle of the gizmo is dragged. */
export type ViewGizmoAxis = "x" | "y" | "z" | "uniform";

/** One sub-gizmo's drag. */
export interface ViewDrag {
  /** The gizmo's mode. */
  readonly mode: ViewGizmoMode;
  /** The handle. */
  readonly axis: ViewGizmoAxis;
}

/** Where Lite's gizmo dispatcher is with the current pointer gesture, for the editor camera. */
export interface ViewPointerState {
  /** A handle is hovered or dragged: a press there belongs to the gizmo. */
  readonly interacting: boolean;
  /** A gizmo drag is active. */
  readonly dragging: boolean;
  /** The dispatcher is still picking under the last press. */
  readonly pickPending: boolean;
}

/** An axis-aligned box in world space, in metres. */
export interface WorldBounds {
  /** The low corner. */
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  /** The high corner. */
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/** What a raw pick hit. */
export interface ViewPick {
  /** The entity that owns the nearest tagged ancestor of the picked mesh. */
  readonly entity: Entity;
  /** The world-space hit point, when Lite reports one. */
  readonly point: readonly [number, number, number] | null;
  /** How far along the ray the hit is, in metres. */
  readonly distance: number;
}

/** The overlay of one scene view. */
export interface EditorView {
  /**
   * Sets what the gizmo does; `null` hides every gizmo.
   *
   * @param mode - The mode, or `null` for none.
   */
  setMode(mode: ViewGizmoMode | null): void;
  /**
   * Sets whether the gizmo follows the entity's own axes.
   *
   * @param local - `true` for local axes, `false` for world axes.
   */
  setLocal(local: boolean): void;
  /**
   * Attaches the gizmo to an entity, or detaches it.
   *
   * @param entity - The primary selection, or `null`.
   */
  attach(entity: Entity | null): void;
  /**
   * Outlines entities with a line box over each one's world bounds.
   *
   * @param entities - The selection.
   */
  outline(entities: readonly Entity[]): void;
  /**
   * Shows or hides the gizmo and the outline, for a capture without them.
   *
   * @param visible - Whether they draw.
   */
  setVisible(visible: boolean): void;
  /**
   * Subscribes to every handle's drag start, move and end.
   *
   * @param listener - Receives the phase and the drag.
   */
  onDrag(listener: (phase: "start" | "move" | "end", drag: ViewDrag) => void): void;
  /**
   * Reads the gizmo dispatcher's state for the current pointer gesture.
   *
   * @returns The state.
   */
  pointerState(): ViewPointerState;
  /**
   * The world bounds of the meshes under an entity, glTF models included.
   *
   * @param entity - The entity.
   * @returns The box, or `null` when nothing under it is drawn.
   */
  worldBounds(entity: Entity): WorldBounds | null;
  /**
   * Picks the render scene at a CSS pixel and resolves the hit through the picked mesh's ancestors.
   *
   * @param x - The CSS pixel x, from the canvas's left edge.
   * @param y - The CSS pixel y, from the canvas's top edge.
   * @param owner - Maps a Lite node (by identity, an entity's `transform.lite`) to its entity, or `null`.
   * @returns The hit, or `null` for a miss.
   */
  pick(x: number, y: number, owner: (node: object) => Entity | null): Promise<ViewPick | null>;
  /** Disposes the overlay and everything in it. */
  dispose(): void;
}

/** The three axes of a gizmo. */
const AXES: readonly ("x" | "y" | "z")[] = ["x", "y", "z"];

/** The outline's colour: the editor's selection orange. */
const OUTLINE_COLOR = { r: 1, g: 0.6, b: 0.1, a: 1 };

/** A unit cube's corners, centred on the origin. */
const CORNERS: readonly Vec3[] = [
  { x: -0.5, y: -0.5, z: -0.5 },
  { x: 0.5, y: -0.5, z: -0.5 },
  { x: 0.5, y: -0.5, z: 0.5 },
  { x: -0.5, y: -0.5, z: 0.5 },
  { x: -0.5, y: 0.5, z: -0.5 },
  { x: 0.5, y: 0.5, z: -0.5 },
  { x: 0.5, y: 0.5, z: 0.5 },
  { x: -0.5, y: 0.5, z: 0.5 },
];

/** One polyline over all twelve edges of a cube (three are walked twice), as corner indices. */
const OUTLINE_PATH: readonly number[] = [0, 1, 2, 3, 0, 4, 5, 1, 5, 6, 2, 6, 7, 3, 7, 4];

/** The smallest outline side, so a flat or empty box stays visible. */
const MIN_OUTLINE_SIDE = 1e-3;

/**
 * Builds the overlay of one scene view.
 *
 * @remarks
 * The gizmos and the outline live in core's render overlay (`app.renderer.openOverlay()`, ADR-0031),
 * whose Lite scenes have the shape Lite's gizmo constructors take as a utility layer. Core draws it
 * over the finished frame at every MSAA setting; Lite's own utility layer blacks out the scene or
 * draws nothing in an ignifx app (S0.2 §3.2).
 *
 * A detached Lite gizmo keeps drawing at its last pose, so a hidden sub-gizmo is collapsed to zero
 * scale; Lite restores the scale when it is attached again (S0.2 §3.3). The outline is a line box,
 * because Lite's bounding-box gizmo drags whatever is pressed inside it (S0.2 §7).
 *
 * @param handles - The app's Lite engine and render scene (`app.lite`).
 * @param overlay - An open render overlay of the same app, which the view now owns.
 * @param canvas - The canvas the gizmo dispatcher listens on.
 * @returns The view.
 */
export function createEditorView(
  handles: AppLiteHandles,
  overlay: RenderOverlay,
  canvas: HTMLCanvasElement,
): EditorView {
  const { engine, scene } = handles;
  const layer = overlay.lite;
  const position = createPositionGizmo(engine, layer);
  const rotation = createRotationGizmo(engine, layer);
  const scale = createScaleGizmo(engine, layer);
  const listeners: ((phase: "start" | "move" | "end", drag: ViewDrag) => void)[] = [];
  const outlines: Mesh[] = [];
  let outlined: readonly Entity[] = [];
  let mode: ViewGizmoMode | null = "translate";
  let target: SceneNode | null = null;
  let visible = true;
  let picker: GpuPicker | null = null;

  const wire = (drag: PointerDrag, info: ViewDrag): void => {
    const emit = (phase: "start" | "move" | "end"): void => {
      for (const listener of listeners) {
        listener(phase, info);
      }
    };
    drag.onDragStart.add(() => {
      emit("start");
    });
    drag.onDrag.add(() => {
      emit("move");
    });
    drag.onDragEnd.add(() => {
      emit("end");
    });
  };
  for (const axis of AXES) {
    wire(position[`${axis}Gizmo`].drag, { mode: "translate", axis });
    wire(rotation[`${axis}Gizmo`].drag, { mode: "rotate", axis });
    wire(scale[`${axis}Gizmo`].drag, { mode: "scale", axis });
  }
  wire(scale.uniformScaleGizmo.drag, { mode: "scale", axis: "uniform" });

  const roots: Readonly<Record<ViewGizmoMode, readonly SceneNode[]>> = {
    translate: AXES.map((axis) => position[`${axis}Gizmo`].root),
    rotate: AXES.map((axis) => rotation[`${axis}Gizmo`].root),
    scale: [...AXES.map((axis) => scale[`${axis}Gizmo`].root), scale.uniformScaleGizmo.root],
  };

  const applyAttachment = (): void => {
    const shown = visible ? mode : null;
    attachPositionGizmoToNode(position, shown === "translate" ? target : null);
    attachRotationGizmoToNode(rotation, shown === "rotate" ? target : null);
    attachScaleGizmoToNode(scale, shown === "scale" ? target : null);
    for (const which of ["translate", "rotate", "scale"] as const) {
      if (which !== shown || target === null) {
        for (const root of roots[which]) {
          root.scaling.set(0, 0, 0);
        }
      }
    }
  };
  applyAttachment();

  const outlineMesh = (index: number): Mesh => {
    const existing = outlines[index];
    if (existing !== undefined) {
      return existing;
    }
    const mesh = createLines(engine, {
      name: "ignifx-editor-outline",
      points: OUTLINE_PATH.map((corner) => CORNERS[corner] ?? { x: 0, y: 0, z: 0 }),
      color: OUTLINE_COLOR,
    });
    mesh.pickable = false;
    mesh.visible = false;
    addToScene(layer.scene, mesh);
    outlines.push(mesh);
    return mesh;
  };

  onBeforeRender(layer.scene, () => {
    for (const [index, mesh] of outlines.entries()) {
      const entity = visible ? outlined[index] : undefined;
      const bounds =
        entity === undefined || entity.isDestroyed ? null : computeWorldBounds(entity.transform.lite, scene);
      if (bounds === null) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      );
      mesh.scaling.set(
        Math.max(MIN_OUTLINE_SIDE, bounds.max.x - bounds.min.x),
        Math.max(MIN_OUTLINE_SIDE, bounds.max.y - bounds.min.y),
        Math.max(MIN_OUTLINE_SIDE, bounds.max.z - bounds.min.z),
      );
    }
  });

  return {
    setMode(next: ViewGizmoMode | null): void {
      mode = next;
      applyAttachment();
    },
    setLocal(local: boolean): void {
      setPositionGizmoLocalCoordinates(position, local);
      setRotationGizmoLocalCoordinates(rotation, local);
      setScaleGizmoLocalCoordinates(scale, local);
    },
    attach(entity: Entity | null): void {
      target = entity === null ? null : entity.transform.lite;
      applyAttachment();
    },
    outline(entities: readonly Entity[]): void {
      outlined = [...entities];
      for (let index = 0; index < entities.length; index += 1) {
        outlineMesh(index);
      }
      for (const mesh of outlines.slice(entities.length)) {
        mesh.visible = false;
      }
    },
    setVisible(next: boolean): void {
      visible = next;
      applyAttachment();
      if (!next) {
        for (const mesh of outlines) {
          mesh.visible = false;
        }
      }
    },
    onDrag(listener): void {
      listeners.push(listener);
    },
    pointerState(): ViewPointerState {
      return {
        interacting: isGizmoInteracting(canvas),
        dragging: isGizmoDragging(canvas),
        pickPending: isGizmoPickPending(canvas),
      };
    },
    worldBounds(entity: Entity): WorldBounds | null {
      return computeWorldBounds(entity.transform.lite, scene);
    },
    async pick(x: number, y: number, owner: (node: object) => Entity | null): Promise<ViewPick | null> {
      picker ??= createGpuPicker(scene);
      const info = await pickAsync(picker, x, y);
      // A glTF model tags only its cloned root, so the picked mesh is walked up to the nearest node
      // an entity owns (S0.2 §6.1; engine ask E3).
      for (let node: object | null = info.hit ? info.pickedMesh : null; node !== null; node = parentNode(node)) {
        const entity = owner(node);
        if (entity !== null) {
          return { entity, point: info.pickedPoint, distance: info.distance };
        }
      }
      return null;
    },
    dispose(): void {
      listeners.length = 0;
      overlay.dispose();
    },
  };
}

/**
 * A node's parent. Lite types it as a bare world-matrix provider, so it is followed by identity only.
 *
 * @param node - The node.
 * @returns The parent, or `null` at a root.
 */
function parentNode(node: object): object | null {
  const parent: unknown = Reflect.get(node, "parent");
  return typeof parent === "object" && parent !== null ? parent : null;
}

/**
 * The world bounds of every visible mesh whose parent chain reaches a node.
 *
 * @remarks
 * Walking `node.children` is not enough: a `Model` parents its cloned glTF root with a bare
 * `parent` assignment, which leaves the entity node's `children` empty (S0.2 §6.1). So the scene's
 * meshes are scanned and kept when their parent chain reaches the node, as Lite's own bounding-box
 * gizmo does.
 *
 * @param root - The entity's node.
 * @param scene - The render scene.
 * @returns The box, or `null` when nothing under the node is drawn.
 */
function computeWorldBounds(root: SceneNode, scene: SceneContext): WorldBounds | null {
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  const isUnder = (node: object): boolean => {
    for (let current: object | null = node; current !== null; current = parentNode(current)) {
      if (current === root) {
        return true;
      }
    }
    return false;
  };
  for (const mesh of scene.meshes) {
    const low = mesh.boundMin;
    const high = mesh.boundMax;
    if (low === undefined || high === undefined || mesh.visible === false || !isUnder(mesh)) {
      continue;
    }
    const m = mesh.worldMatrix;
    for (let corner = 0; corner < 8; corner += 1) {
      const x = (corner & 1) === 0 ? low[0] : high[0];
      const y = (corner & 2) === 0 ? low[1] : high[1];
      const z = (corner & 4) === 0 ? low[2] : high[2];
      const wx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
      const wy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
      const wz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
      min.x = Math.min(min.x, wx);
      min.y = Math.min(min.y, wy);
      min.z = Math.min(min.z, wz);
      max.x = Math.max(max.x, wx);
      max.y = Math.max(max.y, wy);
      max.z = Math.max(max.z, wz);
    }
  }
  return Number.isFinite(min.x) ? { min, max } : null;
}
