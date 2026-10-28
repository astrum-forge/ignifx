/**
 * The scene methods and notifications of protocol 0.3: what the scene view's host does with the
 * editor's document (`docs/architecture/17-editor-host.md` §6).
 */

import { Camera, canonicalizeNumber, createRay, isIgnifxError, validateSceneFile } from "@ignifx/core";
import { clipHostText, hotReloadedParamsOf, messageOf, relayAppReports } from "../app-reports.js";
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
  isSetAnimateMaterialsParams,
  isSetGizmoParams,
  isSetViewModeParams,
  PickUnit,
  RpcErrorCode,
  SCREENSHOT_MAX_SIZE,
  SceneMethod,
  SceneNotification,
  TRANSFORM_DRAGGING_INTERVAL_MS,
  ViewMode,
} from "../protocol/index.js";
import {
  IN_PLACE_ASSET_TYPES,
  instancesOf,
  outermostRoots,
  SCENE_ASSET_TYPE,
  waitForReplacement,
} from "./asset-reload.js";
import { colliderOutlinesOf } from "./collider-outlines.js";
import { applyDefaults, DefaultsTracker, instancesHolding } from "./defaults.js";
import { DocumentMirror } from "./document.js";
import { EditorCamera2D, EYE_DISTANCE_2D } from "./editor-camera-2d.js";
import { EDITOR_CAMERA_FOV, EditorCamera } from "./editor-camera.js";
import { applyOps, reloadInstance } from "./ops.js";
import { sampleAnimation } from "./sample-animation.js";
import { schemaSet } from "./schemas.js";
import { encodeCapture } from "./screenshot.js";
import { settingsSet } from "./settings.js";
import {
  boundsOf2D,
  CAMERA_2D_TYPE,
  componentTypeOf,
  DEFAULT_PIXELS_PER_UNIT,
  isCamera2DLike,
  levelCamera2D,
  sceneViewMode,
  twoDServiceOf,
  zoomForSize,
} from "./view-2d.js";
import {
  DragSnapper,
  pickRayMembers,
  readLocalTransform,
  sameTransform,
  screenshotSize,
  toBackingPixels,
  viewSurfaceOf,
} from "./view-math.js";
import type { RequestHandler } from "../channel.js";
import type { EditorAssetChange, PendingReload } from "./asset-reload.js";
import type { ChangedDefaults } from "./defaults.js";
import type { ViewClick } from "./editor-camera.js";
import type { PickRayMembers } from "./view-math.js";
import type { EditorView, ViewDrag, WorldBounds } from "../lite/gizmos.js";
import type {
  AssetReloadedParams,
  ColliderOutlineSet,
  GizmoDragMode,
  GizmoSnap,
  HostErrorParams,
  PickParams,
  PickResult,
  SceneFileTransform,
  SchemaSet,
  ScreenshotResult,
  SettingsSet,
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

/** A point of the view, in backing-store pixels. */
interface BackingPoint {
  /** From the left edge. */
  readonly x: number;
  /** From the top edge. */
  readonly y: number;
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

  #camera2D: EditorCamera2D | null = null;

  /** The editor camera the view uses, as `setViewMode` last set it. */
  #viewMode: ViewMode = ViewMode.threeD;

  /** The document the 2D camera was last placed on (see `#documentKey`), or `undefined` for none. */
  #placed2D: string | null | undefined = undefined;

  /** Whether the host lists `viewMode2d`. */
  readonly #hasViewMode2D: boolean;

  #eye: Camera | null = null;

  #canvas: RenderSurface | null = null;

  #view: EditorView | null = null;

  #selection: readonly string[] = [];

  #gizmo: GizmoSettings = { mode: GizmoMode.translate, space: GizmoSpace.world, snap: null };

  #drag: DragState | null = null;

  #started = false;

  /** The field defaults seen at start and after each hot reload, from {@link SceneHost.start} on. */
  #defaults: DefaultsTracker | null = null;

  readonly #cleanups: (() => void)[] = [];

  /** The reloads waiting for their new value; disposing the host cancels them. */
  readonly #reloads = new Set<PendingReload>();

  /** The tail of the work that touches the document, run one task at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Creates the methods; none answers until the app has started.
   *
   * @param options - The capabilities and the notification sink.
   */
  constructor(options: SceneHostOptions) {
    this.#notify = options.notify;
    const has = (capability: string): boolean => options.capabilities.includes(capability);
    this.#hasViewMode2D = has(HostCapability.viewMode2d);
    const methods = new Map<string, RequestHandler>([
      [SceneMethod.openScene, async (params) => this.#openScene(params)],
      [SceneMethod.closeScene, async () => this.#closeScene()],
      [SceneMethod.applyOps, async (params) => this.#applyOps(params)],
      [SceneMethod.readBack, (params) => this.#readBack(params)],
      [SceneMethod.select, (params) => this.#select(params)],
      [SceneMethod.frame, (params) => this.#frame(params)],
      [SceneMethod.pick, async (params) => this.#pick(params)],
      [SceneMethod.getSchemas, () => this.#getSchemas()],
      [SceneMethod.describeSettings, () => this.#describeSettings()],
      [SceneMethod.setViewMode, (params) => this.#setViewMode(params)],
      [SceneMethod.setAnimateMaterials, (params) => this.#setAnimateMaterials(params)],
      [SceneMethod.getColliderOutlines, (params) => this.#getColliderOutlines(params)],
      [SceneMethod.sampleAnimation, (params) => this.#sampleAnimation(params)],
    ]);
    if (has(HostCapability.gizmos)) {
      methods.set(SceneMethod.setGizmo, (params) => this.#setGizmo(params));
    }
    if (has(HostCapability.screenshot)) {
      methods.set(SceneMethod.screenshot, async (params) => this.#screenshot(params));
    }
    // The channel answers one request at a time; an asset reload's rebuild queues with them.
    this.methods = new Map(
      [...methods].map(([name, handler]) => [name, async (params: unknown) => this.#serial(() => handler(params))]),
    );
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
    app.registerComponents([EditorCamera, EditorCamera2D]);
    const eye = app.world.createEntity("Editor Camera", { scene });
    this.#eye = eye.addComponent(Camera, {
      fov: EDITOR_CAMERA_FOV,
      near: 0.05,
      far: 5000,
      priority: EDITOR_CAMERA_PRIORITY,
    });
    const camera = eye.addComponent(EditorCamera);
    camera.apply();
    this.#camera = camera;
    // The 2D toolkit's camera, found by its type id: highest priority wins, so while it is enabled
    // the sprites draw through it and the level's own `Camera2D` is left as the file has it.
    const camera2DType = componentTypeOf(app, CAMERA_2D_TYPE);
    const camera2D = camera2DType === null ? null : eye.addComponent(camera2DType);
    if (isCamera2DLike(camera2D)) {
      camera2D.priority = EDITOR_CAMERA_PRIORITY;
      camera2D.pixelPerfect = false;
      camera2D.enabled = false;
    }
    const twoD = eye.addComponent(EditorCamera2D);
    twoD.attach(this.#eye, isCamera2DLike(camera2D) ? camera2D : null);
    twoD.pixelsPerUnit = (): number => twoDServiceOf(app)?.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
    this.#camera2D = twoD;
    this.#cleanups.push(
      relayAppReports(app, {
        log: (params): void => {
          this.#notify(SceneNotification.log, params);
        },
        error: (params): void => {
          this.#notify(SceneNotification.hostError, params);
        },
        hotReloaded: (report): void => {
          this.#hotReloaded(report);
        },
      }),
    );
  }

  /**
   * Finishes setting up once the app has started: the gizmos and the outline on a canvas, the
   * camera's controls, and the first `schemasChanged`.
   *
   * @param canvas - The view's canvas, or `null` for a headless host.
   * @throws Whatever opening the render overlay throws.
   */
  async start(canvas: RenderSurface | null): Promise<void> {
    const app = this.#requireApp();
    this.#canvas = canvas;
    if (canvas !== null && !app.isHeadless && this.methods.has(SceneMethod.setGizmo) && isDomCanvas(canvas)) {
      const view = createEditorView(app.lite, await app.renderer.openOverlay(), canvas);
      view.onDrag((phase, drag) => {
        this.#onDrag(phase, drag);
      });
      this.#view = view;
      this.#applyGizmo();
      const onClick = (click: ViewClick): void => {
        void this.#onClick(click);
      };
      for (const camera of [this.#camera, this.#camera2D]) {
        if (camera !== null) {
          camera.claims = view;
          camera.onClick = onClick;
          camera.bind(canvas);
        }
      }
    }
    this.#defaults = new DefaultsTracker(app);
    this.#started = true;
    this.sendSchemas();
  }

  /** Sends `schemasChanged` once the app has started; the channel calls it after each `ready`. */
  sendSchemas(): void {
    if (this.#started) {
      this.#notify(SceneNotification.schemasChanged, this.#schemas());
    }
  }

  /**
   * Reloads an asset that changed on disk, in place, when the app has it loaded and its type is one
   * the renderers follow: a scene or prefab, whose instances in the open document are rebuilt from
   * the new file with their uids, transforms and overrides, or a model, mesh, material, sprite atlas
   * or shader. Sends `assetReloaded` once the new value is in. The open document's own file, a
   * removed file and any other type are left alone.
   *
   * @param change - The address and what happened to it.
   * @returns Whether the asset was reloaded; `false` also when the reload failed, which the app
   * reports as an error.
   */
  async assetChanged(change: EditorAssetChange): Promise<boolean> {
    const app = this.#app;
    const mirror = this.#mirror;
    const { address } = change;
    if (app === null || mirror === null || !this.#started || change.kind === "removed") {
      return false;
    }
    const handle = app.assets.get(address);
    if (
      handle === null ||
      handle.state !== "loaded" ||
      !IN_PLACE_ASSET_TYPES.includes(handle.type) ||
      (mirror.scene !== null && address === mirror.address)
    ) {
      return false;
    }
    const pending = waitForReplacement(app, handle);
    this.#reloads.add(pending);
    app.assets.reload(address);
    const replaced = await pending.replaced;
    this.#reloads.delete(pending);
    if (!replaced) {
      return false;
    }
    return this.#serial(async () => {
      const index = handle.type === SCENE_ASSET_TYPE ? mirror.index() : null;
      const roots = index === null ? [] : instancesOf(app, index, address);
      const entities = await this.#rebuildInstances(app, mirror, roots, address, { address });
      this.#setSelection(this.#selection);
      const params: AssetReloadedParams = { address, type: handle.type, entities };
      this.#notify(SceneNotification.assetReloaded, params);
      return true;
    });
  }

  /**
   * Rebuilds instance roots from their scenes, one after the other; a root that fails is a
   * `hostError`.
   *
   * @param app - The scene view's app.
   * @param mirror - The open document.
   * @param roots - The roots' uids, none inside another.
   * @param cause - What the rebuild follows, for the error's message.
   * @param data - What the error's `data` carries besides the root's uid.
   * @returns The roots rebuilt.
   */
  async #rebuildInstances(
    app: App,
    mirror: DocumentMirror,
    roots: readonly string[],
    cause: string,
    data: Readonly<Record<string, string | readonly string[]>>,
  ): Promise<string[]> {
    const rebuilt: string[] = [];
    for (const uid of roots) {
      try {
        // Each rebuild reads the document the previous one left.
        // oxlint-disable-next-line no-await-in-loop -- see above
        await reloadInstance(app, mirror, uid);
        rebuilt.push(uid);
      } catch (error) {
        const params: HostErrorParams = {
          code: isIgnifxError(error) ? error.code : null,
          message: clipHostText(`Rebuilding ${uid} from ${cause}: ${messageOf(error)}`),
          data: { ...data, entity: uid },
        };
        this.#notify(SceneNotification.hostError, params);
      }
    }
    return rebuilt;
  }

  /**
   * Gives the open document the defaults a hot reload changed, where it leaves them out (engine ask
   * E25): each document component's omitted fields take the new default, then each prefab instance
   * whose members hold a changed type is rebuilt from its prefab with its overrides. A component
   * that throws while taking a default is a `hostError`, and the rest still runs.
   *
   * @param changed - The changed fields, by type id.
   */
  async #followDefaults(changed: ChangedDefaults): Promise<void> {
    const app = this.#app;
    const mirror = this.#mirror;
    const index = mirror?.index() ?? null;
    if (app === null || mirror === null || index === null) {
      return;
    }
    applyDefaults(app, mirror, index, changed, (component, typeId, error) => {
      const params: HostErrorParams = {
        code: isIgnifxError(error) ? error.code : null,
        message: clipHostText(`Applying the new defaults of ${typeId} to ${component.uid}: ${messageOf(error)}`),
        data: { typeIds: [typeId], entity: component.entity.uid, component: typeId },
      };
      this.#notify(SceneNotification.hostError, params);
    });
    mirror.invalidate();
    const rebuilt = mirror.index();
    const roots = rebuilt === null ? [] : outermostRoots(rebuilt, instancesHolding(app, rebuilt, changed));
    if (roots.length > 0) {
      const typeIds = [...changed.keys()];
      const cause = `the new defaults of ${typeIds.join(", ")}`;
      await this.#rebuildInstances(app, mirror, roots, cause, { typeIds });
      this.#setSelection(this.#selection);
    }
  }

  /** Removes the relays and the overlay; the host disposes the app. */
  dispose(): void {
    for (const pending of this.#reloads) {
      pending.cancel();
    }
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
    const opened = await mirror.open(params.file, params.address);
    const viewMode = sceneViewMode(this.#requireApp(), mirror.scene);
    const result = { entityCount: opened.entityCount, warnings: opened.warnings, viewMode };
    if (this.#viewMode === ViewMode.twoD && this.#placed2D !== this.#documentKey()) {
      this.#place2D();
    }
    return new Reply(result, () => {
      this.#notify(SceneNotification.sceneOpened, {
        address: params.address,
        name: mirror.name,
        entityCount: result.entityCount,
        warnings: result.warnings,
        viewMode,
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
    if (this.#viewMode === ViewMode.twoD) {
      const box = boundsOf2D(this.#requireApp(), entities);
      if (box !== null) {
        this.#camera2D?.frame(box);
      }
      return null;
    }
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
    return this.#pickAt(params);
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
   * `describeSettings`: the project's settings sections and their resolved values. Sent only on
   * request.
   *
   * @returns The set.
   */
  #describeSettings(): SettingsSet {
    this.#requireMirror(SceneMethod.describeSettings);
    return settingsSet(this.#requireApp());
  }

  /**
   * `setAnimateMaterials`: the editor's "animate materials" toggle, which runs or holds the shader
   * clock of the scene view (`app.renderer.animateMaterialsInEditMode`).
   *
   * @param params - `{ enabled }`.
   * @returns `null`.
   */
  #setAnimateMaterials(params: unknown): null {
    this.#requireMirror(SceneMethod.setAnimateMaterials);
    if (!isSetAnimateMaterialsParams(params)) {
      throw new InvalidParamsError("setAnimateMaterials takes { enabled: boolean }.");
    }
    this.#requireApp().renderer.animateMaterialsInEditMode = params.enabled;
    return null;
  }

  /**
   * `getColliderOutlines`: the world-space outlines of the requested entities' colliders, from the
   * project's physics extensions, for the editor's collider gizmos. Changes nothing.
   *
   * @param params - `{ entities }`.
   * @returns The outlines, within the protocol's caps; uids the open scene does not have are skipped.
   */
  #getColliderOutlines(params: unknown): ColliderOutlineSet {
    const mirror = this.#requireMirror(SceneMethod.getColliderOutlines);
    if (!isEntitySelection(params)) {
      throw new InvalidParamsError("getColliderOutlines takes { entities: uid[] }.");
    }
    this.#requireOpen(SceneMethod.getColliderOutlines);
    const index = mirror.index();
    return colliderOutlinesOf(this.#requireApp(), params.entities, (uid) => index?.entities.get(uid));
  }

  /**
   * `sampleAnimation`: poses an entity's `Animator` at one point of one state.
   *
   * @param params - `{ entity, state, normalizedTime, parameters? }`.
   * @returns `{ posed }`.
   */
  #sampleAnimation(params: unknown): unknown {
    const mirror = this.#requireMirror(SceneMethod.sampleAnimation);
    this.#requireOpen(SceneMethod.sampleAnimation);
    return sampleAnimation(this.#requireApp(), mirror, params);
  }

  /**
   * `setViewMode`: switches the view between the 3D editor camera and the 2D one. The first switch
   * to 2D on a document starts where the level's own `Camera2D` looks, or frames the document.
   *
   * @param params - `{ mode }`.
   * @returns `null`.
   */
  #setViewMode(params: unknown): null {
    this.#requireMirror(SceneMethod.setViewMode);
    if (!isSetViewModeParams(params)) {
      throw new InvalidParamsError('setViewMode takes { mode: "3d" | "2d" }.');
    }
    if (params.mode === ViewMode.twoD && (!this.#hasViewMode2D || this.#camera2D === null)) {
      throw new InvalidParamsError("This scene view has no 2D view mode; it does not list the viewMode2d capability.");
    }
    if (params.mode === this.#viewMode) {
      return null;
    }
    this.#viewMode = params.mode;
    const camera = this.#camera;
    const camera2D = this.#camera2D;
    if (params.mode === ViewMode.twoD) {
      if (camera !== null) {
        camera.active = false;
      }
      camera2D?.activate();
      if (this.#placed2D !== this.#documentKey()) {
        this.#place2D();
      }
    } else {
      camera2D?.deactivate();
      if (camera !== null) {
        camera.active = true;
        camera.apply();
      }
    }
    return null;
  }

  /**
   * Names the open document for the 2D camera's placement: its address, or `undefined` when none is
   * open. A reopen of the same address (the editor resends `openScene` after a failed op) keeps
   * the view where the user left it.
   *
   * @returns The key.
   */
  #documentKey(): string | null | undefined {
    const mirror = this.#mirror;
    return mirror === null || mirror.scene === null ? undefined : mirror.address;
  }

  /**
   * Places the 2D editor camera on the open document: where the level's own `Camera2D` looks, at
   * the half-height it shows, or, without one, around the whole document.
   */
  #place2D(): void {
    const camera2D = this.#camera2D;
    const mirror = this.#mirror;
    if (camera2D === null || mirror === null) {
      return;
    }
    const app = this.#requireApp();
    const scene = mirror.scene;
    this.#placed2D = this.#documentKey();
    const level = levelCamera2D(app, scene);
    if (level !== null) {
      const view = camera2D.view();
      const position = level.entity.transform.position;
      camera2D.centerX = position.x;
      camera2D.centerY = position.y;
      camera2D.zoom = zoomForSize(level.orthographicSize, view.heightPx, view.pixelsPerUnit);
      camera2D.apply();
      return;
    }
    const box = boundsOf2D(app, [...(scene?.roots ?? [])]);
    if (box !== null) {
      camera2D.frame(box);
    }
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
   * Picks the document's scene at a point of the view: in 3D mode with `app.renderer.pickAsync`,
   * which resolves a glTF model through its nearest entity node, and in 2D mode with
   * `app.twoD.pickAt` first. The hit resolves to its document entity. Hit or miss, the answer
   * carries the editor camera's ray through the point and where it meets `z = 0`.
   *
   * @param params - The point and its unit; it is converted to backing-store pixels once.
   * @returns The pick result; a point outside the canvas, or a headless view, misses without a ray.
   */
  async #pickAt(params: PickParams): Promise<PickResult> {
    const scene = this.#mirror?.scene ?? null;
    const canvas = this.#canvas;
    const at = canvas === null ? null : toBackingPixels(params, viewSurfaceOf(canvas));
    if (at === null) {
      return { entity: null, point: null, distance: null };
    }
    const camera2D = this.#camera2D;
    if (this.#viewMode === ViewMode.twoD && camera2D !== null) {
      return this.#pick2D(at, camera2D, scene);
    }
    const ray = this.#eye?.screenToRay(at.x, at.y) ?? null;
    const cast = ray === null ? {} : pickRayMembers(ray);
    if (scene === null) {
      return { entity: null, point: null, distance: null, ...cast };
    }
    return this.#pick3D(at, scene, cast);
  }

  /**
   * Picks in 2D mode: the topmost sprite of the document under the point with `app.twoD.pickAt`,
   * unpickable sprites included, answered with the world point on `z = 0` and no distance. Without
   * a sprite hit, a `"mixed"` project (or one without `@ignifx/2d`) goes on to the 3D picker through
   * the orthographic eye. The ray is the eye's, straight down +Z, built from the 2D camera's own
   * arithmetic so it never lags a frame behind a pan.
   *
   * @param at - The point, in backing-store pixels.
   * @param camera2D - The 2D editor camera.
   * @param scene - The document's scene instance, or `null`.
   * @returns The pick result.
   */
  async #pick2D(at: BackingPoint, camera2D: EditorCamera2D, scene: SceneInstance | null): Promise<PickResult> {
    const world = camera2D.screenToWorld(at.x, at.y);
    const ray = createRay();
    ray.origin.x = world.x;
    ray.origin.y = world.y;
    ray.origin.z = -EYE_DISTANCE_2D + (this.#eye?.near ?? 0);
    ray.direction.x = 0;
    ray.direction.y = 0;
    ray.direction.z = 1;
    const cast = pickRayMembers(ray);
    if (scene === null) {
      return { entity: null, point: null, distance: null, ...cast };
    }
    const twoD = twoDServiceOf(this.#requireApp());
    const hit = twoD?.pickAt(at.x, at.y, { includeUnpickable: true, filter: (entity) => entity.scene === scene });
    const entity = this.#mirror?.documentEntityOf(hit?.entity ?? null) ?? null;
    if (entity !== null) {
      const c = canonicalizeNumber;
      return { entity: entity.uid, point: [c(world.x), c(world.y), 0], distance: null, ...cast };
    }
    if (twoD !== null && twoD.mode === "sprite") {
      return { entity: null, point: null, distance: null, ...cast };
    }
    return this.#pick3D(at, scene, cast);
  }

  /**
   * Picks the document's meshes with `app.renderer.pickAsync`.
   *
   * @param at - The point, in backing-store pixels.
   * @param scene - The document's scene instance.
   * @param cast - The answer's `ray` and `plane`.
   * @returns The pick result.
   */
  async #pick3D(at: BackingPoint, scene: SceneInstance, cast: Partial<PickRayMembers>): Promise<PickResult> {
    const app = this.#requireApp();
    const hit = await app.renderer.pickAsync(at.x, at.y, { filter: (entity) => entity.scene === scene });
    const entity = this.#mirror?.documentEntityOf(hit?.entity ?? null) ?? null;
    if (hit === null || entity === null) {
      return { entity: null, point: null, distance: null, ...cast };
    }
    const c = canonicalizeNumber;
    const point = hit.point;
    return {
      entity: entity.uid,
      point: point === null ? null : [c(point[0]), c(point[1]), c(point[2])],
      distance: c(hit.distance),
      ...cast,
    };
  }

  /**
   * A click in the view: a plain click selects what it hits or clears the selection, a click with
   * Shift, Ctrl or Cmd toggles what it hits. A changed selection is applied and sent.
   *
   * @param click - Where, and whether it toggles.
   */
  async #onClick(click: ViewClick): Promise<void> {
    const { entity } = await this.#pickAt({ x: click.x, y: click.y, unit: PickUnit.css });
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
    // A "recreate" reload replaces component instances, which the document index holds.
    this.#mirror?.invalidate();
    const changed = this.#defaults?.changed(report.typeIds) ?? new Map<string, readonly string[]>();
    if (changed.size > 0) {
      // Queued with the requests, so a request the editor sends after `schemasChanged` sees it done.
      this.#serial(async () => this.#followDefaults(changed)).catch((error: unknown) => {
        const params: HostErrorParams = {
          code: isIgnifxError(error) ? error.code : null,
          message: clipHostText(`Following the new defaults of ${[...changed.keys()].join(", ")}: ${messageOf(error)}`),
          data: { typeIds: [...changed.keys()] },
        };
        this.#notify(SceneNotification.hostError, params);
      });
    }
    const params = hotReloadedParamsOf(report);
    this.#notify(SceneNotification.hotReloaded, params);
    this.sendSchemas();
  }

  /**
   * Runs work that touches the document after everything queued before it.
   *
   * @param task - The work.
   * @returns What the task returns.
   */
  async #serial<T>(task: () => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The schemas, the host's own classes left out.
   *
   * @returns The set.
   */
  #schemas(): SchemaSet {
    return schemaSet(this.#requireApp(), new Set([EditorCamera.typeId, EditorCamera2D.typeId]));
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
