// THROWAWAY spike S0.2 — not for merge. 2D scene-view mode: EditorCamera2D on a Camera2D in the
// editor's persistent scene instance, `app.twoD.pickAt` for selection, and a DOM 2D-canvas overlay
// for the pixel grid and the selection rectangle.
//
// Why a DOM overlay and not Lite `createLines`: a pure 2D project runs `twoD.mode: "sprite"`, which
// skips the 3D scene pass (11-2d-toolkit.md §1), and `createLines` builds a 3D mesh that needs that
// pass and a 3D camera; the sprite pipeline has no line primitive. The overlay is drawn from
// `Camera2D.worldToScreen`, so it is pixel-exact at every zoom step and costs no GPU work.
import { Camera2D, SpriteRenderer } from "@ignifx/2d";
import { Vec2 } from "@ignifx/core";
import { EditorCamera2D } from "./editor-camera-2d.js";
import type { App, Entity, SceneInstance } from "@ignifx/core";

const SPIKE_FRAMES: Record<string, string> = {"Ground": "grass", "Path Decal": "path", "Barrel": "barrel", "Hero": "walk_down_0", "Canopy": "tree_canopy", "Rock": "rock", "Ghost": "bush", "Sign A (order 5)": "water", "Sign B (order 0)": "wall"};

export interface Mode2D {
  readonly camera: EditorCamera2D;
  select(entity: Entity | null): void;
  readonly selected: Entity | null;
  /** Viewport (backing px) of a world point under the editor camera. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  pickAtBacking(x: number, y: number): { uid: string; name: string; sortingLayer: string; orderInLayer: number; u: number; v: number } | null;
  overlayStats(): { lastDrawMs: number; lines: number };
}

export function startMode2D(
  app: App,
  canvas: HTMLCanvasElement,
  editorScene: SceneInstance,
  onSelect: (entity: Entity | null, via: string) => void,
): Mode2D {
  const ppu = app.twoD.pixelsPerUnit;
  const entity = app.world.createEntity("Editor Camera 2D", { scene: editorScene });
  const camera2D = entity.addComponent(Camera2D);
  camera2D.priority = 1_000_000;
  const camera = entity.addComponent(EditorCamera2D);
  camera.bind(canvas, ppu);

  let selected: Entity | null = null;

  // A scene file cannot pick a frame today: `#frame:` on SpriteRenderer.sprite resolves to a
  // SpriteAsset `{ atlas, frame, name }` (atlas/loader.ts:189-192) while the field and the 2D sync
  // expect a SpriteAtlasAsset, so 2d-sync throws "reading 'atlas'" every frame; and `frame` is not a
  // schema field. The spike sets frames by entity name after load.
  const framesToSet = new Map(Object.entries(SPIKE_FRAMES));
  const applyFrames = (): void => {
    for (const [name, frame] of framesToSet) {
      const sprite = app.world.findByName(name)?.getComponent(SpriteRenderer) ?? null;
      const atlas = sprite?.atlas ?? null;
      if (sprite !== null && atlas !== null) {
        sprite.frame = atlas.frameIndex(frame);
        framesToSet.delete(name);
      }
    }
  };

  function pickAtBacking(x: number, y: number): ReturnType<Mode2D["pickAtBacking"]> {
    const hit = app.twoD.pickAt(x, y);
    if (hit === null) return null;
    return {
      uid: hit.entity.uid,
      name: hit.entity.name,
      sortingLayer: hit.component.sortingLayer,
      orderInLayer: hit.component.orderInLayer,
      u: hit.u,
      v: hit.v,
    };
  }

  camera.onClick = (x, y): void => {
    const dpr = window.devicePixelRatio;
    const hit = app.twoD.pickAt(x * dpr, y * dpr);
    selected = hit?.entity ?? null;
    onSelect(selected, "pick2d");
  };

  // Overlay canvas, same box as the scene canvas, never takes the pointer.
  const overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  canvas.parentElement?.append(overlay);
  const ctx = overlay.getContext("2d");
  const stats = { lastDrawMs: 0, lines: 0 };
  const a = new Vec2();

  function draw(): void {
    requestAnimationFrame(draw);
    if (framesToSet.size > 0) applyFrames();
    if (ctx === null) return;
    const t0 = performance.now();
    const w = canvas.width;
    const h = canvas.height;
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const view = camera2D.viewportSizePx;
    if (view.x === 0) return;
    const pxPerUnit = camera.screenPixelsPerUnit;
    // Grid step: one world unit; when a unit is under 8 screen px, every 10 units. When one source
    // pixel is at least 8 screen px, also draw the source-pixel grid.
    const unitStep = pxPerUnit >= 8 ? 1 : 10;
    const tl = camera2D.screenToWorld(0, 0, new Vec2());
    const br = camera2D.screenToWorld(w, h, new Vec2());
    let lines = 0;
    const strokeGrid = (step: number, style: string): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        camera2D.worldToScreen({ x, y: 0 }, a);
        const sx = Math.round(a.x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        lines += 1;
      }
      for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
        camera2D.worldToScreen({ x: 0, y }, a);
        const sy = Math.round(a.y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        lines += 1;
      }
      ctx.stroke();
    };
    if (camera.zoom >= 8) strokeGrid(1 / ppu, "rgba(255,255,255,0.08)");
    strokeGrid(unitStep, "rgba(255,255,255,0.28)");
    // Origin axes.
    camera2D.worldToScreen({ x: 0, y: 0 }, a);
    ctx.strokeStyle = "rgba(255,80,80,0.8)";
    ctx.beginPath();
    ctx.moveTo(0, Math.round(a.y) + 0.5);
    ctx.lineTo(w, Math.round(a.y) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(80,255,80,0.8)";
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, 0);
    ctx.lineTo(Math.round(a.x) + 0.5, h);
    ctx.stroke();
    // Selection rectangle from SpriteRenderer.bounds (world AABB the 2D sync writes each frame).
    const sprite = selected?.getComponent(SpriteRenderer) ?? null;
    if (sprite !== null) {
      const b = sprite.bounds;
      const p0 = camera2D.worldToScreen({ x: b.min.x, y: b.max.y }, new Vec2());
      const p1 = camera2D.worldToScreen({ x: b.max.x, y: b.min.y }, new Vec2());
      ctx.strokeStyle = "rgb(255,153,26)";
      ctx.lineWidth = 2 * window.devicePixelRatio;
      ctx.strokeRect(Math.round(p0.x), Math.round(p0.y), Math.round(p1.x - p0.x), Math.round(p1.y - p0.y));
    }
    stats.lines = lines;
    stats.lastDrawMs = performance.now() - t0;
  }
  requestAnimationFrame(draw);

  return {
    camera,
    get selected(): Entity | null {
      return selected;
    },
    select(next: Entity | null): void {
      selected = next;
    },
    worldToScreen(x: number, y: number): { x: number; y: number } {
      const out = camera2D.worldToScreen({ x, y }, new Vec2());
      return { x: out.x, y: out.y };
    },
    pickAtBacking,
    overlayStats: () => ({ ...stats }),
  };
}
