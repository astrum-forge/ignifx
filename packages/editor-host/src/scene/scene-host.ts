/**
 * The scene methods and notifications of protocol 0.3: what the scene view's host does with the
 * editor's document (`docs/architecture/17-editor-host.md` §6).
 */

import { Camera, canonicalizeNumber, isIgnifxError, validateSceneFile } from "@ignifx/core";
import { InvalidParamsError, Reply, RpcFailure } from "../channel.js";
import { createEditorView } from "../lite/gizmos.js";
import {
  GizmoMode,
  GizmoSpace,
  HostCapability,
  isApplyOpsParams,
  isEntitySelection,
  isFrameParams,
  isOpenSceneParams,
  isPickParams,
  isReadBackParams,
  isScreenshotParams,
  isSetGizmoParams,
  isSetViewModeParams,
  RpcErrorCode,
  SCREENSHOT_MAX_SIZE,
  SceneMethod,
  SceneNotification,
  TRANSFORM_DRAGGING_INTERVAL_MS,
  ViewMode,
} from "../protocol/index.js";
import { DocumentMirror } from "./document.js";
import { EDITOR_CAMERA_FOV, EditorCamera } from "./editor-camera.js";
import { applyOps } from "./ops.js";
import { schemaSet } from "./schemas.js";
import { encodeCapture } from "./screenshot.js";
import {
  DragSnapper,
  readLocalTransform,
  sameTransform,
  screenshotSize,
  toCssPixels,
  viewSurfaceOf,
} from "./view-math.js";
import type { RequestHandler } from "../channel.js";
import type { ViewClick } from "./editor-camera.js";
import type { EditorView, ViewDrag, WorldBounds } from "../lite/gizmos.js";
import type {
  GizmoDragMode,
  GizmoSnap,
  HostErrorParams,
  HotReloadedParams,
  LogParams,
  PickResult,
  SceneFileTransform,
  SchemaSet,
  ScreenshotResult,
} from "../protocol/index.js";
import type { App, Entity, HotReloadReport, RenderSurface, SceneInstance } from "@ignifx/core";

/** The name of the host's persistent scene instance for its own objects. */
export const EDITOR_SCENE_NAME = "editor";

/** The editor camera's priority: above any camera a document can hold. */
const EDITOR_CAMERA_PRIORITY = 1_000_000;

/** What the scene host needs from the host that owns it. */
export interface SceneHostOptions {
  /** The capabilities the host announces in `ready`; the methods follow them. */
  readonly capabilities: readonly string[];
  /**
   * Sends a notification on the current port, or drops it when no editor is ready.
   *
   * @param method - The notification.
   * @param params - Its parameters.
   */
  readonly notify: (method: string, params: unknown) => void;
}

/** The gizmo's settings, as `setGizmo` last set them. */
interface GizmoSettings {
  /** What it does. */
  readonly mode: GizmoMode;
  /** Which axes it follows. */
  readonly space: GizmoSpace;
  /** The snapping steps, or `null`. */
  readonly snap: GizmoSnap | null;
}

/** One gizmo drag in progress. */
interface DragState {
  /** The dragged entity. */
  readonly entity: Entity;
  /** The drag's mode. */
  readonly mode: GizmoDragMode;
  /** The local transform at drag start. */
  readonly before: SceneFileTransform;
  /** The snapping, or `null`. */
  readonly snapper: DragSnapper | null;
  /** When the last `transformDragging` went out, in milliseconds. */
  lastSentMs: number;
}

/**
 * Turns whatever a hot reload or the app threw into a message.
 *
 * @param error - The thrown value.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the scene methods against one app, and sends the notifications the app causes.
 *
 * @remarks
 * The host builds it before the app exists, so the channel can answer `hello` at once; every scene
 * method answers `notReady` until {@link SceneHost.start} has run (protocol 0.3, "Not before the
 * app has started").
 */
export class SceneHost {
  /** The scene methods, by name, for the channel. */
  readonly methods: ReadonlyMap<string, RequestHandler>;

  readonly #notify: (method: string, params: unknown) => void;

  #app: App | null = null;

  #mirror: DocumentMirror | null = null;

  #editorScene: SceneInstance | null = null;

  #camera: EditorCamera | null = null;

  #canvas: RenderSurface | null = null;

  #view: EditorView | null = null;

  #selection: readonly string[] = [];

  #gizmo: GizmoSettings = { mode: GizmoMode.translate, space: GizmoSpace.world, snap: null };

  #drag: DragState | null = null;

  #started = false;

  readonly #cleanups: (() => void)[] = [];

  /**
   * Creates the methods; none answers until the app has started.
   *
   * @param options - The capabilities and the notification sink.
   */
  constructor(options: SceneHostOptions) {
    this.#notify = options.notify;
    const has = (capability: string): boolean => options.capabilities.includes(capability);
    const methods = new Map<string, RequestHandler>([
      [SceneMethod.openScene, async (params) => this.#openScene(params)],
      [SceneMethod.closeScene, async () => this.#closeScene()],
      [SceneMethod.applyOps, async (params) => this.#applyOps(params)],
      [SceneMethod.readBack, (params) => this.#readBack(params)],
      [SceneMethod.select, (params) => this.#select(params)],
      [SceneMethod.frame, (params) => this.#frame(params)],
      [SceneMethod.pick, async (params) => this.#pick(params)],
      [SceneMethod.getSchemas, () => this.#getSchemas()],
      [SceneMethod.setViewMode, (params) => this.#setViewMode(params)],
    ]);
    if (has(HostCapability.gizmos)) {
      methods.set(SceneMethod.setGizmo, (params) => this.#setGizmo(params));
    }
    if (has(HostCapability.screenshot)) {
      methods.set(SceneMethod.screenshot, async (params) => this.#screenshot(params));
    }
    this.methods = methods;
  }

  /**
   * The persistent scene instance that holds the host's own objects, such as the editor camera.
   *
   * @returns The instance, or `null` before {@link SceneHost.prepare}.
   */
  get editorScene(): SceneInstance | null {
    return this.#editorScene;
  }

  /**
   * Prepares the app before it starts: the persistent `editor` scene with the editor camera, and
   * the log, error and hot-reload relays.
   *
   * @param app - The scene view's app, created and not yet started.
   */
  prepare(app: App): void {
    this.#app = app;
    this.#mirror = new DocumentMirror(app);
    const scene = app.world.createScene(EDITOR_SCENE_NAME, { persistent: true });
    this.#editorScene = scene;
    app.registerComponents([EditorCamera]);
    const eye = app.world.createEntity("Editor Camera", { scene });
    eye.addComponent(Camera, { fov: EDITOR_CAMERA_FOV, near: 0.05, far: 5000, priority: EDITOR_CAMERA_PRIORITY });
    const camera = eye.addComponent(EditorCamera);
    camera.apply();
    this.#camera = camera;
    this.#cleanups.push(
      app.log.addSink({
        write: (record): void => {
          const params: LogParams = {
            level: record.level,
            scope: record.scope,
            message: record.message,
            timeMs: record.timeMs,
          };
          this.#notify(SceneNotification.log, params);
        },
      }),
      app.onError.connect((report) => {
        const params: HostErrorParams = {
          code: isIgnifxError(report.error) ? report.error.code : null,
          message: messageOf(report.error),
          data: { source: report.source, phase: report.phase, entity: report.entity?.uid ?? null },
        };
        this.#notify(SceneNotification.hostError, params);
      }),
      app.hotReload.onApplied.connect((report) => {
        this.#hotReloaded(report);
      }),
    );
  }

  /**
   * Finishes setting up once the app has started: the gizmos and the outline on a canvas, the
   * camera's controls, and the first `schemasChanged`.
   *
   * @param canvas - The view's canvas, or `null` for a headless host.
   * @throws Whatever registering Lite's utility layer throws.
   */
  async start(canvas: RenderSurface | null): Promise<void> {
    const app = this.#requireApp();
    this.#canvas = canvas;
    if (canvas !== null && !app.isHeadless && this.methods.has(SceneMethod.setGizmo) && isDomCanvas(canvas)) {
      const view = createEditorView(app.lite, canvas);
      await view.register();
      view.onDrag((phase, drag) => {
        this.#onDrag(phase, drag);
      });
      this.#view = view;
      this.#applyGizmo();
      const camera = this.#camera;
      if (camera !== null) {
        camera.claims = view;
        camera.onClick = (click): void => {
          void this.#onClick(click);
        };
        camera.bind(canvas);
      }
    }
    this.#started = true;
    this.sendSchemas();
  }

  /** Sends `schemasChanged` once the app has started; the channel calls it after each `ready`. */
  sendSchemas(): void {
    if (this.#started) {
      this.#notify(SceneNotification.schemasChanged, this.#schemas());
    }
  }

  /** Removes the relays and the overlay; the host disposes the app. */
  dispose(): void {
    for (const cleanup of this.#cleanups.splice(0)) {
      cleanup();
    }
    this.#view?.dispose();
    this.#view = null;
  }

  // -------------------------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------------------------

  /**
   * `openScene`: replaces the open document with the editor's file.
   *
   * @param params - `{ file, address }`.
   * @returns The entity count and warnings, then `sceneOpened`.
   */
  async #openScene(params: unknown): Promise<Reply> {
    const mirror = this.#requireMirror(SceneMethod.openScene);
    this.#setSelection([]);
    const file: unknown = typeof params === "object" && params !== null ? Reflect.get(params, "file") : undefined;
    const issues = file === undefined ? [] : validateSceneFile(file);
    if (issues.length > 0) {
      await mirror.close();
      const list = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      throw new InvalidParamsError(`The scene file is not valid: ${list}`, { issues });
    }
    if (!isOpenSceneParams(params)) {
      throw new InvalidParamsError("openScene takes { file: SceneFile, address: string | null }.");
    }
    const result = await mirror.open(params.file, params.address);
    return new Reply(result, () => {
      this.#notify(SceneNotification.sceneOpened, {
        address: params.address,
        name: mirror.name,
        entityCount: result.entityCount,
        warnings: result.warnings,
      });
    });
  }

  /**
   * `closeScene`: unloads the open document, if any.
   *
   * @returns `null`.
   */
  async #closeScene(): Promise<null> {
    const mirror = this.#requireMirror(SceneMethod.closeScene);
    this.#setSelection([]);
    await mirror.close();
    return null;
  }

  /**
   * `applyOps`: one command's ops, in order.
   *
   * @param params - `{ ops, commandName, commandId }`.
   * @returns How many applied, and the failures.
   */
  async #applyOps(params: unknown): Promise<unknown> {
    const mirror = this.#requireMirror(SceneMethod.applyOps);
    if (!isApplyOpsParams(params)) {
      throw new InvalidParamsError("applyOps takes { ops: SceneOp[], commandName, commandId }.");
    }
    this.#requireOpen(SceneMethod.applyOps);
    const result = await applyOps(this.#requireApp(), mirror, params);
    this.#setSelection(this.#selection);
    return result;
  }

  /**
   * `readBack`: the open document as the live world has it.
   *
   * @param params - `{ entities? }`.
   * @returns The records, the missing uids, the settings, and the serializer's issues.
   */
  #readBack(params: unknown): unknown {
    const mirror = this.#requireMirror(SceneMethod.readBack);
    if (!isReadBackParams(params)) {
      throw new InvalidParamsError("readBack takes { entities?: uid[] }.");
    }
    this.#requireOpen(SceneMethod.readBack);
    return mirror.readBack(params);
  }

  /**
   * `select`: the selection the view outlines and the gizmo follows.
   *
   * @param params - `{ entities }`.
   * @returns The selection kept: the document's uids, in order, without duplicates.
   */
  #select(params: unknown): unknown {
    const mirror = this.#requireMirror(SceneMethod.select);
    if (!isEntitySelection(params)) {
      throw new InvalidParamsError("select takes { entities: uid[] }.");
    }
    const index = mirror.index();
    const kept = [...new Set(params.entities)].filter((uid) => index?.entities.has(uid) === true);
    this.#setSelection(kept);
    return { entities: kept };
  }

  /**
   * `setGizmo`: the gizmo's mode, axes and snapping.
   *
   * @param params - `{ mode, space, snap }`.
   * @returns `null`.
   */
  #setGizmo(params: unknown): null {
    this.#requireMirror(SceneMethod.setGizmo);
    if (!isSetGizmoParams(params)) {
      throw new InvalidParamsError(
        'setGizmo takes { mode, space: "local" | "world", snap: { translate, rotate, scale } | null }.',
      );
    }
    this.#gizmo = { mode: params.mode, space: params.space, snap: params.snap };
    this.#applyGizmo();
    return null;
  }

  /**
   * `frame`: fits entities in the editor camera's view.
   *
   * @param params - `{ entities: uid[] | "all" }`.
   * @returns `null`.
   */
  #frame(params: unknown): null {
    const mirror = this.#requireMirror(SceneMethod.frame);
    if (!isFrameParams(params)) {
      throw new InvalidParamsError('frame takes { entities: uid[] | "all" }.');
    }
    this.#requireOpen(SceneMethod.frame);
    const index = mirror.index();
    const entities =
      params.entities === "all"
        ? [...(mirror.scene?.roots ?? [])]
        : params.entities.flatMap((uid) => {
            const entity = index?.entities.get(uid);
            return entity === undefined ? [] : [entity];
          });
    const bounds = this.#boundsOf(entities);
    if (bounds !== null) {
      const center = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      };
      const radius = Math.hypot(bounds.max.x - center.x, bounds.max.y - center.y, bounds.max.z - center.z);
      this.#camera?.frame({ center, radius });
    }
    return null;
  }

  /**
   * `pick`: which document entity is under a point of the view. Changes nothing.
   *
   * @param params - `{ x, y, unit }`.
   * @returns The entity, the world point, and the distance, or a miss.
   */
  async #pick(params: unknown): Promise<PickResult> {
    this.#requireMirror(SceneMethod.pick);
    if (!isPickParams(params)) {
      throw new InvalidParamsError('pick takes { x, y, unit: "css" | "backing" }.');
    }
    const canvas = this.#canvas;
    const point = canvas === null ? null : toCssPixels(params, viewSurfaceOf(canvas));
    return point === null ? { entity: null, point: null, distance: null } : this.#pickCss(point.x, point.y);
  }

  /**
   * `screenshot`: the view as an image, without the gizmo and the outline.
   *
   * @param params - `{ width?, height?, format, quality? }`.
   * @returns The data URL and its size.
   */
  async #screenshot(params: unknown): Promise<ScreenshotResult> {
    const app = this.#requireApp();
    this.#requireMirror(SceneMethod.screenshot);
    if (typeof params === "object" && params !== null) {
      for (const side of ["width", "height"]) {
        const value: unknown = Reflect.get(params, side);
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > SCREENSHOT_MAX_SIZE)
        ) {
          throw new InvalidParamsError(
            `screenshot takes a width and height from 1 to ${String(SCREENSHOT_MAX_SIZE)} pixels.`,
          );
        }
      }
    }
    if (!isScreenshotParams(params)) {
      throw new InvalidParamsError('screenshot takes { width?, height?, format: "png" | "jpeg", quality? }.');
    }
    this.#view?.setVisible(false);
    try {
      const capture = await app.renderer.captureScreenshot();
      const size = screenshotSize(params, capture);
      const dataUrl = await encodeCapture(capture, size, params.format, params.quality ?? 0.9);
      return { dataUrl, width: size.width, height: size.height };
    } finally {
      this.#view?.setVisible(true);
    }
  }

  /**
   * `getSchemas`: every registered component's schema.
   *
   * @returns The set.
   */
  #getSchemas(): SchemaSet {
    this.#requireMirror(SceneMethod.getSchemas);
    return this.#schemas();
  }

  /**
   * `setViewMode`: this host has the 3D editor camera only.
   *
   * @param params - `{ mode }`.
   * @returns `null`.
   */
  #setViewMode(params: unknown): null {
    this.#requireMirror(SceneMethod.setViewMode);
    if (!isSetViewModeParams(params)) {
      throw new InvalidParamsError('setViewMode takes { mode: "3d" | "2d" }.');
    }
    if (params.mode === ViewMode.twoD) {
      throw new InvalidParamsError("This scene view has no 2D view mode; it does not list the viewMode2d capability.");
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Selection, picking and the gizmo
  // -------------------------------------------------------------------------------------------

  /**
   * Sets the selection and updates the outline and the gizmo. Uids that no longer name a document
   * entity are dropped.
   *
   * @param uids - The selection, primary last.
   */
  #setSelection(uids: readonly string[]): void {
    const index = this.#mirror?.index() ?? null;
    const entities: Entity[] = [];
    const kept: string[] = [];
    for (const uid of uids) {
      const entity = index?.entities.get(uid);
      if (entity !== undefined && !entity.isDestroyed) {
        entities.push(entity);
        kept.push(uid);
      }
    }
    this.#selection = kept;
    this.#view?.outline(entities);
    this.#applyGizmo();
  }

  /** Attaches the gizmo to the primary selection in the current mode and space. */
  #applyGizmo(): void {
    const view = this.#view;
    if (view === null) {
      return;
    }
    const { mode, space } = this.#gizmo;
    view.setMode(mode === GizmoMode.none ? null : mode);
    view.setLocal(space === GizmoSpace.local);
    const primary = this.#selection.at(-1);
    view.attach(primary === undefined ? null : (this.#mirror?.index()?.entities.get(primary) ?? null));
  }

  /**
   * Picks at a CSS pixel: the renderer's pick first, then Lite's pick through the picked mesh's
   * ancestors, which also finds glTF models (S0.2 §6.1); the hit resolves to its document entity.
   *
   * @param x - The CSS pixel x.
   * @param y - The CSS pixel y.
   * @returns The pick result.
   */
  async #pickCss(x: number, y: number): Promise<PickResult> {
    const app = this.#requireApp();
    const mirror = this.#mirror;
    const scene = mirror?.scene ?? null;
    if (mirror === null || scene === null) {
      return { entity: null, point: null, distance: null };
    }
    const hit = await app.renderer.pickAsync(x, y, { filter: (entity) => entity.scene === scene });
    let entity = mirror.documentEntityOf(hit?.entity ?? null);
    let point = hit?.point ?? null;
    let distance = hit?.distance ?? null;
    if (entity === null && this.#view !== null) {
      const owners = nodeOwners(scene);
      const raw = await this.#view.pick(x, y, (node) => owners.get(node) ?? null);
      entity = mirror.documentEntityOf(raw?.entity ?? null);
      point = raw?.point ?? null;
      distance = raw?.distance ?? null;
    }
    if (entity === null) {
      return { entity: null, point: null, distance: null };
    }
    const c = canonicalizeNumber;
    return {
      entity: entity.uid,
      point: point === null ? null : [c(point[0]), c(point[1]), c(point[2])],
      distance: distance === null ? null : c(distance),
    };
  }

  /**
   * A click in the view: a plain click selects what it hits or clears the selection, a click with
   * Shift, Ctrl or Cmd toggles what it hits. A changed selection is applied and sent.
   *
   * @param click - Where, and whether it toggles.
   */
  async #onClick(click: ViewClick): Promise<void> {
    const { entity } = await this.#pickCss(click.x, click.y);
    const current = this.#selection;
    let next: readonly string[];
    if (click.toggle) {
      next =
        entity === null
          ? current
          : current.includes(entity)
            ? current.filter((uid) => uid !== entity)
            : [...current, entity];
    } else {
      next = entity === null ? [] : [entity];
    }
    if (next.length === current.length && next.every((uid, index) => uid === current[index])) {
      return;
    }
    this.#setSelection(next);
    this.#notify(SceneNotification.selectionChanged, { entities: this.#selection });
  }

  /**
   * Turns a gizmo drag into `transformDragging` (at most every 50 ms) and `transformDragged`.
   *
   * @param phase - Which part of the gesture.
   * @param drag - The handle.
   */
  #onDrag(phase: "start" | "move" | "end", drag: ViewDrag): void {
    if (phase === "start") {
      const uid = this.#selection.at(-1);
      const entity = uid === undefined ? undefined : this.#mirror?.index()?.entities.get(uid);
      if (entity === undefined) {
        this.#drag = null;
        return;
      }
      const snap = this.#gizmo.snap;
      this.#drag = {
        entity,
        mode: drag.mode,
        before: readLocalTransform(entity),
        snapper: snap === null ? null : new DragSnapper(drag.mode, snap, entity),
        lastSentMs: Number.NEGATIVE_INFINITY,
      };
      return;
    }
    const state = this.#drag;
    if (state === null) {
      return;
    }
    if (phase === "move") {
      state.snapper?.apply(state.entity);
      const now = performance.now();
      if (now - state.lastSentMs >= TRANSFORM_DRAGGING_INTERVAL_MS) {
        state.lastSentMs = now;
        this.#notify(SceneNotification.transformDragging, {
          entity: state.entity.uid,
          mode: state.mode,
          after: readLocalTransform(state.entity),
        });
      }
      return;
    }
    this.#drag = null;
    const after = readLocalTransform(state.entity);
    if (!sameTransform(state.before, after)) {
      this.#notify(SceneNotification.transformDragged, {
        entity: state.entity.uid,
        mode: state.mode,
        before: state.before,
        after,
      });
    }
  }

  /**
   * The world bounds of entities: their meshes' when the view can measure them, else their
   * positions, so a headless host still frames something.
   *
   * @param entities - The entities.
   * @returns The union box, or `null` for none.
   */
  #boundsOf(entities: readonly Entity[]): WorldBounds | null {
    let min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
    let max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
    for (const entity of entities) {
      const p = entity.transform.position;
      const box = this.#view?.worldBounds(entity) ?? { min: p, max: p };
      min = { x: Math.min(min.x, box.min.x), y: Math.min(min.y, box.min.y), z: Math.min(min.z, box.min.z) };
      max = { x: Math.max(max.x, box.max.x), y: Math.max(max.y, box.max.y), z: Math.max(max.z, box.max.z) };
    }
    return Number.isFinite(min.x) ? { min, max } : null;
  }

  // -------------------------------------------------------------------------------------------
  // Notifications and guards
  // -------------------------------------------------------------------------------------------

  /**
   * Sends `hotReloaded`, then `schemasChanged`.
   *
   * @param report - What `app.hotReload` did.
   */
  #hotReloaded(report: HotReloadReport): void {
    const params: HotReloadedParams = {
      report: {
        kind: report.kind,
        typeIds: report.typeIds,
        instances: report.instances,
        durationMs: report.durationMs,
        errors: report.errors.map((error) => ({
          message: messageOf(error),
          code: isIgnifxError(error) ? error.code : null,
        })),
      },
    };
    this.#notify(SceneNotification.hotReloaded, params);
    this.sendSchemas();
  }

  /**
   * The schemas, the host's own classes left out.
   *
   * @returns The set.
   */
  #schemas(): SchemaSet {
    return schemaSet(this.#requireApp(), new Set([EditorCamera.typeId]));
  }

  /**
   * The app, once {@link SceneHost.prepare} has run.
   *
   * @returns The app.
   */
  #requireApp(): App {
    const app = this.#app;
    if (app === null) {
      throw new RpcFailure(RpcErrorCode.notReady, "The scene view is still starting.");
    }
    return app;
  }

  /**
   * The document mirror, once the app has started; otherwise the method answers `notReady`.
   *
   * @param method - The method being answered, for the message.
   * @returns The mirror.
   */
  #requireMirror(method: string): DocumentMirror {
    const mirror = this.#mirror;
    if (!this.#started || mirror === null) {
      throw new RpcFailure(
        RpcErrorCode.notReady,
        `The scene view is still starting; wait for schemasChanged before "${method}".`,
      );
    }
    return mirror;
  }

  /**
   * Refuses a method that needs an open document while none is open.
   *
   * @param method - The method being answered, for the message.
   */
  #requireOpen(method: string): void {
    if ((this.#mirror?.scene ?? null) === null) {
      throw new RpcFailure(RpcErrorCode.noScene, `No scene is open; send "openScene" before "${method}".`);
    }
  }
}

/**
 * Tells whether a render surface is a DOM canvas, which pointer events and Lite's gizmo dispatcher need.
 *
 * @param surface - The surface.
 * @returns True for an `HTMLCanvasElement`.
 */
function isDomCanvas(surface: RenderSurface): surface is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== "undefined" && surface instanceof HTMLCanvasElement;
}

/**
 * Maps every entity node of a scene instance to its entity, by identity.
 *
 * @param scene - The instance.
 * @returns Node to entity.
 */
function nodeOwners(scene: SceneInstance): Map<object, Entity> {
  const owners = new Map<object, Entity>();
  const pending: Entity[] = [...scene.roots];
  for (let entity = pending.pop(); entity !== undefined; entity = pending.pop()) {
    owners.set(entity.transform.lite, entity);
    pending.push(...entity.children);
  }
  return owners;
}
