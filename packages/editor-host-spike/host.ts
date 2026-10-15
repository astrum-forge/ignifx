// THROWAWAY spike S0.1 + S0.2 — not for merge. The page module of /__ignifx_editor__/: creates an app
// from the project's own @ignifx/core with the project's extensions and scripts, loads a scene file,
// renders, and answers JSON-RPC over a MessagePort handed in by the parent (the editor renderer).
//
// S0.2 adds the scene view: editor camera (3D: EditorCamera; 2D with ?mode=2d: EditorCamera2D), Lite
// gizmos through src/lite/gizmos.ts (the only Lite importer), picking, a selection outline and a grid,
// and the protocol events transformDragStart / transformDragging (throttled) / transformDragged.
import { Camera, Component, createApp, MeshAsset, MeshRenderer, Vec3, VERSION } from "@ignifx/core";
import { coreVersion, corePackagePath, extensions, scene } from "virtual:ignifx-editor-spike/project";
import { manifest } from "virtual:ignifx/manifest";
import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
import { EditorCamera } from "./src/editor-camera.js";
import { addEditorGrid, createEditorGizmos, describeSubtree, nodeTrs, rawPick } from "./src/lite/gizmos.js";
import type { GizmoAxis, GizmoDragInfo, GizmoMode, EditorGizmos } from "./src/lite/gizmos.js";
import type { Mode2D } from "./src/mode-2d.js";
import type { App, Entity, HotReloadReport } from "@ignifx/core";

interface RpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface Trs {
  readonly position: [number, number, number];
  readonly rotation: [number, number, number, number];
  readonly scale: [number, number, number];
}

const query = new URLSearchParams(window.location.search);
const viewMode = query.get("mode") === "2d" ? "2d" : "3d";
const outlineMode = (query.get("outline") ?? "lines") as "lines" | "bbox" | "none";

/** Milestones in ms since this document's navigation start (performance.timeOrigin). */
const marks: Record<string, number> = { moduleEvaluated: performance.now() };
let port: MessagePort | null = null;
let parentOrigin: string | null = null;
let appRef: App | null = null;
const pending: object[] = [];

// S0.2 state.
let gizmos: EditorGizmos | null = null;
let editorCamera: EditorCamera | null = null;
let editorCameraComponent: Camera | null = null;
let mode2d: Mode2D | null = null;
let registration: unknown = null;
let selected: Entity | null = null;
let dragBefore: Trs | null = null;
let dragFrames = 0;
let lastDraggingSent = 0;
const dragLog: { kind: string; t: number; info?: GizmoDragInfo; trs?: Trs }[] = [];
const frameTimes: number[] = [];

function send(message: object): void {
  if (port === null) {
    pending.push(message);
    return;
  }
  port.postMessage(message);
}

function notify(method: string, params: unknown): void {
  send({ jsonrpc: "2.0", method, params });
}

function readTrs(entity: Entity): Trs {
  const t = entity.transform;
  const p = t.localPosition;
  const r = t.localRotation;
  const s = t.localScale;
  return { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w], scale: [s.x, s.y, s.z] };
}

function status(): object {
  const app = appRef;
  return {
    engineVersion: coreVersion,
    coreVERSIONConstant: VERSION,
    appVersion: app?.version ?? null,
    corePackagePath,
    timeOrigin: performance.timeOrigin,
    marks,
    frameCount: app?.time.frameCount ?? 0,
    drawCalls: app?.renderer.drawCalls ?? 0,
    gpu: typeof navigator.gpu !== "undefined",
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    origin: window.location.origin,
    parentOrigin,
    viewMode,
    devicePixelRatio: window.devicePixelRatio,
    utilityLayerRegistration: registration,
    inputCounts,
  };
}

function select(entity: Entity | null, via: string): void {
  selected = entity;
  gizmos?.attach(entity === null ? null : entity.transform.lite);
  mode2d?.select(entity);
  notify("selectionChanged", {
    via,
    uid: entity?.uid ?? null,
    name: entity?.name ?? null,
    scene: entity?.scene.name ?? null,
  });
}

function findEntity(name: string): Entity | null {
  return appRef?.world.findByName(name) ?? null;
}

/** World point → CSS px inside the iframe, through the editor camera. */
function project(point: { x: number; y: number; z: number }): { x: number; y: number; inFront: boolean } | null {
  const camera = editorCameraComponent;
  if (camera === null) return null;
  const out = new Vec3();
  const inFront = camera.worldToScreen(point, out);
  const dpr = window.devicePixelRatio;
  return { x: out.x / dpr, y: out.y / dpr, inFront };
}

function entityCenter(entity: Entity): { x: number; y: number; z: number } {
  const bounds = gizmos?.worldBounds(entity.transform.lite) ?? null;
  if (bounds !== null) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
  }
  const p = entity.transform.position;
  return { x: p.x, y: p.y, z: p.z };
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function handleAsync(request: RpcRequest): Promise<unknown> {
  const app = appRef;
  const params = request.params ?? {};
  switch (request.method) {
    case "ping":
      return { pong: true, hostNow: performance.now(), hostEpochMs: Date.now(), ...status() };
    case "status":
      return status();
    case "select": {
      const entity = findEntity(String(params["name"]));
      select(entity, "rpc");
      return { uid: entity?.uid ?? null };
    }
    case "setGizmoMode":
      gizmos?.setMode(String(params["mode"]) as GizmoMode);
      await nextFrame();
      await nextFrame();
      return { mode: gizmos?.mode ?? null };
    case "entityScreenPoint": {
      const entity = findEntity(String(params["name"]));
      if (entity === null) return null;
      if (mode2d !== null) {
        const p = entity.transform.position;
        const s = mode2d.worldToScreen(p.x + Number(params["dx"] ?? 0), p.y + Number(params["dy"] ?? 0));
        return { x: s.x / window.devicePixelRatio, y: s.y / window.devicePixelRatio };
      }
      return project(entityCenter(entity));
    }
    case "worldScreenPoint":
      return project({ x: Number(params["x"]), y: Number(params["y"]), z: Number(params["z"]) });
    case "handleScreenPoint": {
      if (gizmos === null || editorCameraComponent === null) return null;
      const eye = editorCameraComponent.entity.transform.position;
      const world = gizmos.handlePoint(String(params["axis"]) as GizmoAxis, eye);
      return world === null ? null : { world, screen: project(world) };
    }
    case "transformOf": {
      const entity = findEntity(String(params["name"]));
      return entity === null ? null : readTrs(entity);
    }
    case "truthProbe": {
      // Direction of truth: is Transform's live view the very object Lite's node holds?
      const entity = findEntity(String(params["name"]));
      if (entity === null) return null;
      const node = nodeTrs(entity.transform.lite);
      const before = readTrs(entity);
      const frames: Trs[] = [];
      for (let i = 0; i < Number(params["frames"] ?? 10); i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await nextFrame();
        frames.push(readTrs(entity));
      }
      return {
        positionIsSameObject: entity.transform.localPosition === node.position,
        rotationIsSameObject: entity.transform.localRotation === node.rotation,
        scaleIsSameObject: entity.transform.localScale === node.scaling,
        before,
        after: frames.at(-1) ?? null,
        unchangedOverFrames: frames.every((f) => JSON.stringify(f) === JSON.stringify(before)),
        worldPosition: entity.transform.position,
      };
    }
    case "setLocalPosition": {
      // What the document op `setTransform` does when applied back to the live world (undo/redo).
      const entity = findEntity(String(params["name"]));
      if (entity === null) return null;
      const p = params["position"] as number[];
      entity.transform.localPosition.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      await nextFrame();
      await nextFrame();
      return readTrs(entity);
    }
    case "cameraState":
      return editorCamera === null
        ? mode2d === null
          ? null
          : { zoom: mode2d.camera.zoom, pans: mode2d.camera.pans, zooms: mode2d.camera.zooms, position: mode2d.camera.transform.position, overlay: mode2d.overlayStats() }
        : {
            yaw: editorCamera.yaw,
            pitch: editorCamera.pitch,
            distance: editorCamera.distance,
            focus: editorCamera.focus,
            eye: editorCamera.transform.position,
            stats: editorCamera.stats,
            mainCameraIsEditor: app?.world.mainCamera === editorCameraComponent,
          };
    case "gizmoState":
      return gizmos === null ? null : { ...gizmos.pointerState(), mode: gizmos.mode, meshCount: gizmos.meshCount, dragLog: dragLog.slice(-20) };
    case "frameSelection":
      editorCamera?.frameSelection();
      await nextFrame();
      return editorCamera === null ? null : { focus: editorCamera.focus, distance: editorCamera.distance };
    case "pick": {
      // CSS px inside the iframe → backing px → app.renderer.pickAsync (renderer.ts 293) → entity.
      if (app === null) return null;
      const dpr = window.devicePixelRatio;
      const x = Number(params["x"]) * dpr;
      const y = Number(params["y"]) * dpr;
      if (mode2d !== null) {
        const t0 = performance.now();
        const hit = mode2d.pickAtBacking(x, y);
        return { hit, ms: performance.now() - t0 };
      }
      // renderer.ts documents backing-store pixels (x devicePixelRatio); Lite's pickAsync documents
      // CSS pixels (index.d.ts 10237). Try both and report.
      const describe = (hit: Awaited<ReturnType<typeof app.renderer.pickAsync>>): unknown =>
        hit === null
          ? null
          : {
              uid: hit.entity.uid,
              name: hit.entity.name,
              component: hit.component === null ? null : ((hit.component.constructor as { typeId?: string }).typeId ?? null),
              point: hit.point,
              distance: hit.distance,
            };
      const t0 = performance.now();
      const backing = await app.renderer.pickAsync(x, y);
      const t1 = performance.now();
      const css = await app.renderer.pickAsync(Number(params["x"]), Number(params["y"]));
      const t2 = performance.now();
      const raw = await rawPick(app.lite.scene, Number(params["x"]), Number(params["y"]));
      const rawBacking = await rawPick(app.lite.scene, x, y);
      return {
        hit: describe(css),
        ms: t2 - t1,
        asDocumentedBackingPx: { hit: describe(backing), ms: t1 - t0 },
        litePick: raw,
        litePickAtBackingPx: rawBacking,
      };
    }
    case "describeEntity": {
      const entity = findEntity(String(params["name"]));
      return entity === null ? null : { handle: entity.handle, children: entity.children.map((c) => c.name), node: describeSubtree(entity.transform.lite) };
    }
    case "rawPick":
      return app === null ? null : rawPick(app.lite.scene, Number(params["x"]), Number(params["y"]));
    case "frameStats": {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      return { samples: sorted.length, p50: at(0.5), p95: at(0.95), drawCalls: app?.renderer.drawCalls ?? 0 };
    }
    case "resetFrameStats":
      frameTimes.length = 0;
      return true;
    default:
      throw new Error(`no method ${request.method}`);
  }
}

function handle(request: RpcRequest): void {
  handleAsync(request).then(
    (result) => {
      send({ jsonrpc: "2.0", id: request.id ?? null, result });
    },
    (error: unknown) => {
      send({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32601, message: String(error) } });
    },
  );
}

// Input probe: every pointer/key event the document sees (capture phase on window).
const inputCounts: Record<string, number> = {};
for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "mousedown"]) {
  window.addEventListener(
    type,
    () => {
      inputCounts[type] = (inputCounts[type] ?? 0) + 1;
    },
    { capture: true },
  );
}

// Installed before any await, so a port posted at the iframe's `load` event cannot be missed.
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type !== "ignifx-editor/connect" || event.ports.length !== 1 || port !== null) {
    return;
  }
  parentOrigin = event.origin;
  marks["portReceived"] = performance.now();
  port = event.ports[0] ?? null;
  if (port === null) {
    return;
  }
  port.onmessage = (portEvent: MessageEvent): void => {
    handle(portEvent.data as RpcRequest);
  };
  for (const message of pending.splice(0)) {
    port.postMessage(message);
  }
});

function wireGizmoEvents(overlay: EditorGizmos): void {
  overlay.onDragStart((info) => {
    if (selected === null) return;
    dragBefore = readTrs(selected);
    dragFrames = 0;
    dragLog.push({ kind: "start", t: performance.now(), info });
    notify("transformDragStart", { uid: selected.uid, mode: info.mode, axis: info.axis, before: dragBefore });
  });
  overlay.onDrag((info) => {
    if (selected === null) return;
    dragFrames += 1;
    const now = performance.now();
    // Throttled: the shell needs a live readout, not every pointer event.
    if (now - lastDraggingSent >= 50) {
      lastDraggingSent = now;
      notify("transformDragging", { uid: selected.uid, mode: info.mode, axis: info.axis, trs: readTrs(selected) });
    }
  });
  overlay.onDragEnd((info) => {
    if (selected === null) return;
    // The Lite node IS the transform (Transform is a view over it), so reading Transform here is
    // already the dragged result: no write-back step exists or is needed. The host only turns it into
    // the document op.
    const after = readTrs(selected);
    dragLog.push({ kind: "end", t: performance.now(), info, trs: after });
    notify("transformDragged", {
      uid: selected.uid,
      name: selected.name,
      mode: info.mode,
      axis: info.axis,
      moves: dragFrames,
      op: { op: "setTransform", entity: selected.uid, before: dragBefore, after },
    });
  });
}

/** ?msaa=1 overrides the project's MSAA for the scene view (utility-layer overlay experiment). */
type ProjectSettings = ImportMetaEnv["IGNIFX_CONFIG"];
function settingsForView(): ProjectSettings {
  const base = import.meta.env.IGNIFX_CONFIG;
  const msaa = query.get("msaa");
  if (msaa === null || base === undefined) return base;
  const rendering = (base as { rendering?: Record<string, unknown> }).rendering ?? {};
  return { ...base, rendering: { ...rendering, msaaSamples: Number(msaa) } } as ProjectSettings;
}

async function main(): Promise<void> {
  const canvas = document.querySelector("#scene-view");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("editor host spike: no #scene-view canvas");
  }
  // One copy of core: every project script must extend *this* module's Component.
  const foreign = scripts.filter((type) => !(type.prototype instanceof Component)).map((type) => type.typeId);
  marks["createAppStart"] = performance.now();
  const app = await createApp({
    canvas,
    settings: settingsForView(),
    assets: { manifest },
    extensions: extensions(),
  });
  appRef = app;
  marks["appCreated"] = performance.now();
  app.registerComponents(scripts);
  acceptHotReload(app);
  app.hotReload.onApplied.connect((report: HotReloadReport) => {
    notify("hotReloaded", {
      hostEpochMs: Date.now(),
      kind: report.kind,
      typeIds: report.typeIds,
      instances: report.instances,
      durationMs: report.durationMs,
      errors: report.errors.length,
    });
  });
  app.onError.connect((error) => {
    notify("error", { message: String(error) });
  });

  // The editor's own objects live in a persistent scene instance. There is no public way to create an
  // empty named SceneInstance in code (world.ts only constructs one in loadScene and for "default"),
  // so the spike uses the implicit persistent "default" instance (world.ts:130).
  const editorScene = app.world.scenes[0];
  if (editorScene === undefined) throw new Error("no default scene");

  if (viewMode === "3d") {
    // The grid joins the render scene before start() so it is part of the deferred build.
    if (query.get("nogrid") !== "1") addEditorGrid(app.lite.engine, app.lite.scene);
    gizmos = createEditorGizmos(app.lite.engine, app.lite.scene, {
      outline: outlineMode,
      overlayWorkaround: query.get("overlayfix") !== "0",
    });
    wireGizmoEvents(gizmos);
    const cameraEntity = app.world.createEntity("Editor Camera", { scene: editorScene });
    editorCameraComponent = cameraEntity.addComponent(Camera, { fov: 50, near: 0.05, far: 1000 });
    editorCameraComponent.priority = 1_000_000;
    app.registerComponents([EditorCamera]);
    editorCamera = cameraEntity.addComponent(EditorCamera);
    editorCamera.claims = gizmos;
    editorCamera.bind(canvas);
    editorCamera.focusTarget = (): { center: { x: number; y: number; z: number }; radius: number } | null => {
      if (selected === null) return null;
      const bounds = gizmos?.worldBounds(selected.transform.lite) ?? null;
      if (bounds === null) return { center: selected.transform.position, radius: 1 };
      const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
      const radius = Math.hypot(bounds.max.x - center.x, bounds.max.y - center.y, bounds.max.z - center.z);
      return { center, radius };
    };
    editorCamera.onClick = (x: number, y: number): void => {
      const t0 = performance.now();
      // CSS px: what Lite's picker actually takes (see the "pick" RPC).
      void (async (): Promise<void> => {
        const hit = await app.renderer.pickAsync(x, y);
        const t1 = performance.now();
        // app.renderer.pickAsync reads the tag of the picked mesh only (lite/picking.ts readPickedTag),
        // and a Model tags only its glTF root (render/gpu/model-instance.ts:71), so a model is never
        // resolved. The spike falls back to Lite's pick + the nearest tagged ancestor.
        let entity = hit?.entity ?? null;
        let via = "renderer.pickAsync";
        if (entity === null) {
          const raw = (await rawPick(app.lite.scene, x, y)) as { entityHandle: number | null };
          entity = raw.entityHandle === null ? null : app.world.getEntityByHandle(raw.entityHandle as Parameters<typeof app.world.getEntityByHandle>[0]);
          via = entity === null ? "miss" : "lite pick + ancestor tag";
        }
        notify("pickResolved", { rendererMs: t1 - t0, totalMs: performance.now() - t0, via, uid: entity?.uid ?? null, name: entity?.name ?? null });
        select(entity, "pick3d");
      })();
    };
  }

  const instance = await app.world.loadScene(scene);
  marks["sceneLoaded"] = performance.now();
  // Spike: give the physics Crate a visible box, so there is a MeshRenderer (tagged per mesh) to pick.
  const crate = app.world.findByName("Crate");
  if (crate !== null) {
    crate.addComponent(MeshRenderer, { mesh: MeshAsset.box(app, { size: 0.5 }) });
  }

  if (viewMode === "2d") {
    const { startMode2D } = await import("./src/mode-2d.js");
    mode2d = startMode2D(app, canvas, editorScene, (entity, via) => {
      select(entity, via);
    });
  }

  await app.start();
  marks["started"] = performance.now();
  if (gizmos !== null && query.get("noregister") !== "1") {
    // After start(): the render scene must be registered first (index.d.ts 11283-11285).
    registration = await gizmos.register();
    marks["utilityLayerRegistered"] = performance.now();
  }
  let last = performance.now();
  const sample = (now: number): void => {
    frameTimes.push(now - last);
    if (frameTimes.length > 600) frameTimes.shift();
    last = now;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  await nextFrame();
  await nextFrame();
  marks["firstFrame"] = performance.now();
  notify("firstFrame", {
    hostEpochMs: Date.now(),
    scene: instance.name,
    editorScene: { name: editorScene.name, persistent: editorScene.persistent, roots: editorScene.roots.map((e) => e.name) },
    scenes: app.world.scenes.map((s) => s.name),
    scripts: scripts.map((type) => type.typeId),
    foreignScripts: foreign,
    settingsInjected: import.meta.env.IGNIFX_CONFIG !== undefined,
    ...status(),
  });
}

main().catch((error: unknown) => {
  marks["failed"] = performance.now();
  notify("failed", { message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
  throw error;
});
