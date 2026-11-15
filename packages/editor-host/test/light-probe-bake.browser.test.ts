import { Environment, Model } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import {
  HostCapability,
  isBakeLightProbesResult,
  LightProbeBakeMethod,
  SceneNotification,
} from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer, Received } from "./support/editor.js";
import type { FetchLike, SceneFile } from "@ignifx/core";

/**
 * `bakeLightProbes` on a real WebGPU canvas: under a GPU a model keeps no file bytes, so the bake
 * reads it from its drawn meshes, and the installed environment's diffuse harmonics are the sky.
 */

/** The volume above the model, a glTF box, and the studio environment. */
const SCENE: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "bake",
  entities: [
    {
      uid: "VOLUME",
      name: "Probes",
      parent: null,
      transform: { position: [0, 3, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] },
      components: [{ uid: "VOLUME-V", type: "ignifx/LightProbeVolume", props: {} }],
    },
    {
      uid: "CRATE",
      name: "Crate",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0.382_683_4, 0, 0.923_879_5], scale: [1, 1, 1] },
      components: [{ uid: "CRATE-M", type: "ignifx/Model", props: { model: { $asset: "models/Box.glb" } } }],
    },
    {
      uid: "ENV",
      name: "Environment",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [
        { uid: "ENV-E", type: "ignifx/Environment", props: { environment: { $asset: "environments/studio.env" } } },
      ],
    },
  ],
};

/**
 * Serves the repository's `Box.glb`, `studio.env` and `brdf-lut.png` fixtures.
 *
 * @param input - The request.
 * @returns The file, or a 404.
 */
const fetchFiles: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const address = url.replace(/^.*?assets\//u, "").replace(/^\//u, "");
  const fixture = { "models/Box.glb": "Box.glb", "environments/studio.env": "studio.env" }[address];
  if (fixture !== undefined) {
    return fetch(`/tests/fixtures/assets/${fixture}`);
  }
  if (address === "environments/brdf-lut.png") {
    return fetch("/tests/fixtures/assets/brdf-lut.png");
  }
  return new Response(null, { status: 404 });
};

let host: EditorHost | null = null;
let peer: EditorPeer | null = null;
let canvas: HTMLCanvasElement | null = null;

afterEach(() => {
  peer?.close();
  host?.dispose();
  canvas?.remove();
  host = null;
  peer = null;
  canvas = null;
});

/**
 * Waits for the next animation frame.
 *
 * @returns A promise that settles on it.
 */
async function frame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("bakeLightProbes in a scene view with a GPU", () => {
  it("traces a model from its drawn meshes and takes the environment's sky", async () => {
    canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    const target = new EventTarget();
    const starting = startEditorHost({
      editorOrigin: EDITOR_ORIGIN,
      canvas,
      messageTarget: target,
      settings: { rendering: { brdfLut: "environments/brdf-lut.png" } },
      assets: { fetch: fetchFiles },
      heartbeatIntervalMs: 60_000,
    });
    peer = connect(target);
    const ready = await peer.hello();
    expect(Reflect.get(Object(ready["result"]), "capabilities")).toContain(HostCapability.bakeLightProbes);
    host = await starting;
    const app = host.app;
    await peer.nextNotification(SceneNotification.schemasChanged);
    await peer.request("openScene", { file: SCENE, address: "scenes/bake.scene.json" });
    // The model is drawn, and the environment installed, a few frames after the load.
    for (let left = 600; left > 0; left -= 1) {
      const model = app.world.components(Model)[0];
      const environment = app.world.components(Environment)[0];
      if (model?.lite.root !== null && model !== undefined && (environment?.installed ?? null) !== null) {
        break;
      }
      // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
      await frame();
    }
    const answer: Received = await peer.request(LightProbeBakeMethod.bakeLightProbes, {
      volume: "VOLUME",
      counts: [1, 1, 1],
      rays: 64,
    });
    const result: unknown = answer["result"];
    expect(isBakeLightProbesResult(result)).toBe(true);
    expect(result).toHaveProperty("sky", "environment");
    expect(result).toHaveProperty("stats.triangles", 12);
    expect(result).toHaveProperty("skips", []);
    const coefficients: unknown = Reflect.get(Object(Reflect.get(Object(result), "probes")), "coefficients");
    // Above the box, most rays see the studio's light.
    expect(Array.isArray(coefficients) ? Number(coefficients[0]) : 0).toBeGreaterThan(0);
  });
});
