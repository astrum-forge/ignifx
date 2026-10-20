import { Tilemap, twoD } from "@ignifx/2d";
import { createApp, createManualClock, createMemorySink, serializeScene, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { TilemapCollider2D } from "../../src/components/tilemap-collider.js";
import { physics2d } from "../../src/extension.js";
import { FIXED_STEP } from "../support/harness.js";
import type { App, FetchLike, MemorySink } from "@ignifx/core";

/**
 * A scene file that holds a `Tilemap` and a `TilemapCollider2D` on one entity has tile collision
 * with no code after the load (`docs/architecture/11-2d-toolkit.md` §2.5, engine PR #52 gap 20).
 * These suites register the real `@ignifx/2d` extension, so the geometry comes from the tilemap
 * loader and the collision merger rather than from hand-built data.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** The scene's address. */
const SCENE = "scenes/level.scene.json";

/**
 * An 8x4 map of one-metre cells. The bottom row is solid ground with a gap at columns 3 and 4, and
 * a one-way plank sits at column 6 of the second row from the top. Rows are stored top first.
 */
const MAP = {
  format: "ignifx.tilemap",
  formatVersion: 1,
  tileWidth: 16,
  tileHeight: 16,
  cellSize: 1,
  width: 8,
  height: 4,
  tilesets: [
    {
      name: "terrain",
      atlas: "tiles.atlas.json",
      firstId: 1,
      tiles: [
        { id: 0, frame: "ground", collider: { kind: "box", x: 0, y: 0, width: 1, height: 1 } },
        { id: 1, frame: "plank", collider: { kind: "box", x: 0, y: 0, width: 1, height: 0.25, oneWay: true } },
      ],
    },
  ],
  layers: [
    {
      name: "Terrain",
      sortingLayer: "Default",
      orderInLayer: 0,
      collision: true,
      tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1],
    },
  ],
};

/**
 * Builds a scene file with one `Level` entity carrying both components.
 *
 * @param colliderFirst - Whether the file lists the collider before the tilemap.
 * @returns The canonical scene text.
 */
function sceneText(colliderFirst: boolean): string {
  const tilemap = {
    uid: "01M5019D57GNWGM08AR6VY0BYX",
    type: "ignifx/Tilemap",
    props: { map: { $asset: "level.tilemap.json", type: "tilemap" }, chunkSize: 4, cellSizeOverride: 0 },
  };
  const collider = {
    uid: "01M5019D57GNWGM08AR6VY0BYZ",
    type: "ignifx/TilemapCollider2D",
    props: {
      offset: [0, 0],
      isTrigger: false,
      material: null,
      inlineMaterial: null,
      frictionCombine: "average",
      restitutionCombine: "average",
      oneWay: false,
      layerOverride: "",
    },
  };
  return stringifySceneFile({
    format: "ignifx.scene",
    formatVersion: 1,
    name: "level",
    settings: {},
    entities: [
      {
        uid: "01M5019D56QN4RE9MGE5CG2Y05",
        name: "Level",
        parent: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: colliderFirst ? [collider, tilemap] : [tilemap, collider],
      },
    ],
  });
}

/**
 * Answers asset reads from a table of addresses.
 *
 * @param files - Address to text.
 * @returns A fetch that answers `assets/<address>`, or a 404.
 */
function tableFetch(files: Readonly<Record<string, string>>): FetchLike {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = files[url.replace(/^assets\//u, "")] ?? null;
    return Promise.resolve(body === null ? new Response(null, { status: 404 }) : new Response(body, { status: 200 }));
  };
}

/** A loaded level, before the app has started. */
interface LoadedLevel {
  readonly app: App;
  readonly sink: MemorySink;
  readonly text: string;
  readonly tilemap: Tilemap;
  readonly collider: TilemapCollider2D;
  /** Starts the app, which builds the Rapier world, and runs `count` frames. */
  readonly run: (count: number) => Promise<void>;
}

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

/**
 * Loads the level scene into a headless app with the 2D toolkit and 2D physics.
 *
 * @param options - How to build the scene and the app.
 * @param options.colliderFirst - Whether the file lists the collider before the tilemap.
 * @param options.editMode - Whether the app is an edit-mode app (ADR-0028).
 * @returns The app and the level's two components.
 */
async function loadLevel(options?: { colliderFirst?: boolean; editMode?: boolean }): Promise<LoadedLevel> {
  const text = sceneText(options?.colliderFirst ?? false);
  const clock = createManualClock();
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    editMode: options?.editMode ?? false,
    extensions: [twoD(), physics2d()],
    fetch: tableFetch({ [SCENE]: text, "level.tilemap.json": JSON.stringify(MAP) }),
  });
  apps.push(app);
  const instance = await app.world.loadScene(SCENE);
  const level = instance.roots[0];
  if (level === undefined) {
    throw new Error("The scene has no root.");
  }
  let started = false;
  return {
    app,
    sink,
    text,
    tilemap: level.requireComponent(Tilemap),
    collider: level.requireComponent(TilemapCollider2D),
    run: async (count: number): Promise<void> => {
      if (!started) {
        started = true;
        await app.start();
      }
      for (let index = 0; index < count; index += 1) {
        clock.advance(FIXED_STEP * MILLISECONDS_PER_SECOND);
        app.step(FIXED_STEP);
      }
    },
  };
}

/**
 * Casts a ray straight down from above the map through one column's centre.
 *
 * @param app - The app.
 * @param column - The cell column.
 * @returns The name of the entity hit, or `null`.
 */
function hitBelow(app: App, column: number): string | null {
  return app.physics2d.raycast({ x: column + 0.5, y: 10 }, { x: 0, y: -1 }, 20)?.entity.name ?? null;
}

describe("TilemapCollider2D in a scene file", () => {
  it("has the tilemap's geometry as soon as the scene has loaded, with no code and no step", async () => {
    const { collider, tilemap, sink } = await loadLevel();

    const data = collider.collisionData;
    expect(data).toBe(tilemap.collisionData);
    expect(data?.cellSize).toBe(1);
    // Two ground runs, columns 0-2 and 5-7, merge into one rectangle each; the plank is an edge.
    const polygons = data?.chunks.flatMap((chunk) => chunk.polygons) ?? [];
    expect(polygons).toHaveLength(2);
    expect(polygons.map((polygon) => polygon.map((point) => [point.x, point.y]))).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          [0, 0],
          [3, 0],
          [3, 1],
          [0, 1],
        ]),
        expect.arrayContaining([
          [5, 0],
          [8, 0],
          [8, 1],
          [5, 1],
        ]),
      ]),
    );
    expect(data?.chunks.flatMap((chunk) => chunk.oneWayEdges)).toHaveLength(1);
    expect(sink.toArray().filter((record) => record.level === "warn" || record.level === "error")).toEqual([]);
  });

  it("collides with a solid tile and not with the gap after the first step", async () => {
    const { app, run } = await loadLevel();
    await run(1);
    expect(hitBelow(app, 1)).toBe("Level");
    expect(hitBelow(app, 6)).toBe("Level");
    expect(hitBelow(app, 3)).toBeNull();
    expect(app.physics2d.raycast({ x: 1.5, y: 10 }, { x: 0, y: -1 }, 20)?.point.y).toBeCloseTo(1, 5);
  });

  it("finds the tilemap whichever order the file lists the components in", async () => {
    const { app, collider, tilemap, run } = await loadLevel({ colliderFirst: true });
    expect(collider.collisionData).toBe(tilemap.collisionData);
    await run(1);
    expect(hitBelow(app, 1)).toBe("Level");
  });

  it("follows a tile edit into physics at the next fixed step", async () => {
    const { app, tilemap, run } = await loadLevel();
    await run(1);
    expect(hitBelow(app, 1)).toBe("Level");
    // Cell row 0 is the bottom row; clearing column 1 splits the left ground run in two.
    tilemap.setTile(0, 1, 0, 0);
    await run(1);
    expect(hitBelow(app, 1)).toBeNull();
    expect(hitBelow(app, 0)).toBe("Level");
  });

  it("uses assigned data instead, and goes back to the tilemap when it is cleared", async () => {
    const { app, collider, tilemap, run } = await loadLevel();
    await run(1);
    collider.collisionData = { cellSize: 1, chunkSize: 4, chunks: [], version: 1 };
    await run(1);
    expect(hitBelow(app, 1)).toBeNull();
    collider.collisionData = null;
    expect(collider.collisionData).toBe(tilemap.collisionData);
    await run(1);
    expect(hitBelow(app, 1)).toBe("Level");
  });

  it("builds nothing for a disabled collider, and builds once it is enabled again", async () => {
    const { app, collider, run } = await loadLevel();
    collider.enabled = false;
    await run(2);
    expect(hitBelow(app, 1)).toBeNull();
    // Nothing to build, so the runtime is not asked to rebuild the level on every step.
    expect(collider.needsRebuild()).toBe(false);
    collider.enabled = true;
    await run(1);
    expect(hitBelow(app, 1)).toBe("Level");
  });

  it("round-trips the file byte for byte", async () => {
    const { app, text, run } = await loadLevel();
    await run(2);
    const scene = app.world.scenes.find((instance) => instance.name === "level");
    expect(scene).toBeDefined();
    if (scene !== undefined) {
      expect(stringifySceneFile(serializeScene(scene, { engineVersion: null }))).toBe(text);
    }
  });

  it("exposes the geometry in an edit-mode app, which builds the body without stepping", async () => {
    const { app, collider, run } = await loadLevel({ editMode: true });
    await run(5);
    expect(collider.collisionData?.chunks.flatMap((chunk) => chunk.polygons)).toHaveLength(2);
    expect(hitBelow(app, 1)).toBe("Level");
    expect(app.diagnostics.frame.fixedSteps).toBe(0);
    // Rapier's outline of every piece of the tile collision, for an editor's gizmo.
    const [outline] = app.physics2d.colliderOutlines(collider.entity);
    expect(outline?.collider).toBe(collider);
    expect(outline?.lines.length).toBeGreaterThan(0);
  });
});
